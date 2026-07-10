import { runActionCode } from '@/utils/action'
import {
  captureOpenCliScreenshot,
  detachOpenCliDebugger,
  evaluateOpenCliExpression,
  performOpenCliCdpCommand,
  registerOpenCliCdpListeners,
} from '@/utils/opencli-cdp'
import {
  OPENCLI_DAEMON_WS_URL,
  OPENCLI_WS_RECONNECT_BASE_DELAY,
  OPENCLI_WS_RECONNECT_MAX_DELAY,
  OpenCliCommand,
  OpenCliResult,
} from '@/utils/opencli-protocol'
import type { Template } from '@/types'

type AutomationSession = {
  windowId: number
  idleTimer: ReturnType<typeof setTimeout> | null
  idleDeadlineAt: number
  owned: boolean
  preferredTabId: number | null
}

const OPENCLI_KEEPALIVE_ALARM = 'opencli-keepalive'
const OPENCLI_MAX_EAGER_ATTEMPTS = 6
const OPENCLI_WINDOW_IDLE_TIMEOUT = 120000
const OPENCLI_BLANK_PAGE = 'data:text/html,<html></html>'
const OPENCLI_TEMPLATE_TASK_POLL_MS = 10000
const OPENCLI_TEMPLATE_TASK_TTL_MS = 30 * 60 * 1000

let openCliWs: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let initialized = false
let openCliCommandChain: Promise<void> = Promise.resolve()

const automationSessions = new Map<string, AutomationSession>()

type OpenCliTemplateTaskStatus = 'queued' | 'running' | 'success' | 'error'

type OpenCliTemplateTask = {
  taskId: string
  workspace: string
  template: Template
  targetUrl?: string
  inputParams: Record<string, unknown>
  status: OpenCliTemplateTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: unknown
  error?: string
}

const openCliTemplateTasks = new Map<string, OpenCliTemplateTask>()
const openCliTemplateQueue: string[] = []
let openCliTemplateTaskConsuming = false

const originalConsoleLog = console.log.bind(console)
const originalConsoleWarn = console.warn.bind(console)
const originalConsoleError = console.error.bind(console)

function forwardOpenCliLog(level: 'info' | 'warn' | 'error', args: unknown[]) {
  if (!openCliWs || openCliWs.readyState !== WebSocket.OPEN) return

  try {
    const message = args
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(' ')
    openCliWs.send(
      JSON.stringify({
        type: 'log',
        level,
        msg: message,
        ts: Date.now(),
      }),
    )
  } catch {}
}

function patchConsoleForOpenCli() {
  const currentConsole = console as typeof console & {
    __opencli_patched__?: boolean
  }
  if (currentConsole.__opencli_patched__) return

  console.log = (...args: unknown[]) => {
    originalConsoleLog(...args)
    forwardOpenCliLog('info', args)
  }
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args)
    forwardOpenCliLog('warn', args)
  }
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args)
    forwardOpenCliLog('error', args)
  }

  currentConsole.__opencli_patched__ = true
}

function getWorkspaceKey(workspace?: string) {
  return workspace?.trim() || 'default'
}

function setWorkspaceSession(
  workspace: string,
  session: Omit<AutomationSession, 'idleTimer' | 'idleDeadlineAt'>,
) {
  const existing = automationSessions.get(workspace)
  if (existing?.idleTimer) clearTimeout(existing.idleTimer)
  automationSessions.set(workspace, {
    ...session,
    idleTimer: null,
    idleDeadlineAt: Date.now() + OPENCLI_WINDOW_IDLE_TIMEOUT,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTemplate(value: unknown): value is Template {
  return isRecord(value) && typeof value.name === 'string'
}

function createTemplateTaskId() {
  return `opencli-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildTemplateTaskSnapshot(task: OpenCliTemplateTask) {
  return {
    taskId: task.taskId,
    status: task.status,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  }
}

function purgeStaleTemplateTasks(now = Date.now()) {
  for (const [taskId, task] of openCliTemplateTasks.entries()) {
    if (
      task.finishedAt &&
      now - task.finishedAt > OPENCLI_TEMPLATE_TASK_TTL_MS
    ) {
      openCliTemplateTasks.delete(taskId)
    }
  }
}

async function resolveCurrentTabId(
  workspace?: string,
  targetUrl?: string,
): Promise<number> {
  const workspaceKey = workspace ? getWorkspaceKey(workspace) : ''
  if (workspaceKey) {
    const session = automationSessions.get(workspaceKey)
    const preferredTabId = session?.preferredTabId
    console.log('[opencli][task] resolveCurrentTabId session lookup', {
      workspace: workspaceKey,
      preferredTabId,
      sessionWindowId: session?.windowId,
      sessionOwned: session?.owned,
      targetUrl,
    })
    if (preferredTabId !== undefined && preferredTabId !== null) {
      try {
        const preferredTab = await chrome.tabs.get(preferredTabId)
        console.log('[opencli][task] resolveCurrentTabId preferred tab', {
          workspace: workspaceKey,
          preferredTabId,
          preferredTabUrl: preferredTab.url,
          targetUrl,
          urlMatched: !targetUrl || isTargetUrl(preferredTab.url, targetUrl),
        })
        if (
          preferredTab.id &&
          isDebuggableUrl(preferredTab.url) &&
          (!targetUrl || isTargetUrl(preferredTab.url, targetUrl))
        ) {
          return preferredTab.id
        }
      } catch (error) {
        console.warn(
          '[opencli][task] resolveCurrentTabId preferred tab lookup failed',
          {
            workspace: workspaceKey,
            preferredTabId,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }
  }

  if (targetUrl) {
    const allTabs = await chrome.tabs.query({})
    const matchedTab = allTabs.find(
      (tab) =>
        tab.id && isDebuggableUrl(tab.url) && isTargetUrl(tab.url, targetUrl),
    )
    if (matchedTab?.id) {
      console.log(
        '[opencli][task] resolveCurrentTabId matched target tab globally',
        {
          workspace: workspaceKey || 'default',
          targetUrl,
          tabId: matchedTab.id,
          tabUrl: matchedTab.url,
          windowId: matchedTab.windowId,
        },
      )
      return matchedTab.id
    }
    console.warn(
      '[opencli][task] resolveCurrentTabId no global target tab match',
      {
        workspace: workspaceKey || 'default',
        targetUrl,
        tabCount: allTabs.length,
      },
    )
  }

  const preferred = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const fallback =
    preferred.length > 0 ? preferred : await chrome.tabs.query({ active: true })
  const tab = fallback.find((item) => item.id !== undefined)
  if (!tab?.id) {
    throw new Error('No active tab available for plugin task execution')
  }
  console.log('[opencli][task] resolveCurrentTabId fallback active tab', {
    workspace: workspaceKey || 'default',
    targetUrl,
    tabId: tab.id,
    tabUrl: tab.url,
    lastFocusedWindow: tab.windowId,
  })
  return tab.id
}

async function consumeOpenCliTemplateTasks() {
  if (openCliTemplateTaskConsuming) return

  openCliTemplateTaskConsuming = true
  purgeStaleTemplateTasks()

  try {
    while (openCliTemplateQueue.length > 0) {
      const taskId = openCliTemplateQueue.shift()
      if (!taskId) continue

      const task = openCliTemplateTasks.get(taskId)
      if (!task || task.status !== 'queued') continue

      task.status = 'running'
      task.startedAt = Date.now()

      try {
        console.log('[opencli][task] start consume template task', {
          taskId: task.taskId,
          workspace: task.workspace,
          targetUrl: task.targetUrl,
          templateName: task.template.name,
        })
        const actionCode = task.template.action_template?.action_code?.trim()
        if (!actionCode) {
          throw new Error(
            `Template ${task.template.name} is missing action_code`,
          )
        }

        const tabId = await resolveCurrentTabId(task.workspace, task.targetUrl)
        const resolvedTab = await chrome.tabs.get(tabId).catch(() => undefined)
        console.log('[opencli][task] resolved execution tab', {
          taskId: task.taskId,
          workspace: task.workspace,
          targetUrl: task.targetUrl,
          tabId,
          currentUrl: resolvedTab?.url,
        })
        const executeResult = await runActionCode({
          actionCode,
          targetUrl: task.targetUrl,
          tabId,
          userParams: {
            ...task.inputParams,
            template: task.template,
          },
          workflowTaskId: task.taskId,
          taskId: task.taskId,
          templateId: undefined,
          userName: 'OpenCLI',
          isActionOnly: true,
        })

        task.status = 'success'
        task.result = executeResult.actionRes.data
        task.finishedAt = Date.now()
      } catch (error) {
        task.status = 'error'
        task.error = error instanceof Error ? error.message : String(error)
        task.finishedAt = Date.now()
      }
    }
  } finally {
    openCliTemplateTaskConsuming = false
  }
}

function isDebuggableUrl(url?: string) {
  if (!url) return true
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url === OPENCLI_BLANK_PAGE
  )
}

function isSafeNavigationUrl(url: string) {
  return url.startsWith('http://') || url.startsWith('https://')
}

function shouldOpenInCurrentWindow(workspace: string, initialUrl?: string) {
  return workspace === 'site:shopee' && !!initialUrl && isSafeNavigationUrl(initialUrl)
}

async function findPreferredExistingWindowId(): Promise<number | null> {
  const activeTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const activeWindowId = activeTabs.find((tab) => tab.windowId !== undefined)?.windowId
  if (activeWindowId !== undefined) return activeWindowId

  const windowTabs = await chrome.tabs.query({ lastFocusedWindow: true })
  const lastFocusedWindowId = windowTabs.find((tab) => tab.windowId !== undefined)?.windowId
  if (lastFocusedWindowId !== undefined) return lastFocusedWindowId

  return null
}

function normalizeUrlForComparison(url?: string) {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')
    ) {
      parsed.port = ''
    }
    const shopeeProductKey = getShopeeProductComparisonKey(parsed)
    if (shopeeProductKey) {
      return `${parsed.protocol}//${parsed.host}${shopeeProductKey}`
    }
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

function normalizeUrlPathForComparison(url?: string) {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')
    ) {
      parsed.port = ''
    }
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.protocol}//${parsed.host}${pathname}`
  } catch {
    return url
  }
}

function getShopeeProductComparisonKey(parsed: URL): string | null {
  const hostname = parsed.hostname.toLowerCase()
  if (!/(^|\.)shopee\./.test(hostname)) {
    return null
  }

  const productPathMatch = parsed.pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/)
  if (productPathMatch) {
    return `/__shopee_product__/${productPathMatch[1]}/${productPathMatch[2]}`
  }

  const slugPathMatch = parsed.pathname.match(/\/(?:[^/]*-)?i\.(\d+)\.(\d+)\/?$/)
  if (slugPathMatch) {
    return `/__shopee_product__/${slugPathMatch[1]}/${slugPathMatch[2]}`
  }

  return null
}

function isTargetUrl(currentUrl: string | undefined, targetUrl: string) {
  const normalizedCurrent = normalizeUrlForComparison(currentUrl)
  const normalizedTarget = normalizeUrlForComparison(targetUrl)
  if (normalizedCurrent === normalizedTarget) return true

  try {
    const parsedTarget = new URL(targetUrl)
    if (parsedTarget.search || parsedTarget.hash) {
      return false
    }
  } catch {
    return false
  }

  return (
    normalizeUrlPathForComparison(currentUrl) ===
    normalizeUrlPathForComparison(targetUrl)
  )
}

function matchesDomain(url: string | undefined, domain: string) {
  if (!url) return false

  try {
    const parsed = new URL(url)
    return parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  } catch {
    return false
  }
}

function matchesBindCriteria(tab: chrome.tabs.Tab, command: OpenCliCommand) {
  if (!tab.id || !isDebuggableUrl(tab.url)) return false
  if (command.matchUrl && !isTargetUrl(tab.url, command.matchUrl)) {
    return false
  }
  if (command.matchDomain && !matchesDomain(tab.url, command.matchDomain)) {
    return false
  }
  if (command.matchPath) {
    try {
      const parsed = new URL(tab.url!)
      if (parsed.pathname !== command.matchPath) return false
    } catch {
      return false
    }
  }
  if (command.matchPathPrefix) {
    try {
      const parsed = new URL(tab.url!)
      if (!parsed.pathname.startsWith(command.matchPathPrefix)) return false
    } catch {
      return false
    }
  }
  return true
}

function isOwnedAutomationTab(tab: chrome.tabs.Tab) {
  if (!tab.id) return false

  for (const session of automationSessions.values()) {
    if (!session.owned) continue
    if (session.preferredTabId !== null && session.preferredTabId === tab.id) {
      return true
    }
    if (session.windowId === tab.windowId) {
      return true
    }
  }

  return false
}

async function findReusableTabForTargetUrl(targetUrl: string) {
  const activeTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true })
  const allTabs = await chrome.tabs.query({})

  const findPreferredTab = (tabs: chrome.tabs.Tab[]) =>
    tabs.find(
      (tab) =>
        tab.id &&
        isDebuggableUrl(tab.url) &&
        isTargetUrl(tab.url, targetUrl) &&
        !isOwnedAutomationTab(tab),
    ) ||
    tabs.find(
      (tab) =>
        tab.id && isDebuggableUrl(tab.url) && isTargetUrl(tab.url, targetUrl),
    )

  return (
    findPreferredTab(activeTabs) ||
    findPreferredTab(fallbackTabs) ||
    findPreferredTab(allTabs) ||
    null
  )
}

function summarizeBindCandidateTab(
  tab: chrome.tabs.Tab,
  command: OpenCliCommand,
) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    url: tab.url,
    matched: matchesBindCriteria(tab, command),
    ownedAutomationTab: isOwnedAutomationTab(tab),
  }
}

async function collectWindowDebugSummary() {
  const windows = await chrome.windows.getAll({ populate: true })
  return windows.map((window) => ({
    windowId: window.id,
    focused: window.focused,
    type: window.type,
    tabCount: window.tabs?.length ?? 0,
    tabs:
      window.tabs?.map((tab) => ({
        id: tab.id,
        active: tab.active,
        url: tab.url,
        pendingUrl: tab.pendingUrl,
      })) ?? [],
  }))
}

function matchesDownloadPattern(
  value: string | undefined,
  pattern: string | undefined,
) {
  if (!pattern) return true
  if (!value) return false
  return value.toLowerCase().includes(pattern.toLowerCase())
}

function matchesOpenCliDownloadItem(
  item: chrome.downloads.DownloadItem,
  command: OpenCliCommand,
) {
  const startedAfterMs = Number(command.downloadStartedAfterMs ?? 0)
  const itemStartMs = item.startTime ? Date.parse(item.startTime) : 0
  if (startedAfterMs && itemStartMs && itemStartMs + 250 < startedAfterMs) {
    return false
  }

  if (!matchesDownloadPattern(item.referrer, command.downloadReferrerPattern)) {
    return false
  }

  if (command.downloadUrlPattern) {
    const matched = [item.url, item.finalUrl, item.referrer].some((value) =>
      matchesDownloadPattern(value, command.downloadUrlPattern),
    )
    if (!matched) return false
  }

  return true
}

function toOpenCliDownloadResult(item: chrome.downloads.DownloadItem) {
  return {
    downloadId: item.id,
    filename: item.filename,
    url: item.url,
    finalUrl: item.finalUrl,
    referrer: item.referrer,
    mime: item.mime,
    state: item.state,
    startTime: item.startTime,
    endTime: item.endTime,
    fileSize: item.fileSize,
    totalBytes: item.totalBytes,
    exists: item.exists,
  }
}

function resetWindowIdleTimer(workspace: string) {
  const session = automationSessions.get(workspace)
  if (!session) return

  if (session.idleTimer) clearTimeout(session.idleTimer)

  session.idleDeadlineAt = Date.now() + OPENCLI_WINDOW_IDLE_TIMEOUT
  session.idleTimer = setTimeout(async () => {
    const current = automationSessions.get(workspace)
    if (!current) return

    await detachOpenCliDebuggersForSession(current)

    if (!current.owned) {
      console.log(
        `[opencli] Borrowed workspace ${workspace} detached from window ${current.windowId} (idle timeout)`,
      )
      automationSessions.delete(workspace)
      return
    }

    try {
      await chrome.windows.remove(current.windowId)
      console.log(
        `[opencli] Automation window ${current.windowId} (${workspace}) closed (idle timeout)`,
      )
    } catch {}

    automationSessions.delete(workspace)
  }, OPENCLI_WINDOW_IDLE_TIMEOUT)
}

async function detachOpenCliDebuggersForSession(
  session: AutomationSession,
): Promise<void> {
  const tabIds = new Set<number>()

  if (session.preferredTabId !== null) {
    tabIds.add(session.preferredTabId)
  }

  try {
    const tabs = await chrome.tabs.query({ windowId: session.windowId })
    for (const tab of tabs) {
      if (tab.id !== undefined && isDebuggableUrl(tab.url)) {
        tabIds.add(tab.id)
      }
    }
  } catch {}

  await Promise.allSettled(
    [...tabIds].map((tabId) => detachOpenCliDebugger(tabId)),
  )
}

async function getAutomationWindow(
  workspace: string,
  initialUrl?: string,
): Promise<number> {
  const existing = automationSessions.get(workspace)
  if (existing) {
    try {
      await chrome.windows.get(existing.windowId)
      return existing.windowId
    } catch {
      automationSessions.delete(workspace)
    }
  }

  const startUrl =
    initialUrl && isSafeNavigationUrl(initialUrl)
      ? initialUrl
      : OPENCLI_BLANK_PAGE

  const windowInfo = await chrome.windows.create({
    url: startUrl,
    focused: false,
    width: 1280,
    height: 900,
    type: 'normal',
  })

  if (!windowInfo?.id) {
    throw new Error('Failed to create automation window')
  }

  const session: AutomationSession = {
    windowId: windowInfo.id,
    idleTimer: null,
    idleDeadlineAt: Date.now() + OPENCLI_WINDOW_IDLE_TIMEOUT,
    owned: true,
    preferredTabId: null,
  }
  automationSessions.set(workspace, session)
  console.log(
    `[opencli] Created automation window ${session.windowId} (${workspace}, start=${startUrl})`,
  )
  resetWindowIdleTimer(workspace)

  const tabs = await chrome.tabs.query({ windowId: windowInfo.id })
  if (tabs[0]?.id) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500)
      const listener = (
        tabId: number,
        info: { status?: string; url?: string },
      ) => {
        if (tabId === tabs[0].id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          clearTimeout(timeout)
          resolve()
        }
      }

      if (tabs[0].status === 'complete') {
        clearTimeout(timeout)
        resolve()
      } else {
        chrome.tabs.onUpdated.addListener(listener)
      }
    })
  }

  return session.windowId
}

async function listAutomationTabs(workspace: string) {
  const session = automationSessions.get(workspace)
  if (!session) return []

  if (session.preferredTabId !== null) {
    try {
      return [await chrome.tabs.get(session.preferredTabId)]
    } catch {
      automationSessions.delete(workspace)
      return []
    }
  }

  try {
    return await chrome.tabs.query({ windowId: session.windowId })
  } catch {
    automationSessions.delete(workspace)
    return []
  }
}

async function listAutomationWebTabs(workspace: string) {
  const tabs = await listAutomationTabs(workspace)
  return tabs.filter((tab) => isDebuggableUrl(tab.url))
}

async function resolveTabId(
  tabId: number | undefined,
  workspace: string,
  initialUrl?: string,
): Promise<number> {
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId)
      const session = automationSessions.get(workspace)
      if (
        isDebuggableUrl(tab.url) &&
        session &&
        (session.preferredTabId !== null
          ? session.preferredTabId === tabId
          : tab.windowId === session.windowId)
      ) {
        return tabId
      }
    } catch {}
  }

  const existingSession = automationSessions.get(workspace)
  const preferredTabId = existingSession?.preferredTabId
  if (preferredTabId !== undefined && preferredTabId !== null) {
    try {
      const preferredTab = await chrome.tabs.get(preferredTabId)
      if (isDebuggableUrl(preferredTab.url)) return preferredTab.id!
    } catch {
      automationSessions.delete(workspace)
    }
  }

  if (initialUrl && isSafeNavigationUrl(initialUrl)) {
    const matchedTab = await findReusableTabForTargetUrl(initialUrl)
    if (matchedTab?.id) {
      setWorkspaceSession(workspace, {
        windowId: matchedTab.windowId,
        owned: false,
        preferredTabId: matchedTab.id,
      })
      resetWindowIdleTimer(workspace)
      console.log('[opencli] Reused existing tab for workspace navigation', {
        workspace,
        tabId: matchedTab.id,
        windowId: matchedTab.windowId,
        url: matchedTab.url,
        targetUrl: initialUrl,
      })
      return matchedTab.id
    }
  }

  if (shouldOpenInCurrentWindow(workspace, initialUrl)) {
    const preferredWindowId = await findPreferredExistingWindowId()
    if (preferredWindowId !== null) {
      const tab = await chrome.tabs.create({
        windowId: preferredWindowId,
        url: initialUrl,
        active: true,
      })

      if (!tab.id) throw new Error('Failed to create tab in existing window')

      setWorkspaceSession(workspace, {
        windowId: preferredWindowId,
        owned: false,
        preferredTabId: tab.id,
      })
      resetWindowIdleTimer(workspace)
      console.log('[opencli] Opened new tab in existing window for workspace navigation', {
        workspace,
        tabId: tab.id,
        windowId: preferredWindowId,
        url: tab.url,
        targetUrl: initialUrl,
      })
      return tab.id
    }
  }

  const windowId = await getAutomationWindow(workspace, initialUrl)
  const tabs = await chrome.tabs.query({ windowId })
  const debuggableTab = tabs.find((tab) => tab.id && isDebuggableUrl(tab.url))
  if (debuggableTab?.id) return debuggableTab.id

  const reuseTab = tabs.find((tab) => tab.id)
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: OPENCLI_BLANK_PAGE })
    await new Promise((resolve) => setTimeout(resolve, 300))

    try {
      const updated = await chrome.tabs.get(reuseTab.id)
      if (isDebuggableUrl(updated.url)) return reuseTab.id
    } catch {}
  }

  const newTab = await chrome.tabs.create({
    windowId,
    url: OPENCLI_BLANK_PAGE,
    active: true,
  })

  if (!newTab.id) throw new Error('Failed to create tab in automation window')
  return newTab.id
}

function scheduleReconnect() {
  if (reconnectTimer) return

  reconnectAttempts += 1
  if (reconnectAttempts > OPENCLI_MAX_EAGER_ATTEMPTS) return

  const delay = Math.min(
    OPENCLI_WS_RECONNECT_BASE_DELAY * 2 ** (reconnectAttempts - 1),
    OPENCLI_WS_RECONNECT_MAX_DELAY,
  )

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectOpenCliDaemon()
  }, delay)
}

function connectOpenCliDaemon() {
  if (
    openCliWs?.readyState === WebSocket.OPEN ||
    openCliWs?.readyState === WebSocket.CONNECTING
  ) {
    return
  }

  try {
    openCliWs = new WebSocket(OPENCLI_DAEMON_WS_URL)
  } catch {
    scheduleReconnect()
    return
  }

  openCliWs.onopen = () => {
    console.log('[opencli] Connected to daemon')
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    openCliWs?.send(
      JSON.stringify({
        type: 'hello',
        version: chrome.runtime.getManifest().version,
        extensionId: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
        capabilities: [
          'exec',
          'navigate',
          'tabs',
          'cookies',
          'screenshot',
          'close-window',
          'sessions',
          'bind-current',
          'template-task',
        ],
      }),
    )
  }

  openCliWs.onmessage = (event) => {
    openCliCommandChain = openCliCommandChain
      .catch(() => {})
      .then(async () => {
        try {
          const command = JSON.parse(event.data as string) as OpenCliCommand
          const result = await handleOpenCliCommand(command)
          openCliWs?.send(JSON.stringify(result))
        } catch (error) {
          console.error('[opencli] Message handling error:', error)
        }
      })
  }

  openCliWs.onclose = () => {
    console.log('[opencli] Disconnected from daemon')
    openCliWs = null
    scheduleReconnect()
  }

  openCliWs.onerror = () => {
    openCliWs?.close()
  }
}

async function handleOpenCliExec(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  if (!command.code) {
    return { id: command.id, ok: false, error: 'Missing code' }
  }

  const tabId = await resolveTabId(command.tabId, workspace)
  try {
    const data = await evaluateOpenCliExpression(tabId, command.code)
    return { id: command.id, ok: true, data }
  } catch (error) {
    return {
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function handleOpenCliNavigate(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  if (!command.url) {
    return { id: command.id, ok: false, error: 'Missing url' }
  }
  if (!isSafeNavigationUrl(command.url)) {
    return {
      id: command.id,
      ok: false,
      error: 'Blocked URL scheme -- only http:// and https:// are allowed',
    }
  }

  const tabId = await resolveTabId(command.tabId, workspace, command.url)
  const beforeTab = await chrome.tabs.get(tabId)
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url)
  const targetUrl = command.url

  if (
    beforeTab.status === 'complete' &&
    isTargetUrl(beforeTab.url, targetUrl)
  ) {
    return {
      id: command.id,
      ok: true,
      data: {
        title: beforeTab.title,
        url: beforeTab.url,
        tabId,
        timedOut: false,
      },
    }
  }

  await detachOpenCliDebugger(tabId)
  await chrome.tabs.update(tabId, { url: targetUrl })

  let timedOut = false

  await new Promise<void>((resolve) => {
    let settled = false
    let checkTimer: ReturnType<typeof setTimeout> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      if (checkTimer) clearTimeout(checkTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      resolve()
    }

    const isNavigationDone = (url: string | undefined) =>
      isTargetUrl(url, targetUrl) ||
      normalizeUrlForComparison(url) !== beforeNormalized

    const listener = (
      id: number,
      info: { status?: string; url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return
      if (info.status === 'complete' && isNavigationDone(tab.url ?? info.url)) {
        finish()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)

    checkTimer = setTimeout(async () => {
      try {
        const currentTab = await chrome.tabs.get(tabId)
        if (
          currentTab.status === 'complete' &&
          isNavigationDone(currentTab.url)
        ) {
          finish()
        }
      } catch {}
    }, 100)

    timeoutTimer = setTimeout(() => {
      timedOut = true
      console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`)
      finish()
    }, 15000)
  })

  const tab = await chrome.tabs.get(tabId)
  return {
    id: command.id,
    ok: true,
    data: { title: tab.title, url: tab.url, tabId, timedOut },
  }
}

async function handleOpenCliTabs(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  switch (command.op) {
    case 'list': {
      const tabs = await listAutomationWebTabs(workspace)
      return {
        id: command.id,
        ok: true,
        data: tabs.map((tab, index) => ({
          index,
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active,
        })),
      }
    }
    case 'new': {
      if (command.url && !isSafeNavigationUrl(command.url)) {
        return {
          id: command.id,
          ok: false,
          error: 'Blocked URL scheme -- only http:// and https:// are allowed',
        }
      }
      const windowId = await getAutomationWindow(workspace)
      const tab = await chrome.tabs.create({
        windowId,
        url: command.url ?? OPENCLI_BLANK_PAGE,
        active: true,
      })
      return {
        id: command.id,
        ok: true,
        data: { tabId: tab.id, url: tab.url },
      }
    }
    case 'close': {
      if (command.index !== undefined) {
        const tabs = await listAutomationWebTabs(workspace)
        const target = tabs[command.index]
        if (!target?.id) {
          return {
            id: command.id,
            ok: false,
            error: `Tab index ${command.index} not found`,
          }
        }
        await chrome.tabs.remove(target.id)
        await detachOpenCliDebugger(target.id)
        return { id: command.id, ok: true, data: { closed: target.id } }
      }

      const tabId = await resolveTabId(command.tabId, workspace)
      await chrome.tabs.remove(tabId)
      await detachOpenCliDebugger(tabId)
      return { id: command.id, ok: true, data: { closed: tabId } }
    }
    case 'select': {
      if (command.index === undefined && command.tabId === undefined) {
        return {
          id: command.id,
          ok: false,
          error: 'Missing index or tabId',
        }
      }

      if (command.tabId !== undefined) {
        const session = automationSessions.get(workspace)
        let tab: chrome.tabs.Tab
        try {
          tab = await chrome.tabs.get(command.tabId)
        } catch {
          return {
            id: command.id,
            ok: false,
            error: `Tab ${command.tabId} no longer exists`,
          }
        }
        if (!session || tab.windowId !== session.windowId) {
          return {
            id: command.id,
            ok: false,
            error: `Tab ${command.tabId} is not in the automation window`,
          }
        }

        await chrome.tabs.update(command.tabId, { active: true })
        return { id: command.id, ok: true, data: { selected: command.tabId } }
      }

      const tabs = await listAutomationWebTabs(workspace)
      const targetIndex = command.index
      if (targetIndex === undefined) {
        return {
          id: command.id,
          ok: false,
          error: 'Missing tab index',
        }
      }
      const target = tabs[targetIndex]
      if (!target?.id) {
        return {
          id: command.id,
          ok: false,
          error: `Tab index ${targetIndex} not found`,
        }
      }

      await chrome.tabs.update(target.id, { active: true })
      return { id: command.id, ok: true, data: { selected: target.id } }
    }
    default:
      return {
        id: command.id,
        ok: false,
        error: `Unknown tabs op: ${command.op}`,
      }
  }
}

async function handleOpenCliCookies(
  command: OpenCliCommand,
): Promise<OpenCliResult> {
  if (!command.domain && !command.url) {
    return {
      id: command.id,
      ok: false,
      error:
        'Cookie scope required: provide domain or url to avoid dumping all cookies',
    }
  }

  const details: chrome.cookies.GetAllDetails = {}
  if (command.domain) details.domain = command.domain
  if (command.url) details.url = command.url

  const cookies = await chrome.cookies.getAll(details)
  return {
    id: command.id,
    ok: true,
    data: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
    })),
  }
}

async function handleOpenCliScreenshot(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  const tabId = await resolveTabId(command.tabId, workspace)

  try {
    const data = await captureOpenCliScreenshot(tabId, {
      format: command.format,
      quality: command.quality,
      fullPage: command.fullPage,
    })
    return { id: command.id, ok: true, data }
  } catch (error) {
    return {
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function handleOpenCliCloseWindow(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  const session = automationSessions.get(workspace)
  if (session) {
    await detachOpenCliDebuggersForSession(session)

    if (session.owned) {
      try {
        await chrome.windows.remove(session.windowId)
      } catch {}
    }

    if (session.idleTimer) clearTimeout(session.idleTimer)
    automationSessions.delete(workspace)
  }

  return { id: command.id, ok: true, data: { closed: true } }
}

async function handleOpenCliCdp(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  const method = command.cdpMethod?.trim()
  if (!method) {
    return { id: command.id, ok: false, error: 'Missing cdpMethod' }
  }

  const tabId = await resolveTabId(command.tabId, workspace)

  try {
    const data = await performOpenCliCdpCommand(
      tabId,
      method,
      command.cdpParams || {},
    )
    return { id: command.id, ok: true, data }
  } catch (error) {
    return {
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function handleOpenCliDownloadWait(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  await resolveTabId(command.tabId, workspace)
  const timeoutMs = Math.max(
    1000,
    Math.min(Number(command.downloadTimeoutMs) || 30000, 120000),
  )

  const recent = await chrome.downloads.search({
    orderBy: ['-startTime'],
    limit: 20,
  })
  const existing = recent.find(
    (item) =>
      matchesOpenCliDownloadItem(item, command) &&
      item.state === 'complete' &&
      !!item.filename,
  )
  if (existing) {
    return { id: command.id, ok: true, data: toOpenCliDownloadResult(existing) }
  }

  return await new Promise<OpenCliResult>((resolve) => {
    const pending = new Set<number>()
    let settled = false

    const finish = (result: OpenCliResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      chrome.downloads.onCreated.removeListener(onCreated)
      chrome.downloads.onChanged.removeListener(onChanged)
      resolve(result)
    }

    const maybeResolveById = async (downloadId: number) => {
      try {
        const items = await chrome.downloads.search({ id: downloadId })
        const item = items[0]
        if (!item || !matchesOpenCliDownloadItem(item, command)) return
        if (item.state === 'complete' && item.filename) {
          finish({
            id: command.id,
            ok: true,
            data: toOpenCliDownloadResult(item),
          })
        }
      } catch (error) {
        finish({
          id: command.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const item of recent) {
      if (!matchesOpenCliDownloadItem(item, command)) continue
      if (item.state === 'complete' && item.filename) {
        finish({
          id: command.id,
          ok: true,
          data: toOpenCliDownloadResult(item),
        })
        return
      }
      pending.add(item.id)
    }

    const onCreated = (item: chrome.downloads.DownloadItem) => {
      if (!matchesOpenCliDownloadItem(item, command)) return
      pending.add(item.id)
      if (item.state === 'complete' && item.filename) {
        finish({
          id: command.id,
          ok: true,
          data: toOpenCliDownloadResult(item),
        })
      }
    }

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (!pending.has(delta.id)) return
      if (delta.state?.current === 'complete') {
        void maybeResolveById(delta.id)
      }
    }

    const timer = setTimeout(() => {
      finish({
        id: command.id,
        ok: false,
        error: `Timed out waiting for browser download after ${Math.ceil(timeoutMs / 1000)}s`,
      })
    }, timeoutMs)

    chrome.downloads.onCreated.addListener(onCreated)
    chrome.downloads.onChanged.addListener(onChanged)
  })
}

async function handleOpenCliSessions(
  command: OpenCliCommand,
): Promise<OpenCliResult> {
  const now = Date.now()
  const data = await Promise.all(
    [...automationSessions.entries()].map(async ([workspace, session]) => ({
      workspace,
      windowId: session.windowId,
      tabCount: (
        await chrome.tabs.query({ windowId: session.windowId })
      ).filter((tab) => isDebuggableUrl(tab.url)).length,
      idleMsRemaining: Math.max(0, session.idleDeadlineAt - now),
    })),
  )

  return { id: command.id, ok: true, data }
}

async function handleOpenCliBindCurrent(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  const activeTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true })
  const allTabs = await chrome.tabs.query({})
  const findPreferredTab = (tabs: chrome.tabs.Tab[]) =>
    tabs.find(
      (tab) => matchesBindCriteria(tab, command) && !isOwnedAutomationTab(tab),
    ) || tabs.find((tab) => matchesBindCriteria(tab, command))
  const boundTab =
    findPreferredTab(activeTabs) ||
    findPreferredTab(fallbackTabs) ||
    findPreferredTab(allTabs)

  if (!boundTab?.id) {
    const activeTabSummary = activeTabs.map((tab) =>
      summarizeBindCandidateTab(tab, command),
    )
    const fallbackTabSummary = fallbackTabs.map((tab) =>
      summarizeBindCandidateTab(tab, command),
    )
    const allTabSummary = allTabs.map((tab) =>
      summarizeBindCandidateTab(tab, command),
    )
    const windowSummary = await collectWindowDebugSummary().catch(() => [])
    console.warn('[opencli][bind-current] no tab matched', {
      workspace,
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      matchUrl: command.matchUrl,
      matchDomain: command.matchDomain,
      matchPath: command.matchPath,
      matchPathPrefix: command.matchPathPrefix,
      activeTabs: activeTabSummary,
      fallbackTabs: fallbackTabSummary,
      allTabs: allTabSummary,
      windows: windowSummary,
    })
    console.warn(
      '[opencli][bind-current] all tabs flat',
      allTabSummary
        .map(
          (tab) =>
            `tab=${tab.id} win=${tab.windowId} active=${tab.active} matched=${tab.matched} owned=${tab.ownedAutomationTab} url=${tab.url}`,
        )
        .join(' | '),
    )
    console.warn(
      '[opencli][bind-current] windows flat',
      windowSummary
        .map(
          (window) =>
            `window=${window.windowId} focused=${window.focused} type=${window.type} tabs=${window.tabs
              .map(
                (tab) =>
                  `[tab=${tab.id} active=${tab.active} url=${tab.url || tab.pendingUrl || ''}]`,
              )
              .join(',')}`,
        )
        .join(' | '),
    )
    const targetDescription =
      [
        command.matchUrl,
        command.matchDomain,
        command.matchPath,
        command.matchPathPrefix,
      ]
        .filter(Boolean)
        .join(' ') || 'the requested tab'

    return {
      id: command.id,
      ok: false,
      error:
        command.matchUrl ||
        command.matchDomain ||
        command.matchPath ||
        command.matchPathPrefix
          ? `No visible tab matching ${targetDescription}`
          : 'No active debuggable tab found',
    }
  }

  console.log('[opencli][bind-current] selected tab', {
    workspace,
    boundTabId: boundTab.id,
    boundWindowId: boundTab.windowId,
    boundUrl: boundTab.url,
    matchUrl: command.matchUrl,
    ownedAutomationTab: isOwnedAutomationTab(boundTab),
  })
  setWorkspaceSession(workspace, {
    windowId: boundTab.windowId,
    owned: false,
    preferredTabId: boundTab.id,
  })
  resetWindowIdleTimer(workspace)
  console.log(
    `[opencli] Workspace ${workspace} explicitly bound to tab ${boundTab.id} (${boundTab.url})`,
  )

  return {
    id: command.id,
    ok: true,
    data: {
      tabId: boundTab.id,
      windowId: boundTab.windowId,
      url: boundTab.url,
      title: boundTab.title,
      workspace,
    },
  }
}

async function handleOpenCliTemplateTask(
  command: OpenCliCommand,
  workspace: string,
): Promise<OpenCliResult> {
  purgeStaleTemplateTasks()

  if (command.op === 'enqueue') {
    if (!isTemplate(command.template)) {
      return {
        id: command.id,
        ok: false,
        error: 'Missing or invalid template payload',
      }
    }

    const taskId = command.taskId?.trim() || createTemplateTaskId()
    const task: OpenCliTemplateTask = {
      taskId,
      workspace,
      template: command.template,
      targetUrl: command.targetUrl || command.url,
      inputParams: isRecord(command.inputParams) ? command.inputParams : {},
      status: 'queued',
      createdAt: Date.now(),
    }
    openCliTemplateTasks.set(taskId, task)
    openCliTemplateQueue.push(taskId)
    console.log('[opencli][task] enqueue template task', {
      taskId,
      workspace,
      targetUrl: task.targetUrl,
      templateName: task.template.name,
      queueLength: openCliTemplateQueue.length,
    })
    return {
      id: command.id,
      ok: true,
      data: buildTemplateTaskSnapshot(task),
    }
  }

  if (command.op === 'status') {
    const taskId = command.taskId?.trim()
    if (!taskId) {
      return {
        id: command.id,
        ok: false,
        error: 'Missing taskId',
      }
    }

    const task = openCliTemplateTasks.get(taskId)
    if (!task) {
      return {
        id: command.id,
        ok: false,
        error: `Template task ${taskId} not found`,
      }
    }

    return {
      id: command.id,
      ok: true,
      data: buildTemplateTaskSnapshot(task),
    }
  }

  return {
    id: command.id,
    ok: false,
    error: `Unknown template-task op: ${command.op}`,
  }
}

async function handleOpenCliCommand(
  command: OpenCliCommand,
): Promise<OpenCliResult> {
  const workspace = getWorkspaceKey(command.workspace)
  resetWindowIdleTimer(workspace)
  console.log('[opencli][command] received', {
    action: command.action,
    op: command.op,
    workspace,
    tabId: command.tabId,
    url: command.url,
    targetUrl: command.targetUrl,
    matchUrl: command.matchUrl,
    matchDomain: command.matchDomain,
    matchPath: command.matchPath,
    matchPathPrefix: command.matchPathPrefix,
    taskId: command.taskId,
  })

  try {
    switch (command.action) {
      case 'exec':
        return await handleOpenCliExec(command, workspace)
      case 'navigate':
        return await handleOpenCliNavigate(command, workspace)
      case 'tabs':
        return await handleOpenCliTabs(command, workspace)
      case 'cookies':
        return await handleOpenCliCookies(command)
      case 'screenshot':
        return await handleOpenCliScreenshot(command, workspace)
      case 'close-window':
        return await handleOpenCliCloseWindow(command, workspace)
      case 'cdp':
        return await handleOpenCliCdp(command, workspace)
      case 'download-wait':
        return await handleOpenCliDownloadWait(command, workspace)
      case 'sessions':
        return await handleOpenCliSessions(command)
      case 'bind-current':
        return await handleOpenCliBindCurrent(command, workspace)
      case 'template-task':
        return await handleOpenCliTemplateTask(command, workspace)
      default:
        return {
          id: command.id,
          ok: false,
          error: `Unknown action: ${command.action}`,
        }
    }
  } catch (error) {
    return {
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function initializeOpenCliBridge() {
  if (initialized) return
  initialized = true

  patchConsoleForOpenCli()
  registerOpenCliCdpListeners()

  chrome.windows.onCreated.addListener((window) => {
    console.log('[opencli][debug] window created', {
      windowId: window.id,
      focused: window.focused,
      type: window.type,
      automationSessions: [...automationSessions.entries()].map(
        ([workspace, session]) => ({
          workspace,
          windowId: session.windowId,
          owned: session.owned,
          preferredTabId: session.preferredTabId,
        }),
      ),
    })
  })

  chrome.tabs.onCreated.addListener((tab) => {
    console.log('[opencli][debug] tab created', {
      tabId: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      pendingUrl: tab.pendingUrl,
      url: tab.url,
    })
  })

  chrome.windows.onRemoved.addListener((windowId) => {
    for (const [workspace, session] of automationSessions.entries()) {
      if (session.windowId === windowId) {
        console.log(`[opencli] Automation window closed (${workspace})`)
        if (session.idleTimer) clearTimeout(session.idleTimer)
        automationSessions.delete(workspace)
      }
    }
  })

  chrome.runtime.onStartup.addListener(() => {
    connectOpenCliDaemon()
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OPENCLI_KEEPALIVE_ALARM) {
      connectOpenCliDaemon()
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'getStatus') {
      sendResponse({
        connected: openCliWs?.readyState === WebSocket.OPEN,
        reconnecting: reconnectTimer !== null,
      })
    }
    return false
  })

  chrome.alarms.create(OPENCLI_KEEPALIVE_ALARM, { periodInMinutes: 0.4 })
  setInterval(() => {
    consumeOpenCliTemplateTasks().catch((error) => {
      console.error('[opencli] Template task queue error:', error)
    })
  }, OPENCLI_TEMPLATE_TASK_POLL_MS)
  connectOpenCliDaemon()
  console.log('[opencli] OpenCLI bridge initialized')
}
