import { crx, type CrxApplication, type Page } from 'playwright-crx'
import { Browser, browser } from 'wxt/browser'
import { handleLog } from './log-handle'

let originalWindowId = 0 // 原窗口
const taskWindowIdMap = new Map<string, number>() // 每个任务对应的新窗口

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

function isSameTargetPage(currentUrl: string | undefined, targetUrl: string) {
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

export async function createActionTab(
  url: string,
  active: boolean = false,
  newWindow: boolean = false,
): Promise<{
  tab: Browser.tabs.Tab
  page: Page
  crxApp: CrxApplication
  currentWindow: Browser.windows.Window
}> {
  const currentWindow = newWindow
    ? await browser.windows.create({ focused: false }) // 创建新窗口
    : await browser.windows.get(originalWindowId) // 原窗口
  if (!currentWindow?.id) throw new Error('Failed to get window')

  const crxApp = (await crx.get()) || (await crx.start({ slowMo: 500 }))

  const newTab = await browser.tabs.create({
    url,
    active,
    windowId: currentWindow.id,
  })
  if (!newTab.id) throw new Error('Failed to create new tab')

  // 恢复焦点到原窗口，因为 Windows 系统的 chrome 默认行为可能有差异
  const platformInfo = await browser.runtime.getPlatformInfo()
  if (originalWindowId && platformInfo.os === 'win') {
    await browser.windows.update(originalWindowId, { focused: true })
  }

  // 等待页面完全加载
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Tab loading timeout, please check your network.'))
    }, 60000)
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        resolve()
      }
    })
  })

  await removeOtherExtensions(newTab.id)
  const page = await crxApp.attach(newTab.id)
  await page.waitForTimeout(5000)
  return { tab: newTab, page, crxApp, currentWindow }
}

function removeOtherExtensions(tabId: number) {
  return browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      // 解决 YouMind 的干扰
      document.querySelector('#youmind-content-root')?.remove()
    },
  })
}

export async function createActionContext({
  targetUrl,
  tabId,
  taskId,
  workflowTaskId,
}: {
  targetUrl?: string
  tabId: number
  taskId?: string
  workflowTaskId?: string
}) {
  let page: Page
  let crxApp: CrxApplication
  let actualTabId = tabId

  // 记录原窗口
  originalWindowId = (await browser.windows.getCurrent()).id!

  if (targetUrl) {
    const currentTab = await browser.tabs.get(tabId).catch(() => undefined)
    const shouldReuseCurrentTab = isSameTargetPage(currentTab?.url, targetUrl)
    console.log('[opencli][action-context] target url decision', {
      tabId,
      currentUrl: currentTab?.url,
      targetUrl,
      shouldReuseCurrentTab,
      originalWindowId,
    })

    if (shouldReuseCurrentTab) {
      crxApp = (await crx.get()) || (await crx.start({ slowMo: 500 }))
      await removeOtherExtensions(tabId)
      page = await crxApp.attach(tabId)
      actualTabId = tabId
      console.log('[opencli][action-context] reusing current tab', {
        tabId,
        currentUrl: currentTab?.url,
        targetUrl,
      })
      handleLog({
        type: 'reuse_page_context_by_target_url_success',
        body: { targetUrl, currentUrl: currentTab?.url, tabId },
        taskId: workflowTaskId,
      })
    } else {
      // 如果指定目标 URL，创建新窗口来打开新标签页
      console.log('[opencli][action-context] opening new action tab', {
        tabId,
        currentUrl: currentTab?.url,
        targetUrl,
      })
      const result = await createActionTab(targetUrl, true, true)
      page = result.page
      crxApp = result.crxApp
      actualTabId = result.tab.id!
      console.log('[opencli][action-context] created new action tab', {
        sourceTabId: tabId,
        newTabId: actualTabId,
        newWindowId: result.currentWindow.id,
        targetUrl,
      })
      if (taskId) taskWindowIdMap.set(taskId, result.currentWindow.id!)
      handleLog({
        type: 'create_page_context_by_target_url_success',
        body: targetUrl,
        taskId: workflowTaskId,
      })
    }
  } else {
    // 如果没有目标 URL，尝试使用现有的标签页
    crxApp = (await crx.get()) || (await crx.start({ slowMo: 500 }))
    try {
      await removeOtherExtensions(tabId)
      page = await crxApp.attach(tabId)
      handleLog({
        type: 'create_page_context_by_tab_id_success',
        body: tabId,
        taskId: workflowTaskId,
      })
    } catch (error) {
      // 如果现有标签页无法使用，则创建新标签页并切换到该标签页
      const url = await browser.tabs.get(tabId).then((tab) => tab.url)
      if (!url) throw new Error('Failed to get tab URL')
      const result = await createActionTab(url, true)
      page = result.page
      handleLog({
        type: 'create_page_context_by_tab_id_catch_success',
        body: error,
        taskId: workflowTaskId,
      })
    }
  }

  // 显示抓取遮罩在实际操作的页面
  try {
    await browser.tabs.sendMessage(actualTabId, {
      type: 'showScrapingOverlay',
    })
  } catch {
    // 忽略遮罩显示失败，不影响主要逻辑
  }

  return {
    page,
    crxApp,
    actualTabId,
  }
}

export async function closeActionContext({
  targetUrl,
  page,
  crxApp,
  taskId,
  workflowTaskId,
}: {
  targetUrl?: string
  page: Page
  crxApp: CrxApplication
  taskId?: string
  workflowTaskId?: string
}) {
  // 隐藏抓取遮罩 - 广播到所有 tab
  try {
    const allTabs = await browser.tabs.query({})
    await Promise.allSettled(
      allTabs.map((tab) =>
        tab.id
          ? browser.tabs.sendMessage(tab.id, { type: 'hideScrapingOverlay' })
          : Promise.resolve(),
      ),
    )
  } catch {
    // 忽略遮罩隐藏失败
  }

  try {
    if (targetUrl) {
      // 如果是从 workflow 调起的，则关闭新窗口
      if (taskId && taskWindowIdMap.has(taskId)) {
        const winId = taskWindowIdMap.get(taskId)!
        try {
          await browser.windows.remove(winId)
        } finally {
          taskWindowIdMap.delete(taskId)
        }
      } else {
        await crxApp.detach(page)
        await crxApp.close()
      }
    } else {
      // 否则，则保持标签页，但是取消控制
      await crxApp.detach(page)
      await crxApp.close()
    }
    handleLog({
      type: 'close_page_context_success',
      body: targetUrl || 'close by crxApp',
      taskId: workflowTaskId,
    })
  } catch (error) {
    handleLog({
      type: 'close_page_context_error',
      body: error,
      taskId: workflowTaskId,
      level: 'error',
    })
  }
}

export { originalWindowId }
