import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  TimeoutError,
} from '@jackwener/opencli/errors';

export const AISTUDIO_DOMAIN = 'aistudio.google.com';
export const AISTUDIO_HOME = `https://${AISTUDIO_DOMAIN}/prompts/new_chat`;

// A fixed default text model beats "whatever model is currently active": leaving
// the active model alone (e.g. an image model from a prior `image` run) silently
// breaks the text prompt. Google ships new models often, so the hardcoded value
// is rotated by date; OPENCLI_AISTUDIO_MODEL overrides it without editing the
// adapter (e.g. OPENCLI_AISTUDIO_MODEL=gemini-3.6-flash).
export const DEFAULT_AISTUDIO_TEXT_MODEL = String(process.env.OPENCLI_AISTUDIO_MODEL || '').trim()
  || 'gemini-3.7-flash';

const MODEL_ID_RE = /\b(?:gemini|imagen|veo|lyria|gemma)-[a-z0-9][a-z0-9.-]*\b/i;
const MATERIAL_ICON_PREFIX_RE = /^(?:spark|image_edit_auto|video_camera_front|video_spark|music_note|mic|smart_toy)\s+/i;
const MODEL_FILTER_LABELS = Object.freeze({
  all: ['All', '全部'],
  text: ['Gemini', 'Text', '文本'],
  image: ['Images', 'Image', '图像'],
  video: ['Video', '视频'],
  audio: ['Audio', '音频'],
  live: ['Live', '实时'],
  gemma: ['Gemma'],
});

export const AI_STUDIO_SELECTORS = Object.freeze({
  composer: Object.freeze([
    'ms-prompt-box textarea',
    'textarea[aria-label="Enter a prompt"]',
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="提示" i]',
  ]),
  mediaInsert: Object.freeze([
    'ms-add-media-button button[data-test="selectMediaMenu"]',
    'ms-add-media-button button[aria-label="Insert images, videos, or files"]',
    'button[data-test="selectMediaMenu"]',
    'button[aria-label*="Insert images" i]',
    'button[aria-label*="插入" i]',
  ]),
  removeMedia: Object.freeze([
    'ms-prompt-box button[aria-label="Remove media"]',
    'button[aria-label="Remove media"]',
    'button[aria-label*="Remove media" i]',
    'button[aria-label*="移除" i]',
  ]),
  uploadInput: Object.freeze([
    'input[data-test-upload-file-input]',
    'input[type="file"][accept*="image" i]',
    'input[type="file"]',
  ]),
  runButton: Object.freeze([
    'ms-prompt-box ms-run-button button[type="submit"]',
    'ms-run-button button[type="submit"]',
    'ms-prompt-box button[type="submit"]',
  ]),
  modelPickerSearch: Object.freeze([
    'mat-dialog-container input[type="text"][aria-label="Search"]',
    'mat-dialog-container input[type="search"]',
    'mat-dialog-container input[placeholder*="Search" i]',
    'mat-dialog-container input[placeholder*="搜索" i]',
  ]),
});

const AI_STUDIO_SAFETY_CATEGORIES = Object.freeze({
  harassment: 'Harassment',
  hate: 'Hate',
  'sexually explicit': 'Sexually Explicit',
  'dangerous content': 'Dangerous Content',
});

const AI_STUDIO_SAFETY_LEVELS = Object.freeze({
  off: 0,
  'block none': 1,
  'block few': 2,
  'block some': 3,
  'block most': 4,
});

// AI Studio renders quota / safety / network failures inside a model turn as a
// dedicated alert node, not as ordinary reply text. When such a node is present
// it is authoritative for the inline-error classification; the whole-turn text
// scan below is only a fallback and must never fire on benign prose. The
// selector is limited to explicit error surfaces: a substring class match like
// [class*="error"] would flag a normal reply that merely renders an element
// styled "error-handling".
export const AI_STUDIO_ERROR_NODE_SELECTOR =
  '[role="alert"], [aria-live="assertive"], .error-message, [data-error], ms-error-message';

const AI_STUDIO_ERROR_PATTERNS = [
  'error', 'failed', 'unable', 'denied', 'quota', 'unavailable', 'invalid',
  'blocked', 'rejected', 'not permitted', 'not supported', 'exhausted',
  'exceeded', 'too many requests', 'rate limit', 'safety policy', 'harmful',
  'unauthorized', 'login', 'timeout', 'internal error',
  'permission denied', 'caller does not have permission', 'does not have permission',
  'failed to generate content', 'generation failed', 'prohibited',
  'at capacity', 'overloaded', 'safety settings', 'connection lost',
  'connection error', 'network error', 'interrupted', 'try again',
  'please retry', 'server error', 'please try again later',
  'context length', 'context window', 'input too long', 'input is too long',
  'prompt too long', 'prompt is too long', 'message too long', 'message is too long',
  'too many tokens', 'token limit', 'not available',
  'does not have access', 'no access', 'upgrade to', 'subscription',
  'subscribe', 'region not supported', 'not available in your region',
  'temporarily unavailable', 'temporarily down', 'maintenance',
  'bad gateway', 'gateway timeout', 'request body too large', 'payload too large',
  '错误', '失败', '无法', '拒绝', '额度', '配额', '不可用', '无效', '阻止',
  '不支持', '安全策略', '安全政策', '耗尽', '超出', '请求过多', '违规', '超时',
  '未授权', '认证', '登录', '权限不足', '没有权限', '无权', '生成内容失败',
  '网络错误', '网络连接', '连接失败', '连接中断', '请稍后重试', '请稍后再试',
  '请重试', '服务错误', '容量不足', '容量已满', '繁忙', '禁止',
  '上下文长度', '上下文超限', '输入过长', '内容过长', '长度超限', '超出长度',
  '当前地区不可用', '不支持当前地区', '地区不可用', '需要升级', '请升级',
  '订阅', '购买', '无访问权限', '没有访问权限', '暂时不可用', '维护中',
  '服务中断', '请求体过大', '内容过大',
];
const AI_STUDIO_ERROR_RE = new RegExp(AI_STUDIO_ERROR_PATTERNS.map((pattern) => `(?:${pattern})`).join('|'), 'i');

// Broad terms like "error", "failed", or "not available" are legitimate inside a
// normal model reply, so they must never flag an entire model turn. The broad
// set above stays for error containers and status alerts (structurally error
// surfaces); this narrow set is used only when scanning whole model-turn text.
const AI_STUDIO_INLINE_ERROR_PATTERNS = [
  // Whole-turn text fallback, used only when the model turn has no structural
  // error node. Only phrasal idioms that are effectively never part of a normal
  // model reply are listed; bare generic words ("quota", "upgrade", "prohibited",
  // "try again", "rate limit") are intentionally absent because they appear in
  // benign explanations ("The quota system is a useful concept"). A short-turn
  // gate (AI_STUDIO_INLINE_ERROR_MAX_LENGTH) keeps a paragraph that merely
  // *mentions* an error idiom from being misclassified.
  'failed to generate content', 'generation failed', 'content generation failed',
  'safety policy', 'safety settings', 'safety violation',
  'prohibited content', 'prohibited use policy', 'prohibited by our policies',
  'content blocked', 'blocked by content filters', 'flagged as (?:potentially )?harmful',
  'violates our (?:usage |safety )?policies',
  'quota exceeded', 'quota exhausted', 'out of quota', 'exceeded.*quota',
  'rate limit exceeded', 'rate limit reached', 'too many requests',
  'at capacity', 'overloaded',
  'context length exceeded', 'context window exceeded', 'input too long', 'input is too long',
  'prompt too long', 'prompt is too long', 'too many tokens', 'token limit exceeded',
  'please retry', 'please retry later', 'please try again later', 'please try again in',
  'server error', 'internal error', 'bad gateway', 'gateway timeout',
  'unauthorized access', 'authentication required', 'sign in required',
  'please (?:sign|log) in', 'selected model (?:is )?(?:currently )?unavailable',
  'model (?:is )?(?:currently )?unavailable', '(?:generation|request) timed out',
  'temporarily unavailable', 'temporarily down', 'under maintenance', 'maintenance mode',
  'not available in your region', 'region not supported', 'region is not supported',
  'please upgrade', 'upgrade your (?:plan|subscription|account|tier)', 'subscription required',
  '请求过多', '请稍后重试', '请稍后再试', '请重试', '稍后再试',
  '服务错误', '内部错误', '生成内容失败', '生成失败',
  '未授权访问', '请先登录', '需要登录', '所选模型当前不可用', '模型当前不可用',
  '生成请求超时', '生成超时', '请求超时',
  '超出配额', '配额不足', '配额已满', '配额用尽', '额度不足', '额度已满', '超出额度',
  '频率限制', '上下文超限', '上下文长度超限', '输入过长', '内容过长',
  '长度超限', '超出长度', '安全策略', '安全政策', '违反安全',
  '地区不可用', '当前地区不可用', '暂时不可用', '维护中', '服务中断',
  '需要升级', '请升级',
];
const AI_STUDIO_INLINE_ERROR_RE = new RegExp(AI_STUDIO_INLINE_ERROR_PATTERNS.map((pattern) => `(?:${pattern})`).join('|'), 'i');
const AI_STUDIO_INLINE_ERROR_MAX_LENGTH = 240;

// Blocked-content refusals render as a model turn (often with the feedback
// footer) but usually as a full paragraph, which the 240-char inline gate
// rejects. These unmistakable refusal idioms bypass the length gate so a
// blocked generation fails fast instead of idling to the shared deadline.
const AI_STUDIO_BLOCKED_CONTENT_PATTERNS = [
  'prohibited content', 'prohibited by', 'prohibited under', 'blocked content',
  'content blocked', 'request (?:was|has been) blocked', 'was blocked',
  'blocked by (?:our|content|safety|a safety)',
  'can\'t help with that', 'cannot help with that', 'can\'t help you with that',
  'i (?:can\'t|cannot|am not able to) (?:generate|create|produce)',
  'i\'m not able to (?:generate|create|produce)',
  '(?:can\'t|cannot|won\'t) (?:generate|create|produce)',
  'unable to (?:generate|create|produce|fulfill|comply|help)',
  'not able to (?:generate|create|produce|help|assist)',
  'against (?:my|our) (?:safety|guidelines|policies|policy)',
  'violates? (?:my|our|the) (?:safety|guidelines|policies|policy|content)',
  'content (?:filters?|filtering)', 'refus(?:ed|es|e)? to (?:generate|create|produce|respond)',
  'not permitted', 'not appropriate', 'cannot help', 'doesn\'t (?:allow|permit)',
  'model (?:can\'t|cannot) (?:generate|create)', 'won\'t be able to',
  '无法生成', '不能生成', '无法创建', '不能创建', '无法帮助', '无法完成', '无法做到', '无法提供',
  '拒绝生成', '拒绝创建', '不允许', '不符合', '违反安全', '违反政策',
  '抱歉，?我?(?:无法|不能|帮不了)', '对不起，?我?(?:无法|不能|帮不了)',
  '不能这么做', '无法满足',
];
const AI_STUDIO_BLOCKED_CONTENT_RE = new RegExp(AI_STUDIO_BLOCKED_CONTENT_PATTERNS.map((pattern) => `(?:${pattern})`).join('|'), 'i');
const AI_STUDIO_BLOCKED_CONTENT_MAX_LENGTH = 3000;

const AI_STUDIO_GENERATING_RE = /^(?:stop|cancel|停止生成|取消)(?:\s|$)/i;

export function createAIStudioDeadline(timeoutSeconds) {
  const timeout = requirePositiveInteger(timeoutSeconds, '--timeout');
  return {
    startedAt: Date.now(),
    expiresAt: Date.now() + timeout * 1000,
    timeout,
  };
}

function remainingAIStudioSeconds(deadline) {
  return Math.max(0, Math.ceil((deadline.expiresAt - Date.now()) / 1000));
}

function assertAIStudioDeadline(deadline, stage) {
  const remaining = remainingAIStudioSeconds(deadline);
  if (remaining < 1) {
    throw new TimeoutError(
      `AI Studio ${stage}`,
      deadline.timeout,
      `The shared --timeout deadline expired before ${stage} completed.`,
    );
  }
  return remaining;
}

function capAIStudioDeadline(deadline, maxSeconds) {
  if (!deadline || !Number.isFinite(Number(maxSeconds))) return deadline;
  return {
    ...deadline,
    expiresAt: Math.min(deadline.expiresAt, Date.now() + Number(maxSeconds) * 1000),
  };
}

export async function waitForAIStudioState(page, context, readState, isReady, options = {}) {
  if (typeof readState !== 'function' || typeof isReady !== 'function') {
    throw new ArgumentError(`${context} requires state reader and readiness predicate`);
  }
  const baseDeadline = options.deadline || createAIStudioDeadline(options.timeoutSeconds || 10);
  const deadline = capAIStudioDeadline(baseDeadline, options.maxSeconds);
  const pollSeconds = options.pollSeconds ?? 0.1;
  let attempt = 0;
  while (Date.now() < deadline.expiresAt) {
    assertAIStudioDeadline(deadline, context);
    const state = await readState();
    if (isReady(state)) return state;
    const requestedPoll = typeof pollSeconds === 'function'
      ? Number(pollSeconds(attempt, state))
      : Number(pollSeconds);
    const delay = Number.isFinite(requestedPoll) ? Math.max(0.05, requestedPoll) : 0.1;
    const remaining = Math.max(0, (deadline.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) break;
    if (typeof page.wait === 'function') await page.wait(Math.min(delay, remaining));
    attempt += 1;
  }
  throw new TimeoutError(
    context,
    baseDeadline.timeout,
    options.timeoutMessage || `AI Studio did not expose the expected DOM state before ${context} timed out.`,
  );
}

export function aiStudioTurnFingerprint(turn) {
  const role = String(turn?.role || 'unknown');
  const text = normalizeSpaces(turn?.text || '');
  const images = Array.isArray(turn?.images)
    ? turn.images.map((image) => String(image?.src || '')).filter(Boolean)
    : [];
  return JSON.stringify({ role, text, images });
}

export function findNewAIStudioTurns(snapshot, baseline, role = null) {
  const counts = new Map();
  for (const turn of Array.isArray(baseline?.turns) ? baseline.turns : []) {
    const key = aiStudioTurnFingerprint(turn);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const result = [];
  for (const turn of Array.isArray(snapshot?.turns) ? snapshot.turns : []) {
    const key = aiStudioTurnFingerprint(turn);
    const count = counts.get(key) || 0;
    if (count > 0) {
      counts.set(key, count - 1);
      continue;
    }
    if (!role || turn.role === role) result.push(turn);
  }
  return result;
}

function isAIStudioMediaTextPair(turns, expectedPrompt) {
  if (!Array.isArray(turns) || turns.length < 2) return false;

  const normalizeAlphaNum = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const expectedAlphaNum = normalizeAlphaNum(expectedPrompt);
  
  const isTextMatch = (turnText) => {
    if (!turnText) return false;
    const turnAlphaNum = normalizeAlphaNum(turnText);
    if (!turnAlphaNum) return false;
    if (expectedAlphaNum === turnAlphaNum || expectedAlphaNum.includes(turnAlphaNum)) return true;
    let sharedPrefix = 0;
    const maxShared = Math.min(expectedAlphaNum.length, turnAlphaNum.length);
    while (sharedPrefix < maxShared && expectedAlphaNum[sharedPrefix] === turnAlphaNum[sharedPrefix]) sharedPrefix += 1;
    return sharedPrefix >= Math.min(200, turnAlphaNum.length) && sharedPrefix >= turnAlphaNum.length * 0.5;
  };
  
  const promptMatches = turns.filter((turn) => isTextMatch(turn?.text));
  // A media chunk must carry actual media; a second text-only user turn is a
  // duplicate-submission signal, not a media chunk.
  const mediaTurns = turns.filter((turn) => (
    turn.hasMedia
    || (Array.isArray(turn?.images) && turn.images.length > 0)
  ));
  return promptMatches.length === 1
    && mediaTurns.length === turns.length - 1
    && turns.every((turn) => mediaTurns.includes(turn) || isTextMatch(turn?.text));
}

export function getAIStudioSubmissionEvidence(snapshot, baseline, expectedPrompt = '') {
  const newUserTurns = findNewAIStudioTurns(snapshot, baseline, 'user');
  if (newUserTurns.length > 1) {
    if (isAIStudioMediaTextPair(newUserTurns, expectedPrompt)) {
      return { ok: true, reason: 'new-user-turn-with-media-chunk', newUserTurns };
    }
    return { ok: false, reason: 'multiple-new-user-turns', newUserTurns };
  }
  if (newUserTurns.length === 1) {
    return { ok: true, reason: 'new-user-turn', newUserTurns };
  }

  const beforeCount = Array.isArray(baseline?.turns) ? baseline.turns.length : 0;
  const currentCount = Array.isArray(snapshot?.turns) ? snapshot.turns.length : 0;
  const composerCleared = String(snapshot?.composerText || '') === '';
  const promptChanged = String(snapshot?.composerText || '') !== String(expectedPrompt || '');
  if (snapshot?.isGenerating && currentCount > beforeCount && composerCleared && promptChanged && snapshot?.runButtonDisabled) {
    return { ok: true, reason: 'generating-with-turn-growth', newUserTurns: [] };
  }
  const newModelTurns = findNewAIStudioTurns(snapshot, baseline, 'model');
  if (currentCount > beforeCount && composerCleared && promptChanged && (snapshot?.isGenerating || snapshot?.runButtonDisabled || newModelTurns.length > 0)) {
    return { ok: true, reason: 'turn-growth-with-cleared-composer', newUserTurns: [] };
  }
  return { ok: false, reason: 'no-submission-signal', newUserTurns: [] };
}

export function isAIStudioErrorText(value) {
  return AI_STUDIO_ERROR_RE.test(String(value || ''));
}

export function isAIStudioInlineErrorText(value) {
  const text = String(value || '');
  return text.length > 0
    && text.length <= AI_STUDIO_INLINE_ERROR_MAX_LENGTH
    && AI_STUDIO_INLINE_ERROR_RE.test(text);
}

export function validateAIStudioImageAsset(asset) {
  const dataUrl = String(asset?.dataUrl || '');
  const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  if (!match || !match[1].trim()) return { ok: false, reason: 'missing image data' };
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) return { ok: false, reason: 'image data is empty' };
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    return { ok: false, reason: 'image dimensions are invalid' };
  }
  // A generated image must have real render proportions; sub-512 assets are
  // UI fragments (icons, error banners) masquerading as results.
  if (width < 512 || height < 512) {
    return { ok: false, reason: `image is too small (${width}x${height}); not a generated picture` };
  }
  return { ok: true, bytes: bytes.length, width, height };
}

export async function readAIStudioPageAlerts(page) {
  return evaluatePage(page, 'AI Studio page alerts', (
    errorPattern,
    inlineErrorPattern,
    blockedContentPattern,
    maxInlineErrorLength,
    blockedContentMaxLength,
  ) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const errorRe = new RegExp(errorPattern, 'i');
    const inlineErrorRe = new RegExp(inlineErrorPattern, 'i');
    const blockedContentRe = new RegExp(blockedContentPattern, 'i');
    return Array.from(document.querySelectorAll(
      '[role="alert"], [aria-live="assertive"], mat-snack-bar-container, .mat-mdc-snack-bar-label, .error-message, ms-error-message, [data-error]',
    )).flatMap((element) => {
      const text = normalize(element.innerText || element.textContent);
      const metadata = `${element.className || ''} ${element.getAttribute('aria-label') || ''}`;
      const searchable = `${metadata} ${text}`;
      const explicitSurface = element.matches('.error-message, ms-error-message, [data-error]');
      const snackbarSurface = element.matches('mat-snack-bar-container, .mat-mdc-snack-bar-label');
      const liveRegionError = (text.length <= maxInlineErrorLength && inlineErrorRe.test(searchable))
        || (text.length <= blockedContentMaxLength && blockedContentRe.test(searchable));
      return text && (explicitSurface || (snackbarSurface ? errorRe.test(searchable) : liveRegionError))
        ? [text]
        : [];
    });
  },
  AI_STUDIO_ERROR_RE.source,
  AI_STUDIO_INLINE_ERROR_RE.source,
  AI_STUDIO_BLOCKED_CONTENT_RE.source,
  AI_STUDIO_INLINE_ERROR_MAX_LENGTH,
  AI_STUDIO_BLOCKED_CONTENT_MAX_LENGTH);
}

function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unwrapEvaluateResult(value, context) {
  if (isObjectRecord(value) && Object.prototype.hasOwnProperty.call(value, 'session')) {
    if (Object.prototype.hasOwnProperty.call(value, 'data')) return value.data;
    throw new CommandExecutionError(`${context} returned a malformed Browser Bridge envelope`);
  }
  return value;
}

async function evaluatePage(page, context, fn, ...args) {
  return unwrapEvaluateResult(await page.evaluate(fn, ...args), context);
}

async function closeAIStudioTransientOverlays(page, options = {}) {
  if (typeof page.nativeKeyPress === 'function') {
    try { await page.nativeKeyPress('Escape'); } catch (_) {}
  } else if (typeof page.pressKey === 'function') {
    try { await page.pressKey('Escape'); } catch (_) {}
  }
  await evaluatePage(page, 'AI Studio close transient overlays', () => {
    const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"]'));
    for (const element of expanded) element.dispatchEvent(new KeyboardEvent('keydown', init));
    document.dispatchEvent(new KeyboardEvent('keydown', init));
    document.dispatchEvent(new KeyboardEvent('keyup', init));
    return expanded.length;
  });
  await waitForAIStudioState(
    page,
    'AI Studio transient overlays close',
    () => evaluatePage(page, 'AI Studio transient overlay state', () => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter(visible).length;
    }),
    (remaining) => remaining === 0,
    {
      deadline: options.deadline,
      timeoutSeconds: 3,
      maxSeconds: 3,
      pollSeconds: 0.1,
      timeoutMessage: 'A transient AI Studio overlay did not close after Escape.',
    },
  );
}

export function normalizeSpaces(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeAIStudioPrompt(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function compactComparable(value) {
  return normalizeSpaces(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function modelCategory(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('image') || id.startsWith('imagen-')) return 'image';
  if (id.includes('video') || id.startsWith('veo-')) return 'video';
  if (id.includes('audio') || id.includes('tts') || id.startsWith('lyria-')) return 'audio';
  if (id.includes('live')) return 'live';
  if (id.startsWith('gemma-')) return 'gemma';
  return 'text';
}

export function parseModelCardText(rawText) {
  const raw = normalizeSpaces(rawText);
  const match = raw.match(MODEL_ID_RE);
  if (!match) return null;

  const model = match[0].toLowerCase();
  const prefix = raw.slice(0, match.index).trim();
  const name = prefix
    .replace(MATERIAL_ICON_PREFIX_RE, '')
    .replace(/\b(?:New|Paid)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const suffix = raw.slice((match.index ?? 0) + match[0].length).trim();
  const infoMatch = suffix.match(/\binfo\b\s*/i);
  const descriptionStart = infoMatch ? suffix.slice((infoMatch.index ?? 0) + infoMatch[0].length) : suffix;
  const description = descriptionStart
    .split(/\s+(?:attach_money|network_intelligence_history|rocket_launch|developer_guide)\s+/i)[0]
    .replace(MATERIAL_ICON_PREFIX_RE, '')
    .trim();

  return {
    model,
    name: name || model,
    category: modelCategory(model),
    availability: /\bPaid\b/i.test(prefix) ? 'paid' : 'available',
    description: description || null,
  };
}

export function filterModels(models, { category = 'all', query = '' } = {}) {
  const normalizedCategory = String(category || 'all').toLowerCase();
  const normalizedQuery = normalizeSpaces(query).toLowerCase();
  return models.filter((row) => {
    if (normalizedCategory !== 'all' && row.category !== normalizedCategory) return false;
    if (!normalizedQuery) return true;
    return `${row.model} ${row.name} ${row.description || ''}`.toLowerCase().includes(normalizedQuery);
  });
}

export function resolveModelChoice(models, requested, requiredCategory = null) {
  const raw = normalizeSpaces(requested);
  if (!raw) throw new ArgumentError('--model must not be empty');

  const allowed = requiredCategory
    ? models.filter((row) => row.category === requiredCategory)
    : models;
  const lower = raw.toLowerCase();
  const compact = compactComparable(raw);
  const exact = allowed.find((row) => row.model.toLowerCase() === lower)
    ?? allowed.find((row) => row.name.toLowerCase() === lower)
    ?? allowed.find((row) => compactComparable(row.name) === compact);
  if (exact) return exact;

  const matches = allowed.filter((row) => {
    return row.model.toLowerCase().includes(lower)
      || row.name.toLowerCase().includes(lower)
      || compactComparable(row.name).includes(compact);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ArgumentError(
      `--model "${raw}" is ambiguous. Matches: ${matches.map((row) => row.model).join(', ')}`,
      'Use `opencli aistudio models` to choose a canonical model id.',
    );
  }
  throw new ArgumentError(
    `Unknown AI Studio model "${raw}".`,
    'Run `opencli aistudio models` to list models visible to the current account.',
  );
}

function parseModelCardTexts(texts) {
  const seen = new Set();
  return (Array.isArray(texts) ? texts : []).flatMap((text) => {
    const row = parseModelCardText(text);
    if (!row || seen.has(row.model)) return [];
    seen.add(row.model);
    return [row];
  });
}

export function resolveAIStudioModelSearchResult(cardTexts, requested, requiredCategory = null) {
  const models = parseModelCardTexts(cardTexts);
  const selected = resolveModelChoice(models, requested, requiredCategory);
  return { models, selected };
}

export function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  return number;
}

export function requireFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ArgumentError(`${label} must be a finite number`);
  return number;
}

export function parseAIStudioStringList(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  let values;
  if (Array.isArray(value)) {
    values = value;
  } else {
    const raw = String(value).trim();
    if (raw.startsWith('[')) {
      try {
        values = JSON.parse(raw);
      } catch {
        throw new ArgumentError(`${label} must be a comma-separated list or a JSON string array`);
      }
    } else {
      values = raw.split(',');
    }
  }
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
    throw new ArgumentError(`${label} must be a comma-separated list or a JSON string array`);
  }
  const normalized = values.map((item) => String(item).trim());
  if (normalized.some((item) => !item)) throw new ArgumentError(`${label} must not contain empty values`);
  return [...new Set(normalized)];
}

export function parseAIStudioJsonObject(value, label) {
  if (value === undefined || value === null) return undefined;
  if (isObjectRecord(value)) return value;
  const raw = String(value).trim();
  if (!raw) throw new ArgumentError(`${label} must be a JSON object`);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ArgumentError(`${label} must be a JSON object`);
  }
  if (!isObjectRecord(parsed)) throw new ArgumentError(`${label} must be a JSON object`);
  return parsed;
}

function normalizeAIStudioSettingToken(value) {
  return normalizeSpaces(value).toLowerCase().replace(/[_-]+/g, ' ');
}

function resolveAIStudioOption(label, requested, available) {
  const requestedToken = normalizeAIStudioSettingToken(requested);
  const aliases = {
    'thinking level': {
      minimal: ['minimal', 'none', '无', '最小', '最低'],
      none: ['minimal', 'none', '无', '最小', '最低'],
      low: ['low', '低'],
      medium: ['medium', '中', '中等'],
      high: ['high', '高'],
    },
    'media resolution': {
      default: ['default', '默认'],
      low: ['low', '低'],
      medium: ['medium', '中', '中等'],
      high: ['high', '高'],
    },
  }[normalizeAIStudioSettingToken(label)] || {};
  const requestedAliases = new Set(
    aliases[requestedToken]
      || Object.values(aliases).find((group) => group.includes(requestedToken))
      || [requestedToken],
  );
  return available.find((option) => {
    const optionToken = normalizeAIStudioSettingToken(option);
    return requestedAliases.has(optionToken);
  }) || null;
}

function canonicalAIStudioSafetyCategory(value) {
  const token = normalizeAIStudioSettingToken(value);
  if (!token) {
    throw new ArgumentError(
      'Safety category must not be empty',
      `Use one of: ${Object.values(AI_STUDIO_SAFETY_CATEGORIES).join(', ')}`,
    );
  }
  // Category names are a wire-level contract. Fuzzy substring matching made an
  // empty key resolve to the first category (Harassment), and let short prefixes
  // such as "h" silently target the wrong slider. Accept the canonical
  // key or its displayed label only; threshold values remain separately flexible.
  const key = Object.keys(AI_STUDIO_SAFETY_CATEGORIES).find((candidate) => {
    const label = normalizeAIStudioSettingToken(AI_STUDIO_SAFETY_CATEGORIES[candidate]);
    return token === candidate || token === label;
  });
  if (!key) {
    throw new ArgumentError(
      `Unknown safety category "${value}"`,
      `Use one of: ${Object.values(AI_STUDIO_SAFETY_CATEGORIES).join(', ')}`,
    );
  }
  return AI_STUDIO_SAFETY_CATEGORIES[key];
}

function resolveAIStudioSafetyThreshold(raw, min, max, category) {
  const numeric = Number(raw);
  if (String(raw).trim() !== '' && Number.isFinite(numeric)) {
    if (numeric < min || numeric > max) throw new ArgumentError(`${category} safety threshold must be between ${min} and ${max}`);
    return numeric;
  }
  const level = AI_STUDIO_SAFETY_LEVELS[normalizeAIStudioSettingToken(raw)];
  if (level === undefined) {
    throw new ArgumentError(
      `${category} safety threshold must be Off, Block none, Block few, Block some, Block most, or a number`,
    );
  }
  const resolved = min + level;
  if (resolved < min || resolved > max) {
    throw new ArgumentError(`${category} safety control does not expose the expected five threshold levels`);
  }
  return resolved;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);

function imageMimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.heic') return 'image/heic';
  if (extension === '.heif') return 'image/heif';
  return 'image/jpeg';
}

export function prepareAIStudioImagePaths(imagePaths) {
  const values = (Array.isArray(imagePaths) ? imagePaths : [imagePaths]).filter(Boolean);
  const resolved = values.map((filePath) => path.resolve(String(filePath)));
  for (const filePath of resolved) {
    if (!fs.existsSync(filePath)) throw new ArgumentError(`Image not found: ${filePath}`);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new ArgumentError(`Image path is not a file: ${filePath}`);
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      throw new ArgumentError(`Unsupported image type: ${filePath}`);
    }
    if (stat.size > 25 * 1024 * 1024) {
      throw new ArgumentError(`Image is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB): ${filePath}`, 'Maximum size is 25 MB per image.');
    }
  }
  return resolved;
}

const UPLOAD_CHUNK_SIZE = 64 * 1024;
const UPLOAD_CHUNK_THRESHOLD = 256 * 1024;
const UPLOAD_WINDOW_KEY = '__opencliAistudioUpload';

// Fall back to DOM injection when CDP setFileInput is unavailable or rejected.
// Small files are injected in a single evaluate; larger base64 payloads are
// accumulated on the page in ~64KB chunks so the daemon body size stays small.
export async function injectAIStudioFiles(page, files, inputSelector) {
  const totalBase64 = files.reduce((sum, file) => sum + file.base64.length, 0);
  if (totalBase64 <= UPLOAD_CHUNK_THRESHOLD) {
    return evaluatePage(page, 'AI Studio image upload fallback', (items, selector) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'file input not found' };
      const transfer = new DataTransfer();
      for (const item of items) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], item.name, { type: item.mime }));
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: input.files.length === items.length, count: input.files.length };
    }, files, inputSelector);
  }

  // A per-call key keeps concurrent uploads from overwriting each other and lets
  // us delete the accumulated base64 once the file is assembled.
  const windowKey = `${UPLOAD_WINDOW_KEY}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const totals = files.map((file) => file.base64.length);
  const init = await evaluatePage(page, 'AI Studio image upload chunk init', (selector, expectedTotals) => {
    window[selector] = { chunks: expectedTotals.map(() => ''), totals: expectedTotals, ready: false };
    return { ok: true };
  }, windowKey, totals);
  if (!init?.ok) return { ok: false, reason: 'upload init failed' };

  const cleanupUploadWindow = () => evaluatePage(page, 'AI Studio image upload cleanup', (key) => {
    delete window[key];
    return { ok: true };
  }, windowKey).catch(() => {});

  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const base64 = files[fileIndex].base64;
      for (let offset = 0; offset < base64.length; offset += UPLOAD_CHUNK_SIZE) {
        const chunk = base64.slice(offset, offset + UPLOAD_CHUNK_SIZE);
        const pushed = await evaluatePage(page, 'AI Studio image upload chunk', (chunkText, key, index) => {
          window[key].chunks[index] += chunkText;
          return { ok: true };
        }, chunk, windowKey, fileIndex);
        if (!pushed?.ok) return { ok: false, reason: 'upload chunk failed' };
      }
    }

    return await evaluatePage(page, 'AI Studio image upload assemble', (key, inputSel, meta) => {
      const upload = window[key];
      if (!upload) return { ok: false, reason: 'upload window missing' };
      if (!upload.ready) {
        const complete = upload.chunks.every((value, index) => value.length === upload.totals[index]);
        if (!complete) return { ok: false, reason: 'upload chunks incomplete' };
        const items = meta.map((item, index) => {
          const binary = atob(upload.chunks[index]);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          return { name: item.name, mime: item.mime, bytes };
        });
        const input = document.querySelector(inputSel);
        if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'file input not found' };
        const transfer = new DataTransfer();
        for (const item of items) transfer.items.add(new File([item.bytes], item.name, { type: item.mime }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        upload.ready = true;
        const ok = input.files.length === items.length;
        delete window[key];
        return { ok, count: ok ? input.files.length : 0 };
      }
      return { ok: true, count: 0 };
    }, windowKey, inputSelector, files.map((file) => ({ name: file.name, mime: file.mime })));
  } finally {
    // A failed chunk push, an assemble exception, or a mid-upload re-render would
    // otherwise leave the base64 accumulation window behind; drop it so a retry
    // never carries stale upload state. Idempotent after a successful assemble.
    await cleanupUploadWindow();
  }
}

export async function uploadAIStudioImages(page, imagePaths, options = {}) {
  const paths = prepareAIStudioImagePaths(imagePaths);
  if (!paths.length) return [];

  const baselineCount = await evaluatePage(page, 'AI Studio existing media count', (selectors) => {
    const nodes = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) nodes.add(node);
    }
    return nodes.size;
  }, AI_STUDIO_SELECTORS.removeMedia);
  const opened = await evaluatePage(page, 'AI Studio insert media menu', (selectors) => {
    const button = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: !button ? 'button not found' : 'button disabled' };
    }
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
    return { ok: true, alreadyOpen: button.getAttribute('aria-expanded') === 'true' };
  }, AI_STUDIO_SELECTORS.mediaInsert);
  if (!opened?.ok) {
    throw new CommandExecutionError(
      'AI Studio media insert button was not found or is disabled',
      opened?.reason || 'Inspect the retained tab for the visible media control.',
    );
  }
  const inputSelector = await waitForAIStudioState(
    page,
    'AI Studio file input',
    () => evaluatePage(page, 'AI Studio file input', (selectors) => {
      return selectors.find((selector) => document.querySelector(selector) instanceof HTMLInputElement) || null;
    }, AI_STUDIO_SELECTORS.uploadInput),
    (selector) => !!selector,
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: 'AI Studio did not expose a file input after opening the media menu.',
    },
  );

  let uploaded = false;
  if (typeof page.setFileInput === 'function') {
    try {
      await page.setFileInput(paths, inputSelector);
      uploaded = true;
    } catch (error) {
      const message = String(error?.message || error);
      if (!/Unknown action|not supported|Not allowed|No element found|sendCommand|max attempts|BrowserCommandError|Target closed|No node with given id/i.test(message)) throw error;
    }
  }

  if (!uploaded) {
    const files = paths.map((filePath) => ({
      name: path.basename(filePath),
      mime: imageMimeFromPath(filePath),
      base64: fs.readFileSync(filePath).toString('base64'),
    }));
    const injected = await injectAIStudioFiles(page, files, inputSelector);
    if (!injected?.ok) {
      throw new CommandExecutionError(`Failed to attach image to AI Studio: ${injected?.reason || 'browser injection failed'}`);
    }
  }

  const uploadAlerts = await readAIStudioPageAlerts(page);
  if (uploadAlerts.length) {
    throw new CommandExecutionError(`AI Studio rejected the upload: ${uploadAlerts.join(' | ')}`);
  }

  const expectedCount = Number(baselineCount || 0) + paths.length;
  let previousReadySignature = '';
  let stableReadySamples = 0;
  try {
    await waitForAIStudioState(
      page,
      'AI Studio image upload preview',
      () => evaluatePage(page, 'AI Studio image upload preview', (selectors) => {
        const nodes = new Set();
        for (const selector of selectors) {
          for (const node of document.querySelectorAll(selector)) nodes.add(node);
        }
        const mediaRoot = document.querySelector('ms-prompt-media') || document.querySelector('ms-prompt-box');
        const busyText = Array.from(mediaRoot?.querySelectorAll('[aria-busy="true"], mat-progress-spinner, [role="progressbar"]') || [])
          .map((node) => `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`)
          .join(' ');
        return {
          count: nodes.size,
          busy: /upload|上传|processing|处理中/i.test(busyText),
          tokenStatus: String(mediaRoot?.querySelector('ms-token-status')?.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      }, AI_STUDIO_SELECTORS.removeMedia),
      (state) => {
        if (state.count >= expectedCount && !state.busy) {
          const readySignature = `${state.count}|${state.busy}|${state.tokenStatus}`;
          stableReadySamples = readySignature === previousReadySignature ? stableReadySamples + 1 : 1;
          previousReadySignature = readySignature;
          return stableReadySamples >= 2;
        }
        previousReadySignature = '';
        stableReadySamples = 0;
        return false;
      },
      {
        deadline: options.deadline,
        timeoutSeconds: 10,
        maxSeconds: 10,
        pollSeconds: 0.2,
        timeoutMessage: 'The file was attached to the browser input, but AI Studio did not confirm it with a media preview.',
      },
    );
  } catch (error) {
    const alerts = await readAIStudioPageAlerts(page).catch(() => []);
    if (alerts.length) {
      throw new CommandExecutionError(`AI Studio rejected the upload: ${alerts.join(' | ')}`);
    }
    throw error;
  }
  await closeAIStudioTransientOverlays(page, { deadline: options.deadline });
  return paths;
}

export async function getAIStudioPageState(page) {
  return evaluatePage(page, 'AI Studio page state', (composerSelectors) => {
    const url = window.location.href;
    const composerSelector = composerSelectors.find((selector) => document.querySelector(selector)) || null;
    const composer = composerSelector ? document.querySelector(composerSelector) : null;
    const account = document.querySelector('ms-account-switcher [role="button"], #account-switcher-button [role="button"]');
    const signIn = Array.from(document.querySelectorAll('a, button')).some((element) => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return /^(sign in|log in|登录|登入)$/i.test(`${text || aria}`);
    });
    const blockingDialog = Array.from(document.querySelectorAll('mat-dialog-container')).flatMap((dialog) => {
      const style = window.getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return [];
      const text = String(dialog.innerText || dialog.textContent || '').replace(/\s+/g, ' ').trim();
      return text ? [text] : [];
    }).find((text) => /get started|continue|accept|同意|继续|接受|region|地区|upgrade|升级|subscription|订阅|sign in|log in|登录|登入/i.test(text)) || null;
    const selector = document.querySelector('ms-model-selector');
    const selectorText = String(selector?.innerText || selector?.textContent || '');
    const modelMatch = selectorText.match(/\b(?:gemini|imagen|veo|lyria|gemma)-[a-z0-9][a-z0-9.-]*\b/i);
    return {
      url,
      title: document.title,
      hasComposer: !!composer,
      composerSelector,
      signedIn: !!account || (!!composer && !signIn),
      signInVisible: signIn,
      blockingDialog,
      currentModel: modelMatch ? modelMatch[0].toLowerCase() : null,
    };
  }, AI_STUDIO_SELECTORS.composer);
}

// Navigation is subject to the same shared --timeout budget as every wait: a
// hung goto must not outlive the command deadline. Falls back to the bridge
// default (30s) when no deadline is supplied.
async function navigateAIStudioPage(page, url, options = {}) {
  if (options.deadline) assertAIStudioDeadline(options.deadline, 'navigation');
  const remaining = options.deadline ? options.deadline.expiresAt - Date.now() : 30_000;
  const timeout = options.deadline
    ? Math.min(30_000, Math.max(1, remaining))
    : 30_000;
  await page.goto(url, { waitUntil: 'load', timeout });
}

export async function ensureAIStudioPage(page, options = {}) {
  let state = await getAIStudioPageState(page).catch(() => null);
  let needsNavigation = true;
  if (state?.url) {
    try {
      const url = new URL(state.url);
      needsNavigation = url.hostname !== AISTUDIO_DOMAIN || !url.pathname.startsWith('/prompts/');
    } catch {}
  }

  if (needsNavigation) {
    await navigateAIStudioPage(page, AISTUDIO_HOME, options);
  }

  return waitForAIStudioState(
    page,
    'AI Studio prompt editor readiness',
    () => getAIStudioPageState(page),
    (current) => {
      if (current?.signInVisible || current?.url?.includes('accounts.google.com')) {
      throw new AuthRequiredError(AISTUDIO_DOMAIN, 'Google AI Studio requires a signed-in Google account');
      }
      if (current?.blockingDialog) {
        throw new CommandExecutionError(
          `Google AI Studio is showing a blocking dialog: ${current.blockingDialog.slice(0, 240)}`,
          'Complete the consent, region, or upgrade flow in the retained tab, then retry.',
        );
      }
      return !!current?.hasComposer;
    },
    {
      deadline: options.deadline,
      timeoutSeconds: 15,
      maxSeconds: 15,
      pollSeconds: 0.2,
      timeoutMessage: 'Google AI Studio prompt editor did not become ready.',
    },
  );
}

export async function startNewAIStudioChat(page, options = {}) {
  await navigateAIStudioPage(page, AISTUDIO_HOME, options);
  return ensureAIStudioPage(page, options);
}

async function ensureRunSettings(page, options = {}) {
  const found = await evaluatePage(page, 'AI Studio run settings', () => {
    const root = document.querySelector('ms-run-settings');
    if (root && root.querySelector('ms-model-selector')) return 'ready';
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const opener = buttons.find((element) => {
      const aria = String(element.getAttribute('aria-label') || '');
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return /run settings|运行设置/i.test(`${aria} ${text}`);
    });
    if (!opener) return 'missing';
    opener.click();
    return 'opened';
  });
  if (found === 'opened') {
    await waitForAIStudioState(
      page,
      'AI Studio run settings panel',
      () => evaluatePage(page, 'AI Studio run settings readiness', () => {
        return !!document.querySelector('ms-run-settings ms-model-selector');
      }),
      (ready) => ready,
      {
        deadline: options.deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio run settings did not finish opening.',
      },
    );
  }
  const ready = await evaluatePage(page, 'AI Studio run settings readiness', () => {
    return !!document.querySelector('ms-run-settings ms-model-selector');
  });
  if (!ready) {
    throw new CommandExecutionError('AI Studio run settings panel or model selector was not found');
  }
}

async function openModelPicker(page, category = null, { preserveSearch = false, deadline } = {}) {
  await ensureAIStudioPage(page, { deadline });
  await ensureRunSettings(page, { deadline });
  const pickerState = await evaluatePage(page, 'AI Studio model picker', () => {
    const existing = Array.from(document.querySelectorAll('mat-dialog-container')).find((dialog) => {
      const text = String(dialog.textContent || '').replace(/\s+/g, ' ').trim();
      return /model selection|select (?:a )?model|模型/i.test(text)
        && !!dialog.querySelector('input[type="search"], input[placeholder*="Search" i], input[placeholder*="搜索" i], .content-button');
    });
    if (existing) return 'already-open';
    const button = document.querySelector('ms-model-selector button.model-selector-card, ms-model-selector button');
    if (!button) return 'missing';
    button.click();
    return 'opened';
  });
  if (pickerState === 'missing') throw new CommandExecutionError('AI Studio model picker button was not found');
  if (pickerState === 'opened') {
    await waitForAIStudioState(
      page,
      'AI Studio model picker',
      () => evaluatePage(page, 'AI Studio model picker readiness', () => {
        const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
          return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
        });
        return {
          dialogFound: !!dialog,
          searchFound: !!dialog?.querySelector('input[type="search"], input[placeholder*="Search" i], input[placeholder*="搜索" i]'),
          cardCount: dialog?.querySelectorAll('.content-button').length || 0,
        };
      }),
      (state) => state.dialogFound && (state.searchFound || state.cardCount > 0),
      {
        deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio model picker did not finish opening.',
      },
    );
  }
  const filterLabels = MODEL_FILTER_LABELS[String(category || '').toLowerCase()] || null;
  const normalized = await evaluatePage(page, 'AI Studio model picker filters', (wantedFilter, keepSearch) => {
    const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
      return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
    });
    if (!dialog) return { ok: false, changed: false };
    let changed = false;
    const search = dialog.querySelector('input[type="text"][aria-label="Search"], input[type="search"], input[placeholder*="Search" i], input[placeholder*="搜索" i]');
    if (!keepSearch && search instanceof HTMLInputElement && search.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(search, '');
      else search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const filter = Array.isArray(wantedFilter) && wantedFilter.length
      ? Array.from(dialog.querySelectorAll('button, [role="tab"], [role="button"]')).find((button) => {
        const text = normalize(button.textContent);
        const aria = normalize(button.getAttribute('aria-label'));
        return wantedFilter.some((label) => {
          const normalizedLabel = normalize(label);
          return text === normalizedLabel || aria === normalizedLabel;
        });
      })
      : null;
    const filterSelected = filter && (
      filter.getAttribute('aria-selected') === 'true'
      || filter.getAttribute('aria-pressed') === 'true'
      || /(?:selected|active|checked)/i.test(String(filter.className || ''))
    );
    if (filter && !filterSelected) {
      filter.click();
      changed = true;
    }
    return { ok: true, changed, filterFound: !wantedFilter || !!filter };
  }, filterLabels, preserveSearch);
  if (!normalized?.ok) throw new CommandExecutionError('AI Studio model picker dialog did not appear');
  if (filterLabels && !normalized.filterFound) {
    throw new CommandExecutionError(
      `AI Studio model picker filter ${filterLabels[0]} was not found`,
      'The AI Studio model picker layout may have changed; inspect the retained tab and retry.',
    );
  }
  if (normalized.changed) {
    await waitForAIStudioState(
      page,
      'AI Studio model picker update',
      () => evaluatePage(page, 'AI Studio model picker update state', () => {
        const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
          return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
        });
        return {
          dialogFound: !!dialog,
          busy: !!dialog?.querySelector('[aria-busy="true"], mat-progress-spinner, [role="progressbar"]'),
        };
      }),
      (state) => state.dialogFound && !state.busy,
      {
        deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio model picker did not settle after changing its filter.',
      },
    );
  }
}

export async function closeTopDialog(page, options = {}) {
  const closed = await evaluatePage(page, 'AI Studio dialog close', () => {
    const dialogs = Array.from(document.querySelectorAll('mat-dialog-container'));
    const dialog = dialogs.find((candidate) => /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || '')))
      ?? dialogs.at(-1);
    if (!dialog) return false;
    const closeButton = Array.from(dialog.querySelectorAll('button')).find((button) => {
      const aria = String(button.getAttribute('aria-label') || '');
      const text = String(button.textContent || '').trim();
      return /close|关闭/i.test(`${aria} ${text}`);
    });
    if (!closeButton) return false;
    closeButton.click();
    return true;
  }).catch(() => false);
  if (!closed && page.nativeKeyPress) await page.nativeKeyPress('Escape').catch(() => {});
  try {
    await waitForAIStudioState(
      page,
      'AI Studio dialog close',
      () => evaluatePage(page, 'AI Studio dialog state', () => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll('mat-dialog-container')).filter(visible).length;
      }),
      (dialogCount) => dialogCount === 0,
      {
        deadline: options.deadline,
        timeoutSeconds: 3,
        maxSeconds: 3,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio dialog did not close after the close action.',
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function readAIStudioModelPickerSearchState(page, searchSelector) {
  return evaluatePage(page, 'AI Studio model search results', (selector) => {
    const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
      return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
    });
    if (!dialog) return { dialogFound: false, searchFound: false, searchValue: '', cardTexts: [] };
    const search = document.querySelector(selector);
    const cardTexts = Array.from(dialog.querySelectorAll('.content-button'))
      .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return {
      dialogFound: true,
      searchFound: search instanceof HTMLInputElement,
      searchValue: search instanceof HTMLInputElement ? search.value : '',
      cardTexts,
    };
  }, searchSelector);
}

async function enterAIStudioModelSearch(page, requested, options = {}) {
  const raw = normalizeSpaces(requested);
  if (!raw) throw new ArgumentError('--model must not be empty');
  const searchSelector = await evaluatePage(page, 'AI Studio model picker search field', (selectors) => {
    return selectors.find((selector) => document.querySelector(selector)) || null;
  }, AI_STUDIO_SELECTORS.modelPickerSearch);
  if (!searchSelector) {
    throw new CommandExecutionError(
      'AI Studio model picker search field was not found',
      'The model picker must expose input[type="search"] before a model can be selected.',
    );
  }
  if (typeof page.focus === 'function') await page.focus(searchSelector).catch(() => {});
  if (typeof page.click === 'function') await page.click(searchSelector);
  await page.fillText(searchSelector, raw);

  const state = await readAIStudioModelPickerSearchState(page, searchSelector);
  if (!state.dialogFound || !state.searchFound || state.searchValue !== raw) {
    throw new CommandExecutionError(
      `AI Studio model picker search did not retain ${raw}.`,
      'The model search input did not accept the requested model id.',
    );
  }
  return { raw, searchSelector };
}

async function waitForAIStudioModelSearchResults(page, search, options = {}) {
  let attempts = 0;
  const state = await waitForAIStudioState(
    page,
    'AI Studio model search results',
    async () => {
      attempts += 1;
      return readAIStudioModelPickerSearchState(page, search.searchSelector);
    },
    (current) => {
      if (!current.dialogFound) {
        throw new CommandExecutionError('AI Studio model picker closed while searching for a model');
      }
      if (!current.searchFound) {
        throw new CommandExecutionError('AI Studio model picker search field disappeared while searching');
      }
      if (current.searchValue !== search.raw) return false;
      const models = parseModelCardTexts(current.cardTexts);
      const exactModel = models.some((row) => row.model.toLowerCase() === search.raw.toLowerCase());
      const exactName = models.some((row) => row.name.toLowerCase() === search.raw.toLowerCase());
      return models.length > 0 && (exactModel || exactName || attempts >= 5);
    },
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio model picker search did not settle for ${search.raw}.`,
    },
  );
  if (state.searchValue !== search.raw) {
    throw new CommandExecutionError(
      `AI Studio model picker search did not retain ${search.raw}.`,
      'The model search input did not accept the requested model id.',
    );
  }
  return state.cardTexts;
}

async function readOpenModelCards(page, options = {}) {
  let lastTexts = [];
  try {
    const texts = await waitForAIStudioState(
      page,
      'AI Studio model cards',
      () => evaluatePage(page, 'AI Studio model cards', () => {
      const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
        return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
      });
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll('.content-button'))
        .map((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      }),
      (texts) => {
        if (!Array.isArray(texts)) throw new CommandExecutionError('AI Studio model picker returned unexpected data');
        lastTexts = texts;
        return parseModelCardTexts(texts).length > 0;
      },
      {
        deadline: options.deadline,
        timeoutSeconds: 10,
        maxSeconds: 10,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio model picker did not expose readable model cards.',
      },
    );
    return parseModelCardTexts(texts);
  } catch (error) {
    if (lastTexts.length) {
      throw new CommandExecutionError(
        `AI Studio model cards contained no canonical model ids: ${lastTexts.slice(0, 3).join(' | ').slice(0, 600)}`,
      );
    }
    throw error;
  }
}

async function scrollAIStudioModelDialog(page) {
  return evaluatePage(page, 'AI Studio model picker scroll', () => {
    const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
      return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
    });
    if (!dialog) return { found: false, scrolled: false };
    const selectors = '.cdk-virtual-scroll-viewport, .mat-dialog-content, [class*="virtual-scroll"], [class*="scroll-viewport"], [class*="scroll-content"]';
    let containers = Array.from(dialog.querySelectorAll(selectors));
    if (!containers.length) {
      containers = Array.from(dialog.querySelectorAll('div')).filter((element) => {
        return element.scrollHeight > element.clientHeight + 2 && element.clientHeight >= 40;
      });
    }
    let scrolled = false;
    for (const container of containers) {
      const before = container.scrollTop;
      // Step one viewport at a time; jumping straight to the bottom skips the
      // intermediate items a virtual list never renders. When the step cannot
      // advance (already at the bottom), scrolled stays false and the caller
      // stops collecting.
      const nextTop = before + Math.max(container.clientHeight, 100);
      container.scrollTop = Math.min(nextTop, container.scrollHeight);
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      if (container.scrollTop > before) scrolled = true;
    }
    return { found: true, scrolled };
  });
}

async function readOpenModelCardsWithScroll(page, options = {}) {
  const modelsById = new Map();
  let stablePasses = 0;
  let previousCount = 0;
  for (let pass = 0; pass < 30; pass += 1) {
    if (options.deadline) assertAIStudioDeadline(options.deadline, 'model list scrolling');
    const rows = await readOpenModelCards(page, options);
    for (const row of rows) modelsById.set(row.model, row);
    if (modelsById.size === previousCount) stablePasses += 1;
    else {
      previousCount = modelsById.size;
      stablePasses = 0;
    }
    if (stablePasses >= 2) break;
    const scrollResult = await scrollAIStudioModelDialog(page);
    if (!scrollResult.found || !scrollResult.scrolled) break;
    const remaining = options.deadline
      ? Math.max(0, (options.deadline.expiresAt - Date.now()) / 1000)
      : 0.4;
    if (options.deadline && remaining <= 0) {
      assertAIStudioDeadline(options.deadline, 'model list scrolling');
    }
    await page.wait(options.deadline ? Math.min(0.4, remaining) : 0.4);
  }
  return Array.from(modelsById.values());
}

export async function readAIStudioModels(page, category = null, options = {}) {
  await openModelPicker(page, category === 'all' ? 'all' : category, { deadline: options.deadline });
  let models;
  let primaryError = null;
  try {
    models = await readOpenModelCardsWithScroll(page, options);
    if (!models.length) {
      throw new CommandExecutionError('AI Studio model picker opened but no model cards were extracted');
    }
  } catch (error) {
    primaryError = error;
  }
  const closed = await closeTopDialog(page, options);
  if (primaryError) throw primaryError;
  if (!closed) {
    throw new CommandExecutionError(
      'AI Studio model picker dialog did not close',
      'The command stopped before returning model data; inspect the retained tab and close the picker before retrying.',
    );
  }
  return models;
}

export async function getCurrentAIStudioModel(page, options = {}) {
  await ensureRunSettings(page, options);
  const model = await evaluatePage(page, 'AI Studio current model', () => {
    const selector = document.querySelector('ms-model-selector');
    const text = String(selector?.innerText || selector?.textContent || '');
    return text.match(/\b(?:gemini|imagen|veo|lyria|gemma)-[a-z0-9][a-z0-9.-]*\b/i)?.[0]?.toLowerCase() || '';
  });
  return typeof model === 'string' ? model : '';
}

export async function openAIStudioModelDirect(page, requested, options = {}) {
  const raw = normalizeSpaces(requested);
  const match = String(raw || '').toLowerCase().match(/^(?:gemini|imagen|veo|lyria|gemma)-[a-z0-9][a-z0-9.-]*$/i);
  if (!match) return null;
  const modelId = match[0].toLowerCase();
  await navigateAIStudioPage(page, `${AISTUDIO_HOME}?model=${encodeURIComponent(modelId)}`, options);
  try {
    await waitForAIStudioState(
      page,
      'AI Studio direct model navigation',
      () => getCurrentAIStudioModel(page, options).catch(() => ''),
      (current) => current === modelId,
      {
        deadline: options.deadline,
        timeoutSeconds: 8,
        maxSeconds: 8,
        pollSeconds: 0.2,
        timeoutMessage: `AI Studio did not activate ${modelId} from its URL.`,
      },
    );
  } catch {
    return null;
  }
  return {
    model: modelId,
    name: modelId,
    category: modelCategory(modelId),
    // The URL proves which model is selected, not that generation is currently
    // available for this account or model tier.
    availability: 'unknown',
    description: null,
  };
}

export async function selectAIStudioModel(page, requested, requiredCategory = null, options = {}) {
  const direct = await openAIStudioModelDirect(page, requested, options);
  if (direct) {
    // The direct URL activates exactly the requested model id; it must never
    // bypass the category contract (e.g. the image command landing on a text
    // model). A mismatch is a hard error rather than a silent picker retry,
    // because the user asked for this model and only this model.
    if (!requiredCategory || requiredCategory === 'all' || direct.category === requiredCategory) {
      return direct;
    }
    throw new ArgumentError(
      `Model "${direct.model}" is a ${direct.category} model; the ${requiredCategory} command requires an ${requiredCategory} model.`,
      'Use `opencli aistudio models` to list models of the required category.',
    );
  }
  await openModelPicker(page, null, { deadline: options.deadline });
  let selected;
  try {
    const search = await enterAIStudioModelSearch(page, requested, options);
    await openModelPicker(page, 'all', { preserveSearch: true, deadline: options.deadline });
    const cardTexts = await waitForAIStudioModelSearchResults(page, search, options);
    const resolved = resolveAIStudioModelSearchResult(cardTexts, requested, requiredCategory);
    selected = resolved.selected;
    const clicked = await evaluatePage(page, 'AI Studio model selection', (modelId) => {
      const dialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((candidate) => {
        return /model selection|select (?:a )?model|模型/i.test(String(candidate.textContent || ''));
      });
      const cards = dialog ? Array.from(dialog.querySelectorAll('.content-button')) : [];
      const target = cards.find((element) => {
        const text = String(element.innerText || element.textContent || '').toLowerCase();
        const match = text.match(/\b(?:gemini|imagen|veo|lyria|gemma)-[a-z0-9][a-z0-9.-]*\b/i);
        return match?.[0]?.toLowerCase() === modelId;
      });
      if (!target) return false;
      target.click();
      return true;
    }, selected.model);
    if (!clicked) {
      throw new CommandExecutionError(
        `AI Studio model search did not expose an exact card for ${selected.model}`,
        'Use the canonical model id and retry after confirming the model picker search results.',
      );
    }
  } catch (error) {
    await closeTopDialog(page, options);
    throw error;
  }

  const current = await waitForAIStudioState(
    page,
    'AI Studio model selection',
    () => getCurrentAIStudioModel(page, options),
    (model) => model === selected.model,
    {
      deadline: options.deadline,
      timeoutSeconds: 8,
      maxSeconds: 8,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio model selection did not stick: requested ${selected.model}.`,
    },
  );
  return selected;
}

async function readVisibleOptions(page) {
  return evaluatePage(page, 'AI Studio select options', () => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('mat-option, [role="option"]'))
      .filter(visible)
      .map((element) => String(element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  });
}

// UI label aliases (English / Chinese) for the run-settings controls. Single
// source of truth shared by the open, verify, and retry closures of each
// setter — the same map is passed into every page evaluate call.
const AI_STUDIO_SELECT_LABELS = Object.freeze({
  'aspect ratio': ['aspect ratio', '宽高比', '比例'],
  'resolution': ['resolution', '分辨率'],
  'thinking level': ['thinking level', '思考级别', '思考等级'],
  'media resolution': ['media resolution', '媒体分辨率', '媒体解析度'],
});

const AI_STUDIO_NUMBER_LABELS = Object.freeze({
  'temperature': ['temperature', '温度'],
  'top p': ['top p', 'top-p'],
  'maximum output tokens': ['maximum output tokens', '最大输出 token 数', 'max output tokens'],
});

const AI_STUDIO_TOGGLE_LABELS = Object.freeze({
  'structured outputs': ['structured outputs', 'structured output', '结构化输出'],
  'code execution': ['code execution', '代码执行'],
  'function calling': ['function calling', '函数调用'],
  'grounding with google search': [
    'grounding with google search',
    'google search grounding',
    '使用 google 搜索进行 grounding',
    '使用 google 搜索进行接地',
  ],
  'grounding with google maps': [
    'grounding with google maps',
    'google maps grounding',
    '使用 google maps 进行 grounding',
    '使用 google maps 进行接地',
  ],
  'url context': ['url context', 'browse the url context', '网址上下文', '浏览网址上下文'],
});

export async function setAIStudioSelect(page, label, requested, options = {}) {
  await ensureRunSettings(page, options);
  const desired = normalizeSpaces(requested);
  const opened = await evaluatePage(page, `AI Studio ${label} select`, (ariaLabel, labelMap) => {
    const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const expected = normalize(ariaLabel);
    const allowed = labelMap[expected] || [expected];
    const isMatch = (el) => {
      if (allowed.includes(normalize(el.getAttribute('aria-label')))) return true;
      const ff = el.closest('mat-form-field');
      if (ff && allowed.includes(normalize(ff.querySelector('mat-label')?.textContent))) return true;
      return false;
    };
    const selects = Array.from(document.querySelectorAll('ms-run-settings mat-select'));
    const select = selects.find(isMatch);
    if (!select) return { ok: false };
    select.click();
    return {
      ok: true,
      selectIndex: selects.indexOf(select),
      controlsId: select.getAttribute('aria-controls') || select.getAttribute('aria-owns') || null,
    };
  }, label, AI_STUDIO_SELECT_LABELS);
  if (!opened?.ok) {
    // Some models expose no selector for this setting (e.g. Nano Banana / Imagen
    // have no Resolution control, Pro has no Thinking Level). When the caller
    // opts into skipIfMissing, fall back to the model default instead of failing
    // the whole generation; the pipeline always sends these with defaults.
    if (options.skipIfMissing) return null;
    throw new ArgumentError(`${label} is not available for the selected AI Studio model`);
  }
  const available = await waitForAIStudioState(
    page,
    `AI Studio ${label} options`,
    () => readVisibleOptions(page),
    (options) => Array.isArray(options) && options.length > 0,
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio ${label} options did not appear.`,
    },
  );
  const match = resolveAIStudioOption(label, desired, available);
  if (!match) {
    await closeTopDialog(page, options);
    throw new ArgumentError(`${label} must be one of: ${available.join(', ')}. Received: "${desired}"`);
  }
  const clicked = await evaluatePage(page, `AI Studio ${label} option`, (optionText, scope) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    let root = document;
    if (scope?.controlsId && typeof document.getElementById === 'function') {
      root = document.getElementById(scope.controlsId) || document;
    }
    let options = Array.from(root.querySelectorAll?.('mat-option, [role="option"]') || []);
    if (!options.length && root !== document) {
      options = Array.from(document.querySelectorAll('mat-option, [role="option"]'));
    }
    // Browser mocks and older Angular builds may not expose aria-controls on
    // the select. If their option nodes carry an owner index, use it to avoid
    // selecting the first duplicate label from another control.
    const owned = options.filter((element) => {
      const owner = element.dataset?.opencliSelectIndex ?? element._opencliSelectIndex;
      return owner !== undefined && Number(owner) === Number(scope?.selectIndex);
    });
    if (owned.length) options = owned;
    const option = options
      .filter(visible)
      .find((element) => String(element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === optionText.toLowerCase());
    if (!option) return false;
    option.click();
    return true;
  }, match, opened);
  if (!clicked) throw new CommandExecutionError(`Failed to select AI Studio ${label} value ${match}`);
  const current = await waitForAIStudioState(
    page,
    `AI Studio ${label} selection`,
    () => evaluatePage(page, `AI Studio ${label} verification`, (ariaLabel, labelMap) => {
      const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const expected = normalize(ariaLabel);
      const allowed = labelMap[expected] || [expected];
      const isMatch = (el) => {
        if (allowed.includes(normalize(el.getAttribute('aria-label')))) return true;
        const ff = el.closest('mat-form-field');
        if (ff && allowed.includes(normalize(ff.querySelector('mat-label')?.textContent))) return true;
        return false;
      };
      const select = Array.from(document.querySelectorAll('ms-run-settings mat-select')).find(isMatch);
      const value = select?.querySelector('.mat-mdc-select-min-line, .mat-select-value-text');
      return String(value?.innerText || value?.textContent || '').replace(/\s+/g, ' ').trim();
    }, label, AI_STUDIO_SELECT_LABELS),
    (value) => normalizeSpaces(value).toLowerCase() === match.toLowerCase(),
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio ${label} selection did not settle on ${match}.`,
    },
  );
  return match;
}

export async function setAIStudioNumber(page, label, requested, options = {}) {
  await ensureRunSettings(page, options);
  const value = requireFiniteNumber(requested, label);
  const metadata = await evaluatePage(page, `AI Studio ${label} metadata`, (ariaLabel, labelMap) => {
    const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const expected = normalize(ariaLabel);
    const allowed = labelMap[expected] || [expected];
    const isMatch = (el) => {
      if (allowed.includes(normalize(el.getAttribute('aria-label')))) return true;
      const ff = el.closest('mat-form-field');
      if (ff && allowed.includes(normalize(ff.querySelector('mat-label')?.textContent))) return true;
      return false;
    };
    const inputs = Array.from(document.querySelectorAll('ms-run-settings input')).filter(isMatch);
    const editor = inputs.find((element) => element.getAttribute('role') === 'spinbutton' || element.type === 'number')
      ?? inputs.find((element) => element.type !== 'range');
    const range = inputs.find((element) => element.type === 'range');
    if (!editor) return null;
    return {
      selectorRole: editor.getAttribute('role') || '',
      type: editor.type || '',
      min: editor.min || range?.min || '',
      max: editor.max || range?.max || '',
      disabled: editor.disabled || editor.getAttribute('aria-disabled') === 'true',
      foundAriaLabel: editor.getAttribute('aria-label') || '',
    };
  }, label, AI_STUDIO_NUMBER_LABELS);
  if (!metadata) throw new ArgumentError(`${label} is not available for the selected AI Studio model`);
  if (metadata.disabled) throw new ArgumentError(`${label} is disabled for the selected AI Studio model`);
  const min = metadata.min === '' ? null : Number(metadata.min);
  const max = metadata.max === '' ? null : Number(metadata.max);
  if (min !== null && value < min) throw new ArgumentError(`${label} must be >= ${min}`);
  if (max !== null && value > max) throw new ArgumentError(`${label} must be <= ${max}`);

  const fallbackAriaLabel = metadata.foundAriaLabel || label;
  const escapedAriaLabel = String(fallbackAriaLabel)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\D ')
    .replace(/\n/g, '\\A ');
  const selector = metadata.selectorRole === 'spinbutton'
    ? `ms-run-settings input[aria-label="${escapedAriaLabel}"][role="spinbutton"]`
    : `ms-run-settings input[aria-label="${escapedAriaLabel}"]:not([type="range"])`;
  
  let result = null;
  if (fallbackAriaLabel) {
    result = await page.fillText(selector, String(value)).catch(() => null);
  }
  if (!result?.verified) {
    result = await evaluatePage(page, `AI Studio ${label} fallback write`, (ariaLabel, valStr, labelMap) => {
      const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const expected = normalize(ariaLabel);
      const allowed = labelMap[expected] || [expected];
      const isMatch = (el) => {
        if (allowed.includes(normalize(el.getAttribute('aria-label')))) return true;
        const ff = el.closest('mat-form-field');
        if (ff && allowed.includes(normalize(ff.querySelector('mat-label')?.textContent))) return true;
        return false;
      };
      const inputs = Array.from(document.querySelectorAll('ms-run-settings input')).filter(isMatch);
      const editor = inputs.find((element) => element.getAttribute('role') === 'spinbutton' || element.type === 'number') ?? inputs.find((element) => element.type !== 'range');
      if (!editor) return { verified: false };
      editor.value = valStr;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return { verified: true };
    }, label, String(value), AI_STUDIO_NUMBER_LABELS);
  }
  if (!result?.verified) throw new CommandExecutionError(`Failed to set AI Studio ${label}`);
  await waitForAIStudioState(
    page,
    `AI Studio ${label} value`,
    () => evaluatePage(page, `AI Studio ${label} verification`, (ariaLabel, labelMap) => {
      const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const expected = normalize(ariaLabel);
      const allowed = labelMap[expected] || [expected];
      const isMatch = (el) => {
        if (allowed.includes(normalize(el.getAttribute('aria-label')))) return true;
        const ff = el.closest('mat-form-field');
        if (ff && allowed.includes(normalize(ff.querySelector('mat-label')?.textContent))) return true;
        return false;
      };
      const inputs = Array.from(document.querySelectorAll('ms-run-settings input')).filter(isMatch);
      const editor = inputs.find((element) => element.getAttribute('role') === 'spinbutton' || element.type === 'number')
        ?? inputs.find((element) => element.type !== 'range');
      return editor?.value ?? '';
    }, label, AI_STUDIO_NUMBER_LABELS),
    (current) => Number.isFinite(Number(current)) && Math.abs(Number(current) - value) <= 1e-9,
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio ${label} did not settle on ${value}.`,
    },
  );
  return value;
}

export async function setAIStudioToggle(page, label, requested, options = {}) {
  if (typeof requested !== 'boolean') throw new ArgumentError(`${label} must be a boolean`);
  await ensureRunSettings(page, options);
  const result = await evaluatePage(page, `AI Studio ${label} toggle`, (wantedLabel, desired, labelMap) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const expected = normalize(wantedLabel);
    const allowed = (labelMap[expected] || [expected]).map(normalize);
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const readLabel = (element) => normalize(element.getAttribute('aria-label') || element.textContent);
    const isMatch = (element) => allowed.includes(readLabel(element));
    const switches = [
      ...Array.from(document.querySelectorAll('ms-run-settings [role="switch"]')),
      ...Array.from(document.querySelectorAll('ms-run-settings mat-slide-toggle')),
    ].filter((element, index, all) => all.indexOf(element) === index);
    const target = switches.find((element) => isMatch(element) && visible(element))
      || switches.find(isMatch);
    if (!target) return { ok: false, available: switches.map(readLabel).filter(Boolean) };
    const control = target.getAttribute('role') === 'switch' ? target : target.querySelector('[role="switch"]');
    const host = target.closest?.('mat-slide-toggle');
    const disabled = Boolean(target.disabled) || Boolean(control?.disabled)
      || target.getAttribute('aria-disabled') === 'true'
      || control?.getAttribute('aria-disabled') === 'true'
      || host?.hasAttribute?.('disabled')
      || host?.classList?.contains('mat-mdc-slide-toggle-disabled');
    const current = (control || target).getAttribute('aria-checked') === 'true';
    if (disabled) return { ok: false, disabled: true, current };
    let nativeRetrySelector = null;
    if (current !== desired) {
      (control || target).click();
      // MDC switches flip synchronously on a handled click. Only fall back to
      // a native CDP click (page.click) when the synthesized click was
      // ignored — an unconditional native retry would double-toggle builds
      // that DO handle synthetic clicks, leaving the switch back on its
      // original value.
      const afterClick = (control || target).getAttribute('aria-checked') === 'true';
      if (afterClick !== desired) {
        const ariaLabel = (control || target).getAttribute('aria-label');
        if (ariaLabel && typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
          nativeRetrySelector = `[aria-label="${CSS.escape(String(ariaLabel))}"]`;
        }
      }
    }
    return { ok: true, current: (control || target).getAttribute('aria-checked') === 'true', nativeRetrySelector };
  }, label, requested, AI_STUDIO_TOGGLE_LABELS);
  if (!result?.ok) {
    if (result?.disabled) throw new ArgumentError(`${label} is disabled for the selected AI Studio model`);
    throw new ArgumentError(
      `${label} is not available for the selected AI Studio model`,
      result?.available?.length ? `Found: ${result.available.join(', ')}` : undefined,
    );
  }
  // Native CDP click on the switch when the synthesized click did not flip it.
  if (result?.nativeRetrySelector && typeof page.click === 'function') {
    await page.click(result.nativeRetrySelector).catch(() => {});
  }
  await waitForAIStudioState(
    page,
    `AI Studio ${label} toggle`,
    () => evaluatePage(page, `AI Studio ${label} verification`, (wantedLabel, labelMap) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const expected = normalize(wantedLabel);
      const allowed = (labelMap[expected] || [expected]).map(normalize);
      const readLabel = (element) => normalize(element.getAttribute('aria-label') || element.textContent);
      const target = [
        ...Array.from(document.querySelectorAll('ms-run-settings [role="switch"]')),
        ...Array.from(document.querySelectorAll('ms-run-settings mat-slide-toggle')),
      ].filter((element, index, all) => all.indexOf(element) === index)
        .map((element) => element.getAttribute('role') === 'switch' ? element : element.querySelector('[role="switch"]') || element)
        .find((element) => allowed.includes(readLabel(element)));
      return target ? {
        found: true,
        checked: target.getAttribute('aria-checked') === 'true',
        disabled: Boolean(target.disabled) || target.getAttribute('aria-disabled') === 'true',
      } : { found: false, checked: false, disabled: false };
    }, label, AI_STUDIO_TOGGLE_LABELS),
    (state) => state?.found === true && state.disabled === false && state.checked === requested,
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio ${label} did not settle on ${requested ? 'enabled' : 'disabled'}.`,
    },
  ).catch(async (err) => {
    // A plain click can be swallowed by the slide-toggle animation on some AI
    // Studio builds. Retry with keyboard activation (focused Space), which
    // mat-slide-toggle handles natively, then re-verify once.
    await evaluatePage(page, `AI Studio ${label} keyboard activation`, (wantedLabel, desired, labelMap) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const expected = normalize(wantedLabel);
      const allowed = (labelMap[expected] || [expected]).map(normalize);
      const readLabel = (element) => normalize(element.getAttribute('aria-label') || element.textContent);
      const switches = [
        ...Array.from(document.querySelectorAll('ms-run-settings [role="switch"]')),
        ...Array.from(document.querySelectorAll('ms-run-settings mat-slide-toggle')),
      ].filter((element, index, all) => all.indexOf(element) === index);
      const target = switches.map((element) => element.getAttribute('role') === 'switch' ? element : element.querySelector('[role="switch"]') || element)
        .find((element) => allowed.includes(readLabel(element)));
      if (!target) return false;
      const ctor = target.ownerDocument?.defaultView?.KeyboardEvent || KeyboardEvent;
      target.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        target.dispatchEvent(new ctor(type, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      }
      // A Space keydown flips a focused switch; only click the host when the
      // keyboard activation was ignored, so a switch that already flipped is
      // not toggled back by a second activation.
      const afterSpace = (target.getAttribute('aria-checked') === 'true') === desired;
      if (!afterSpace) {
        const host = target.closest?.('mat-slide-toggle') || target;
        host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return true;
    }, label, requested, AI_STUDIO_TOGGLE_LABELS).catch(() => false);
    await waitForAIStudioState(
      page,
      `AI Studio ${label} toggle (keyboard retry)`,
      () => evaluatePage(page, `AI Studio ${label} verification after retry`, (wantedLabel, labelMap) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const expected = normalize(wantedLabel);
        const allowed = (labelMap[expected] || [expected]).map(normalize);
        const readLabel = (element) => normalize(element.getAttribute('aria-label') || element.textContent);
        const target = [
          ...Array.from(document.querySelectorAll('ms-run-settings [role="switch"]')),
          ...Array.from(document.querySelectorAll('ms-run-settings mat-slide-toggle')),
        ].filter((element, index, all) => all.indexOf(element) === index)
          .map((element) => element.getAttribute('role') === 'switch' ? element : element.querySelector('[role="switch"]') || element)
          .find((element) => allowed.includes(readLabel(element)));
        return target ? { checked: target.getAttribute('aria-checked') === 'true' } : { checked: false };
      }, label, AI_STUDIO_TOGGLE_LABELS),
      (state) => state?.checked === requested,
      {
        deadline: options.deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: `AI Studio ${label} did not settle after keyboard retry.`,
      },
    ).catch(() => { throw err; });
  });
  return requested;
}

export async function setAIStudioSafetySettings(page, settings, options = {}) {
  if (!isObjectRecord(settings)) throw new ArgumentError('--safety-settings must be a JSON object');
  const requested = Object.entries(settings);
  if (!requested.length) return {};
  const normalized = requested.map(([category, threshold]) => ({
    category: canonicalAIStudioSafetyCategory(category),
    threshold,
  }));
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.category)) throw new ArgumentError(`Duplicate safety category: ${item.category}`);
    seen.add(item.category);
  }

  await ensureRunSettings(page, options);
  const opened = await evaluatePage(page, 'AI Studio safety settings', () => {
    const button = Array.from(document.querySelectorAll('ms-run-settings button')).find((element) => {
      const text = String(element.getAttribute('aria-label') || `${element.textContent || ''}`).replace(/\s+/g, ' ').trim().toLowerCase();
      return text.includes('edit safety settings') || text.includes('safety settings') || text.includes('编辑安全设置');
    });
    if (!button) return false;
    button.click();
    return true;
  });
  if (!opened) throw new ArgumentError('Safety settings are not available for the selected AI Studio model');

  let metadata;
  try {
    metadata = await waitForAIStudioState(
      page,
      'AI Studio safety settings dialog',
      () => evaluatePage(page, 'AI Studio safety settings controls', () => {
        return Array.from(document.querySelectorAll('run-safety-settings input[type="range"]')).map((input) => ({
          label: input.getAttribute('aria-label') || '',
          min: input.min,
          max: input.max,
          value: input.value,
          disabled: Boolean(input.disabled),
        }));
      }),
      (controls) => Array.isArray(controls) && controls.length > 0,
      {
        deadline: options.deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio safety settings dialog did not finish opening.',
      },
    );
  } catch (error) {
    await closeTopDialog(page, options);
    throw error;
  }

  let resolved;
  try {
    resolved = normalized.map((item) => {
      const control = metadata.find((candidate) => normalizeAIStudioSettingToken(candidate.label) === normalizeAIStudioSettingToken(item.category));
      if (!control) {
        throw new ArgumentError(
          `Safety category ${item.category} is not available for the selected AI Studio model`,
          `Found: ${metadata.map((candidate) => candidate.label).join(', ')}`,
        );
      }
      if (control.disabled) throw new ArgumentError(`Safety category ${item.category} is disabled`);
      const min = Number(control.min);
      const max = Number(control.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) throw new ArgumentError(`Safety category ${item.category} has no numeric range`);
      return {
        category: item.category,
        value: resolveAIStudioSafetyThreshold(item.threshold, min, max, item.category),
      };
    });
  } catch (error) {
    await closeTopDialog(page, options);
    throw error;
  }

  let applied;
  try {
    applied = await evaluatePage(page, 'AI Studio safety settings write', (items) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const controls = Array.from(document.querySelectorAll('run-safety-settings input[type="range"]'));
      const missing = [];
      for (const item of items) {
        const input = controls.find((candidate) => normalize(candidate.getAttribute('aria-label')) === normalize(item.category));
        if (!input) {
          missing.push(item.category);
          continue;
        }
        input.value = String(item.value);
        const EventCtor = input.ownerDocument?.defaultView?.Event || Event;
        input.dispatchEvent(new EventCtor('input', { bubbles: true }));
        input.dispatchEvent(new EventCtor('change', { bubbles: true }));
      }
      return { missing, values: controls.map((input) => ({ label: input.getAttribute('aria-label') || '', value: input.value })) };
    }, resolved);
  } catch (error) {
    await closeTopDialog(page, options);
    throw error;
  }
  if (applied?.missing?.length) {
    await closeTopDialog(page, options);
    throw new ArgumentError(`Safety categories were not found: ${applied.missing.join(', ')}`);
  }
  try {
    await waitForAIStudioState(
      page,
      'AI Studio safety settings value',
      () => evaluatePage(page, 'AI Studio safety settings verification', (items) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const controls = Array.from(document.querySelectorAll('run-safety-settings input[type="range"]'));
        return items.every((item) => controls.some((input) => {
          return normalize(input.getAttribute('aria-label')) === normalize(item.category)
            && Number(input.value) === Number(item.value);
        }));
      }, resolved),
      (ok) => ok === true,
      {
        deadline: options.deadline,
        timeoutSeconds: 5,
        maxSeconds: 5,
        pollSeconds: 0.1,
        timeoutMessage: 'AI Studio safety settings did not settle on the requested values.',
      },
    );
  } catch (error) {
    await closeTopDialog(page, options);
    throw error;
  }
  if (!await closeTopDialog(page, options)) {
    throw new CommandExecutionError('AI Studio safety settings dialog did not close');
  }
  return Object.fromEntries(resolved.map((item) => [item.category, item.value]));
}

export async function setAIStudioStopSequences(page, sequences, options = {}) {
  const values = [...new Set((Array.isArray(sequences) ? sequences : []).map((value) => String(value).trim()).filter(Boolean))];
  if (!values.length) return [];
  await ensureRunSettings(page, options);
  const inputSelector = await evaluatePage(page, 'AI Studio stop sequence input', () => {
    const input = document.querySelector('ms-run-settings ms-stop-sequence-input input#chip-input')
      || document.querySelector('ms-run-settings input[aria-label="Add stop sequence"]')
      || document.querySelector('ms-run-settings input[aria-label="添加停止序列"]')
      || document.querySelector('ms-run-settings input[placeholder*="Add stop" i]')
      || document.querySelector('ms-run-settings input[placeholder*="添加停止" i]');
    if (!input) return null;
    if (!input.id) input.id = `opencli-stop-sequence-${Date.now()}`;
    return `ms-run-settings input#${input.id}`;
  });
  if (!inputSelector) throw new ArgumentError('Stop sequences are not available for the selected AI Studio model');

  for (const value of values) {
    const alreadyPresent = await evaluatePage(page, 'AI Studio stop sequence state', (wanted) => {
      const root = document.querySelector('ms-run-settings ms-stop-sequence-input');
      const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
      const chipValues = Array.from(root?.querySelectorAll?.(
        'mat-chip-row, mat-chip, mat-basic-chip, [data-test*="chip" i], [data-testid*="chip" i]',
      ) || []).map((chip) => {
        const clone = typeof chip.cloneNode === 'function' ? chip.cloneNode(true) : chip;
        clone.querySelectorAll?.('button, [role="button"]')?.forEach((control) => control.remove());
        return normalize(clone.innerText || clone.textContent || '');
      }).filter(Boolean);
      return chipValues.includes(normalize(wanted));
    }, value);
    if (alreadyPresent) continue;
    const filled = await page.fillText(inputSelector, value).catch(() => null);
    if (!filled?.verified) throw new CommandExecutionError(`Failed to fill AI Studio stop sequence: ${value}`);
    // Material chips inputs commit on Enter and/or blur. Prefer the trusted
    // native Enter (CDP), then blur, then a synthesized keyCode-13 event.
    if (typeof page.pressKey === 'function') await page.pressKey('Enter').catch(() => {});
    else if (typeof page.nativeKeyPress === 'function') await page.nativeKeyPress('Enter').catch(() => {});
    const commitViaBlur = async () => {
      await evaluatePage(page, 'AI Studio stop sequence blur commit', () => {
        const input = document.querySelector('ms-run-settings ms-stop-sequence-input input#chip-input')
          || document.querySelector('ms-run-settings input[aria-label="Add stop sequence"]')
          || document.querySelector('ms-run-settings input[aria-label="添加停止序列"]');
        if (input && typeof input.blur === 'function') input.blur();
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        return true;
      }).catch(() => {});
    };
    const verifyCommitted = (wanted) => evaluatePage(page, 'AI Studio stop sequence verification', (w) => {
      const root = document.querySelector('ms-run-settings ms-stop-sequence-input');
      const input = root?.querySelector('input');
      const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
      const chipValues = Array.from(root?.querySelectorAll?.(
        'mat-chip-row, mat-chip, mat-basic-chip, [data-test*="chip" i], [data-testid*="chip" i]',
      ) || []).map((chip) => {
        const clone = typeof chip.cloneNode === 'function' ? chip.cloneNode(true) : chip;
        clone.querySelectorAll?.('button, [role="button"]')?.forEach((control) => control.remove());
        return normalize(clone.innerText || clone.textContent || '');
      }).filter(Boolean);
      return { committed: chipValues.includes(normalize(w)) && String(input?.value || '') === '' };
    }, wanted);
    const settle = async (wanted, seconds) => waitForAIStudioState(
      page,
      `AI Studio stop sequence ${value}`,
      () => verifyCommitted(wanted),
      (state) => state?.committed === true,
      {
        deadline: options.deadline,
        timeoutSeconds: seconds,
        maxSeconds: seconds,
        pollSeconds: 0.1,
        timeoutMessage: `AI Studio stop sequence did not settle on ${value}.`,
      },
    );
    let committed = false;
    try {
      await settle(value, 5);
      committed = true;
    } catch {}
    if (!committed) {
      // Fallback 1: blur to trigger commit-on-blur chips behavior.
      await commitViaBlur();
      try {
        await settle(value, 5);
        committed = true;
      } catch {}
    }
    if (!committed) {
      // Fallback 2: synthesized keydown/keyup with a legacy keyCode.
      await evaluatePage(page, 'AI Studio stop sequence keyCode submit', () => {
        const input = document.querySelector('ms-run-settings ms-stop-sequence-input input#chip-input')
          || document.querySelector('ms-run-settings input[aria-label="Add stop sequence"]');
        if (!input) return false;
        const ctor = input.ownerDocument?.defaultView?.KeyboardEvent || KeyboardEvent;
        input.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
          input.dispatchEvent(new ctor(type, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
          }));
        }
        return true;
      }).catch(() => {});
      await commitViaBlur();
      try {
        await settle(value, 5);
        committed = true;
      } catch {}
    }
    if (!committed) {
      throw new CommandExecutionError(
        `AI Studio stop sequence did not commit ${JSON.stringify(value)}`,
        'The stop sequence chip input accepted the text but the UI did not create the chip. Inspect the retained tab.',
      );
    }
  }
  return values;
}

export async function setAIStudioSystemInstruction(page, instruction, options = {}) {
  await ensureRunSettings(page, options);
  const opened = await evaluatePage(page, 'AI Studio system instructions', () => {
    const normalize = (val) => String(val || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const button = Array.from(document.querySelectorAll('ms-run-settings button')).find(el => {
      const aria = normalize(el.getAttribute('aria-label'));
      const text = normalize(el.textContent);
      return aria === 'system instructions' || aria === '系统指令' || text === 'system instructions' || text === '系统指令';
    });
    if (!button) return false;
    button.click();
    return true;
  });
  if (!opened) throw new ArgumentError('System instructions are not available for the selected AI Studio model');
  const textareaSelector = await waitForAIStudioState(
    page,
    'AI Studio system instructions dialog',
    () => evaluatePage(page, 'AI Studio system instructions field', () => {
      const textareas = Array.from(document.querySelectorAll('mat-dialog-container textarea'));
      const target = textareas.find(el => {
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        return aria.includes('system') || aria.includes('系统') || aria.includes('指令');
      }) || textareas[0];
      if (!target) return null;
      if (!target.id) target.id = 'system-instructions-textarea-' + Date.now();
      return `textarea#${target.id}`;
    }),
    (selector) => !!selector,
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: 'AI Studio system instructions dialog did not finish opening.',
    },
  );
  const result = await page.fillText(textareaSelector, String(instruction));
  if (!result?.verified) {
    await closeTopDialog(page, options);
    throw new CommandExecutionError('Failed to set AI Studio system instructions');
  }
  // Verify the filled value regardless of the UI language: the dialog may expose
  // the field with an English, Chinese, or no aria-label, and Angular may have
  // re-created the element after fillText. Matching by value avoids both.
  const current = await evaluatePage(page, 'AI Studio system instructions verification', (expected) => {
    const target = Array.from(document.querySelectorAll('mat-dialog-container textarea'))
      .find((el) => String(el.value || '') === expected);
    return target ? target.value : null;
  }, String(instruction));
  const dialogClosed = await closeTopDialog(page, options);
  if (current !== String(instruction)) throw new CommandExecutionError('AI Studio system instructions did not stick');
  if (!dialogClosed) {
    throw new CommandExecutionError(
      'AI Studio system instructions dialog did not close',
      'The command stopped before interacting with the page under a residual dialog.',
    );
  }
  return current;
}

const OUTPUT_MODE_LABELS = Object.freeze({
  images: Object.freeze(['Images only', '仅图片', '只生成图片']),
  'images-text': Object.freeze(['Images & text', '图片和文本', '图片和文字']),
});

export async function setAIStudioOutputMode(page, mode, options = {}) {
  await ensureRunSettings(page, options);
  const labels = OUTPUT_MODE_LABELS[mode] || [mode === 'images' ? 'Images only' : 'Images & text'];
  const result = await evaluatePage(page, 'AI Studio output mode', (wanted) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const radios = Array.from(document.querySelectorAll('ms-run-settings [role="radio"]'));
    const target = radios.find((element) => {
      const text = normalize(element.textContent);
      return wanted.some((label) => text.includes(label));
    });
    if (!target) return { ok: false, available: radios.map((element) => normalize(element.textContent)) };
    if (target.getAttribute('aria-checked') !== 'true') target.click();
    return { ok: true };
  }, labels);
  if (!result?.ok) {
    // Some image models (e.g. Nano Banana Pro / gemini-3-pro-image) expose no
    // output-mode radio in run settings — they default to images-only, which is
    // exactly what an image command wants. Skip instead of failing the run.
    if ((result?.available || []).length === 0) return mode;
    throw new ArgumentError(`Output mode is not available. Found: ${(result?.available || []).join(', ')}`);
  }
  await waitForAIStudioState(
    page,
    'AI Studio output mode',
    () => evaluatePage(page, 'AI Studio output mode verification', () => {
      const radio = Array.from(document.querySelectorAll('ms-run-settings [role="radio"]'))
        .find((element) => element.getAttribute('aria-checked') === 'true');
      return String(radio?.textContent || '').replace(/\s+/g, ' ').trim();
    }),
    (selected) => labels.some((label) => String(selected || '').includes(label)),
    {
      deadline: options.deadline,
      timeoutSeconds: 5,
      maxSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `AI Studio output mode did not settle on ${labels[0]}.`,
    },
  );
  return mode;
}

export async function applyAIStudioSettings(page, options = {}) {
  let selectedModel = null;
  if (options.model) {
    selectedModel = await selectAIStudioModel(page, options.model, options.requiredCategory ?? null, options);
  }
  if (options.systemInstruction !== undefined) {
    await setAIStudioSystemInstruction(page, options.systemInstruction, options);
  }
  if (options.outputMode) await setAIStudioOutputMode(page, options.outputMode, options);
  if (options.aspectRatio) await setAIStudioSelect(page, 'Aspect ratio', options.aspectRatio, options);
  if (options.resolution) {
    const applied = await setAIStudioSelect(page, 'Resolution', options.resolution, {
      ...options,
      skipIfMissing: options.skipResolutionIfMissing === true,
    });
    if (!applied) process.stderr.write(`[warn] AI Studio model has no Resolution selector; skipped requested "${options.resolution}".\n`);
  }
  if (options.thinking) {
    const applied = await setAIStudioSelect(page, 'Thinking Level', options.thinking, {
      ...options,
      skipIfMissing: options.skipThinkingIfMissing === true,
    });
    if (!applied) process.stderr.write(`[warn] AI Studio model has no Thinking Level selector; skipped requested "${options.thinking}".\n`);
  }
  if (options.temperature !== undefined) await setAIStudioNumber(page, 'Temperature', options.temperature, options);
  if (options.topP !== undefined) await setAIStudioNumber(page, 'Top P', options.topP, options);
  if (options.maxOutputTokens !== undefined) {
    await setAIStudioNumber(page, 'Maximum output tokens', options.maxOutputTokens, options);
  }
  if (options.mediaResolution) await setAIStudioSelect(page, 'Media resolution', options.mediaResolution, options);
  const toggles = [
    ['structuredOutput', 'Structured outputs'],
    ['codeExecution', 'Code execution'],
    ['functionCalling', 'Function calling'],
    ['googleSearch', 'Grounding with Google Search'],
    ['googleMaps', 'Grounding with Google Maps'],
    ['urlContext', 'URL context'],
  ];
  for (const [key, label] of toggles) {
    if (options[key] !== undefined) await setAIStudioToggle(page, label, options[key], options);
  }
  if (options.safetySettings !== undefined) {
    await setAIStudioSafetySettings(page, options.safetySettings, options);
  }
  if (Array.isArray(options.stopSequences) && options.stopSequences.length) {
    await setAIStudioStopSequences(page, options.stopSequences, options);
  }
  
  const composerSelector = await evaluatePage(page, 'AI Studio composer selector', (selectors) => {
    return selectors.find((selector) => document.querySelector(selector)) || null;
  }, AI_STUDIO_SELECTORS.composer);
  if (composerSelector) {
    await focusAIStudioComposer(page, composerSelector).catch(() => {});
  }
  
  return {
    model: selectedModel?.model || await getCurrentAIStudioModel(page, options),
    selectedModel,
  };
}

export async function readAIStudioSnapshot(page) {
  return evaluatePage(page, 'AI Studio conversation snapshot', (composerSelectors, runSelectors, errorPattern, inlineErrorPattern, errorNodeSelector, maxInlineErrorLength, blockedContentPattern, blockedContentMaxLength) => {
    const errorRe = new RegExp(errorPattern, 'i');
    const inlineErrorRe = new RegExp(inlineErrorPattern, 'i');
    const blockedContentRe = new RegExp(blockedContentPattern, 'i');
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    // Some AI Studio builds render the response body inside open shadow roots.
    // Keep this traversal scoped to the adapter's known selectors instead of
    // flattening arbitrary page text. The small querySelector fallback also
    // keeps Browser Bridge mocks and older DOM shims working.
    const queryAllInRoot = (root, selector) => {
      if (!root) return [];
      const matches = [];
      try {
        if (typeof root.querySelectorAll === 'function') matches.push(...Array.from(root.querySelectorAll(selector)));
      } catch {}
      try {
        if (typeof root.querySelector === 'function') {
          const first = root.querySelector(selector);
          if (first && !matches.includes(first)) matches.unshift(first);
        }
      } catch {}
      return matches;
    };
    const deepQueryAll = (root, selector) => {
      const matches = [];
      const seenNodes = new Set();
      const seenRoots = new Set();
      const visit = (currentRoot) => {
        if (!currentRoot || seenRoots.has(currentRoot)) return;
        seenRoots.add(currentRoot);
        if (currentRoot.shadowRoot) visit(currentRoot.shadowRoot);
        for (const node of queryAllInRoot(currentRoot, selector)) {
          if (!seenNodes.has(node)) {
            seenNodes.add(node);
            matches.push(node);
          }
        }
        for (const element of queryAllInRoot(currentRoot, '*')) {
          if (element?.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(root);
      return matches;
    };
    const deepQueryOne = (root, selector) => deepQueryAll(root, selector)[0] || null;
    const deepText = (root) => normalize([
      root?.innerText || '',
      root?.textContent || '',
      ...deepQueryAll(root, '*').map((node) => node?.innerText || node?.textContent || ''),
    ].join(' '));
    const composerSelector = composerSelectors.find((selector) => deepQueryOne(document, selector)) || null;
    const composer = composerSelector ? deepQueryOne(document, composerSelector) : null;
    const classifyTurnRole = ({
      containerClassModel = false,
      containerClassUser = false,
      turnClassModel = false,
      turnClassUser = false,
      roleValue = '',
      headingText = '',
      structuralUser = false,
      structuralModel = false,
    } = {}) => {
      if (containerClassModel || turnClassModel || roleValue === 'model' || /model|模型/i.test(String(headingText || '')) || structuralModel) {
        return 'model';
      }
      if (containerClassUser || turnClassUser || roleValue === 'user' || structuralUser) {
        return 'user';
      }
      return 'unknown';
    };
    const modelTextSelectors = [
      // AI Studio's current model turn exposes the answer as ms-text-chunk.
      // Put leaf content before wrapper elements so action labels cannot be
      // returned as part of a broad turn-content container.
      'ms-text-chunk',
      'ms-model-turn-content',
      'ms-response-content',
      'ms-response',
      'ms-markdown-renderer',
      'ms-rendered-markdown',
      'ms-json-viewer',
      '[data-test*="json" i]',
      '[data-testid*="json" i]',
      '[data-message-content]',
      '[data-test="model-response"]',
      '[data-test*="response" i]',
      '[data-testid*="response" i]',
    ];
    const feedbackSelector = '[data-test*="feedback" i], [data-testid*="feedback" i], [aria-label*="Good response" i], [aria-label*="Bad response" i], [aria-label*="有帮助" i]';
    const thoughtSelector = 'ms-thought-chunk, [data-test*="thought" i], [data-testid*="thought" i]';
    // KaTeX renders each formula twice in the DOM: a visible .katex-html layer
    // (glyph layout, useless as plain text) and a hidden .katex-mathml layer
    // that carries the raw LaTeX source in an <annotation> element. Browsers
    // include both in innerText because the hidden layer is clipped, not
    // display:none, so reading a container node directly duplicates every
    // formula. Prefer the LaTeX source (annotation) so formulas round-trip
    // exactly as authored; only fall back to the readable Unicode math text
    // when no annotation exists.
    const replaceKatexWithLatex = (root) => {
      for (const katex of root.querySelectorAll?.('.katex') || []) {
        const annotation = katex.querySelector('annotation, annotation-xml');
        const latex = annotation?.textContent ? String(annotation.textContent).trim() : '';
        if (latex) {
          // Wrap the LaTeX in Markdown math delimiters, matching how AI Studio
          // renders it: display formulas (inside .katex-display) become $$...$$
          // and inline formulas become $...$. The extracted text then round-trips
          // straight into a Markdown document.
          const isDisplay = typeof katex.closest === 'function' && !!katex.closest('.katex-display');
          const delimiter = isDisplay ? '$$' : '$';
          const textNode = (katex.ownerDocument || document).createTextNode(`${delimiter}${latex}${delimiter}`);
          katex.parentNode?.replaceChild(textNode, katex);
        } else {
          // No LaTeX source: keep the math text, drop the glyph layer.
          katex.querySelectorAll('.katex-html').forEach((element) => element.remove());
        }
      }
      return root;
    };
    const katexCleanText = (node) => {
      if (!node || typeof node.cloneNode !== 'function') return '';
      const clone = node.cloneNode(true);
      return String((replaceKatexWithLatex(clone).innerText || clone.textContent) || '');
    };
    const normalizeNodeText = (node) => normalize(katexCleanText(node) || node?.innerText || node?.textContent || '');
    const isResponseControlNode = (node, headingElement = null) => {
      if (!node || node === headingElement) return true;
      const className = typeof node.className === 'string'
        ? node.className
        : String(node.className?.baseVal || '');
      const tagName = String(node.tagName || '').toLowerCase();
      const aria = String(node.getAttribute?.('aria-label') || '');
      const role = String(node.getAttribute?.('role') || '');
      const test = `${node.getAttribute?.('data-test') || ''} ${node.getAttribute?.('data-testid') || ''}`;
      const structuralMetadata = `${tagName} ${className} ${aria} ${role} ${test}`;
      if (typeof node.closest === 'function' && node.closest(
        'button, [role="button"], ms-chat-turn-options, .actions-container, .actions, .turn-footer, footer, .model-run-time-pill, .author-label, .timestamp, ms-thought-chunk, mat-expansion-panel, mat-expansion-panel-header, mat-panel-title',
      )) return true;
      return /material-symbols|material-icons|ms-chat-turn-options|actions-container|model-run-time-pill|author-label|timestamp|ms-thought-chunk|mat-expansion-panel|mat-panel-title|thoughts|思考|推理/i.test(structuralMetadata)
        || /good response|bad response|feedback|有帮助|hallucination|disclaimer/i.test(structuralMetadata);
    };
    const responseTextFromTurn = (turn, headingElement) => {
      const isExcluded = (node) => isResponseControlNode(node, headingElement);
      const explicitTexts = [];
      for (const selector of modelTextSelectors) {
        for (const node of deepQueryAll(turn, selector)) {
          const value = normalizeNodeText(node);
          if (!isExcluded(node) && value) explicitTexts.push(value);
        }
      }
      if (explicitTexts.length) return Array.from(new Set(explicitTexts)).join('\n\n');

      // Newer AI Studio builds may keep the model text in anonymous div/span
      // nodes while the feedback footer remains a sibling. Walk leaf content
      // nodes only, and remove controls/timing/disclaimer text structurally.
      const leafTexts = [];
      for (const node of deepQueryAll(turn, '*')) {
        const value = normalizeNodeText(node);
        if (isExcluded(node)) continue;
        if (!value || value === normalizeNodeText(headingElement)) continue;
        if (/^(?:good response|bad response|copy|regenerate|retry|\d+(?:\.\d+)?\s*s)$/i.test(value)) continue;
        const children = Array.from(node.children || []);
        const hasContentChild = children.some((child) => !isExcluded(child) && normalizeNodeText(child));
        if (hasContentChild) continue;
        const directText = Array.from(node.childNodes || [])
          .filter((child) => child.nodeType === 3)
          .map((child) => child.nodeValue || '')
          .join(' ');
        // A container's textContent includes excluded controls. Only use its
        // aggregate value when it has no element children; otherwise require
        // direct text so an action-only turn cannot become the response.
        if (children.length && !normalize(directText)) continue;
        const candidate = normalize(directText || value);
        if (candidate && !/^(?:good response|bad response|copy|regenerate|retry|\d+(?:\.\d+)?\s*s)$/i.test(candidate)) {
          leafTexts.push(candidate);
        }
      }
      const directTurnText = Array.from(turn.childNodes || [])
        .filter((child) => child.nodeType === 3)
        .map((child) => child.nodeValue || '')
        .join(' ');
      const directCandidate = normalize(directTurnText);
      if (directCandidate && !/^(?:good response|bad response|copy|regenerate|retry|\d+(?:\.\d+)?\s*s)$/i.test(directCandidate)) {
        leafTexts.unshift(directCandidate);
      }
      return Array.from(new Set(leafTexts)).join('\n\n');
    };
    const isDecorativeImage = (image) => {
      const decorativeRe = /avatar|logo|icon|thumbnail|preview|reference|profile|upload|上传|参考|头像/i;
      const metadata = [];
      let node = image;
      for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
        metadata.push(
          node.getAttribute?.('alt') || '',
          node.getAttribute?.('aria-label') || '',
          node.getAttribute?.('title') || '',
          node.getAttribute?.('class') || '',
          node.getAttribute?.('data-test') || '',
          node.getAttribute?.('data-testid') || '',
          node.getAttribute?.('role') || '',
        );
      }
      if (decorativeRe.test(metadata.join(' '))) return true;
      const src = image.currentSrc || image.src || '';
      const generated = src.startsWith('blob:') || src.startsWith('data:');
      const declaredWidth = Number(image.getAttribute?.('width')) || 0;
      const declaredHeight = Number(image.getAttribute?.('height')) || 0;
      const layoutWidth = Number(image.width) || declaredWidth;
      const layoutHeight = Number(image.height) || declaredHeight;
      return !generated
        && layoutWidth > 0 && layoutHeight > 0
        && layoutWidth < 128 && layoutHeight < 128;
    };
    const turns = deepQueryAll(document, 'ms-chat-turn').map((turn, index) => {
      const container = deepQueryOne(turn, '.chat-turn-container');
      const roleValue = String(
        container?.getAttribute('data-role')
          || turn.getAttribute('data-role')
          || '',
      ).toLowerCase();
      const headingElement = deepQueryOne(turn, '[role="heading"]');
      const headingText = normalize(headingElement?.textContent || '');
      const hasThinking = !!deepQueryOne(turn, thoughtSelector)
        || /^(?:thoughts?|思考|推理)$/i.test(normalize(deepQueryOne(turn, 'mat-panel-title')?.textContent || ''));
      const structuralModel = !!deepQueryOne(turn, 'ms-chat-loading-indicator, ms-model-turn-content, ms-response-content, ms-response, ms-markdown-renderer, ms-rendered-markdown')
        || !!deepQueryOne(turn, feedbackSelector)
        || (!!headingElement && /model|模型/i.test(headingElement.innerText || headingElement.textContent));
      const structuralUser = !!deepQueryOne(turn, 'ms-prompt-chunk, ms-prompt-image, ms-text-chunk');
      let role = classifyTurnRole({
        containerClassModel: !!container?.classList.contains('model'),
        containerClassUser: !!container?.classList.contains('user'),
        turnClassModel: turn.classList.contains('model'),
        turnClassUser: turn.classList.contains('user'),
        roleValue,
        headingText,
        structuralUser,
        structuralModel,
      });

      const chunks = deepQueryAll(turn, 'ms-prompt-chunk').filter((node) => !isResponseControlNode(node));
      const textChunks = deepQueryAll(turn, 'ms-text-chunk').filter((node) => !isResponseControlNode(node));
      // Rebuild Markdown structure (headings, lists, tables, code blocks,
      // formulas) from AI Studio's semantic render DOM. The chat UI keeps
      // semantic tags (<h1>-<h6>, <ul>/<ol>/<li>) and renders tables as literal
      // pipe rows prefixed by a |table| marker, so a lightweight DOM walk can
      // restore Markdown without a full HTML-to-Markdown converter.
      const extractAIStudioMarkdown = (root) => {
        if (!root || typeof root.cloneNode !== 'function') return '';
        const clone = root.cloneNode(true);
        // Drop interactive controls and their labels; keep code block content.
        clone.querySelectorAll('button, [role="button"], material-symbols, [aria-label*="copy" i], [aria-label*="download" i], [aria-label*="expand" i], [aria-label*="close" i], .model-run-time-pill, .author-label, .timestamp, mat-expansion-panel-header').forEach((el) => el.remove());
        // KaTeX formulas live inside a pre/code.rendered wrapper; tag those
        // pre elements BEFORE replaceKatexWithLatex removes the .katex nodes
        // so the walk below does not treat them as code blocks.
        clone.querySelectorAll('pre, ms-katex').forEach((el) => {
          if (el.querySelector('.katex')) el.setAttribute('data-ai-studio-katex', '1');
        });
        replaceKatexWithLatex(clone);

        // The chat UI renders a paragraph as one <p> holding inline elements
        // (span/strong/ms-katex/...). Browsers lay those out on a single line,
        // so extraction must mirror innerText: inline content accumulates into
        // the current line and only block boundaries (p, div, headings, list
        // items, table rows, br) flush a new line.
        const lines = [];
        let currentLine = '';
        const flush = () => {
          const trimmed = currentLine.trim();
          if (trimmed) lines.push(trimmed);
          currentLine = '';
        };
        const appendText = (raw) => {
          // Defensive: table rows can appear as literal pipe text (|table|).
          if (String(raw).includes('|table|')) {
            flush();
            for (const piece of String(raw).split('\n')) {
              const t = piece.trim();
              if (t && t !== '|table|') lines.push(t);
            }
            return;
          }
          const text = String(raw).replace(/\s+/g, ' ');
          if (!text) return;
          // Display formulas stand on their own line; inline text accumulates.
          const parts = String(text).split(/(\$\$[\s\S]+?\$\$)/).filter((p) => p !== '');
          for (const part of parts) {
            if (/^\$\$[\s\S]+\$\$$/.test(part.trim())) {
              flush();
              lines.push(part.trim());
            } else {
              currentLine += part;
            }
          }
        };
        const BLOCK = new Set(['DIV', 'P', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'BLOCKQUOTE', 'TD', 'TH', 'TR']);

        const walk = (node, orderedIndex) => {
          for (const child of Array.from(node.childNodes || [])) {
            if (child.nodeType === 3) {
              appendText(child.nodeValue || '');
              continue;
            }
            if (child.nodeType !== 1) continue;
            const tag = String(child.tagName || '').toUpperCase();
            // Code blocks: emit their pre/code content verbatim, skipping the
            // line-number spans AI Studio interleaves. KaTeX formulas also
            // live inside a pre/code.rendered wrapper; those are handled by
            // replaceKatexWithLatex, so only treat as a code block when no
            // formula remains.
            if (tag === 'MS-CODE-BLOCK' || (tag === 'PRE' && child.getAttribute('data-ai-studio-katex') !== '1')) {
              flush();
              const code = child.querySelector('pre code, code') || child;
              const codeClone = typeof code.cloneNode === 'function' ? code.cloneNode(true) : code;
              // Syntax highlighters wrap tokens in nested spans. Reading only
              // direct text nodes drops those tokens (and their spaces), while
              // reading the full node can include line-number/tooling spans.
              codeClone.querySelectorAll?.(
                '[class*="line-number" i], .line-number, [data-line-number], [data-test*="line-number" i], button, [role="button"]',
              )?.forEach((element) => element.remove());
              codeClone.querySelectorAll?.('br')?.forEach((br) => {
                const lineBreak = (codeClone.ownerDocument || document).createTextNode('\n');
                br.parentNode?.replaceChild(lineBreak, br);
              });
              // `innerText` treats inline syntax-token spans as visual line
              // boxes in some DOM implementations (including jsdom), which
              // inserts spurious newlines between `const` and its identifier.
              // The code node has already had line-number controls removed and
              // `<br>` elements converted above, so textContent now preserves
              // token spacing while retaining explicit line breaks.
              const content = String(codeClone.textContent || codeClone.innerText || child.textContent || '')
                .replace(/\r\n?/g, '\n');
              if (content.trim()) lines.push('```\n' + content.trim() + '\n```');
              continue;
            }
            if (/^H[1-6]$/.test(tag)) {
              flush();
              const text = (child.textContent || '').trim();
              if (text) lines.push('#'.repeat(Number(tag[1])) + ' ' + text);
              continue;
            }
            if (tag === 'LI') {
              flush();
              const text = (child.textContent || '').trim();
              if (!text) continue;
              if (orderedIndex && orderedIndex[0] != null) {
                lines.push(`${orderedIndex[0]}. ${text}`);
                orderedIndex[0] += 1;
              } else {
                lines.push(`- ${text}`);
              }
              continue;
            }
            if (tag === 'OL') {
              flush();
              walk(child, [1]);
              flush();
              continue;
            }
            if (tag === 'UL' || tag === 'THEAD' || tag === 'TBODY' || tag === 'BLOCKQUOTE') {
              flush();
              walk(child, null);
              flush();
              continue;
            }
            if (tag === 'TABLE') {
              // AI Studio renders markdown tables as real <table> tags; emit
              // them as pipe rows (header row + --- separator + body rows).
              flush();
              const rows = Array.from(child.querySelectorAll('tr'));
              const grid = rows
                .map((row) => Array.from(row.querySelectorAll('th, td')).map((cell) => (cell.textContent || '').trim()))
                .filter((cells) => cells.length > 0);
              if (grid.length >= 2) {
                const maxCols = Math.max(...grid.map((r) => r.length));
                grid.forEach((row) => { while (row.length < maxCols) row.push(''); });
                lines.push('| ' + grid[0].join(' | ') + ' |');
                lines.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
                for (let r = 1; r < grid.length; r++) lines.push('| ' + grid[r].join(' | ') + ' |');
              } else {
                walk(child, null);
              }
              continue;
            }
            if (tag === 'BR') {
              flush();
              continue;
            }
            if (tag === 'HR') {
              flush();
              lines.push('---');
              continue;
            }
            if (BLOCK.has(tag)) {
              flush();
              walk(child, orderedIndex);
              flush();
              continue;
            }
            // Inline containers (span, strong, em, a, code, ms-katex,
            // ms-cmark-node, ...): recurse; text accumulates on current line.
            walk(child, orderedIndex);
          }
        };

        walk(clone, null);
        flush();
        return lines.join('\n');
      };
      const joinChunkText = (nodes) => Array.from(new Set(nodes
        .map((chunk) => {
          // Falls back to the raw chunk text when the host has no DOM cloning
          // (fixtures/offline).
          if (typeof chunk.cloneNode !== 'function') {
            return normalize(chunk.innerText || chunk.textContent);
          }
          return extractAIStudioMarkdown(chunk);
        })
        .filter(Boolean))).join('\n\n');
      const promptChunkText = joinChunkText(chunks);
      const textChunkText = joinChunkText(textChunks);
      // Some builds do not expose an `ms-text-chunk`/response wrapper and
      // leave the answer under a generic turn-content container. Reuse the
      // structural Markdown walker for that case so syntax-token spans remain
      // one code line instead of being split into unrelated leaf paragraphs.
      const markdownRoot = deepQueryOne(turn, '.turn-content, .response-content, [data-message-content]');
      const genericMarkdownText = role === 'model' && markdownRoot
        ? extractAIStudioMarkdown(markdownRoot)
        : '';
      const thinkingOnly = hasThinking && !textChunkText;
      // Streamed reasoning content (ms-thought-chunk) — used by the response
      // wait as an activity signal so long thinking phases never look stalled.
      const thinkingText = normalize(deepQueryAll(turn, thoughtSelector)
        .map((node) => String(node.innerText || node.textContent || ''))
        .join(' '));
      const responseText = role === 'model'
        ? (textChunkText || genericMarkdownText || responseTextFromTurn(turn, headingElement))
        : normalize(deepQueryOne(turn, '.message-content, .turn-content')?.innerText || '');
      // AI Studio can leave a prompt-shaped shadow node in a model turn while
      // the actual answer is rendered by ms-text-chunk. Keep the chunk types
      // role-specific so a partial prompt node cannot be concatenated with the
      // response and returned as duplicated or truncated model text.
      const text = role === 'model'
        ? (textChunkText || responseText || promptChunkText)
        : (promptChunkText || responseText || textChunkText);
      const rawTurnText = deepText(turn) || normalize(text);

      // Ghost turn defense: A valid user turn MUST contain user-specific structural elements.
      if (role === 'user' && !deepQueryOne(turn, 'img, video, audio, ms-prompt-chunk, ms-prompt-image, ms-text-chunk, ms-file-chunk')) {
        role = 'unknown';
      }

      const loading = role === 'model' && (
        !!deepQueryOne(turn, 'ms-chat-loading-indicator, [role="progressbar"], [aria-busy="true"]')
        || (!text && /正在思考|思考中|生成中|thinking|loading|generating/i.test(rawTurnText))
      );
      // A structural error node inside the turn is authoritative; the whole-turn
      // text scan is only a fallback for short turns with an unmistakable idiom.
      const isStructuredErrorNode = (node) => {
        if (!node) return false;
        const text = normalize(node.innerText || node.textContent || '');
        const metadata = [
          node.getAttribute?.('aria-label') || '',
          node.getAttribute?.('data-error') || '',
          node.getAttribute?.('role') || '',
          node.getAttribute?.('aria-live') || '',
          node.className || '',
          node.tagName || '',
        ].join(' ');
        const explicitSurface = node.matches?.('.error-message, ms-error-message, [data-error]') === true;
        // role=alert/aria-live are also used by AI Studio's normal streaming
        // region. Generic words such as "error", "login", or "subscription"
        // can be legitimate answer text, so only the narrow short-error/refusal
        // idioms apply there. Explicit error elements remain authoritative.
        const searchable = `${metadata} ${text}`;
        const liveRegionError = (text.length <= maxInlineErrorLength && inlineErrorRe.test(searchable))
          || (text.length <= blockedContentMaxLength && blockedContentRe.test(searchable));
        return explicitSurface || liveRegionError;
      };
      const errorNode = deepQueryAll(turn, errorNodeSelector).find(isStructuredErrorNode) || null;
      // Strong refusal idioms (e.g. "Prohibited content") bypass the short-turn
      // length gate: a blocked generation usually renders a full paragraph, and
      // failing to classify it would leave the wait loop idling to the deadline.
      const blockedContent = role === 'model'
        && rawTurnText.length <= blockedContentMaxLength
        && blockedContentRe.test(rawTurnText);
      const inlineError = role === 'model'
        ? (blockedContent
            ? rawTurnText
            : errorNode
                ? normalize(errorNode.innerText || errorNode.textContent || '')
                : (rawTurnText.length <= maxInlineErrorLength && inlineErrorRe.test(rawTurnText)
                    ? rawTurnText
                    : null))
        : null;
      const images = role === 'model' ? deepQueryAll(turn, 'img').flatMap((image) => {
        const src = image.currentSrc || image.src || '';
        const alt = String(image.getAttribute?.('alt') || '');
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (!src || isDecorativeImage(image)) return [];
        // Generated images must meet a real render size; a tiny asset is a UI
        // fragment (error banner, icon) rather than a generated picture. Width
        // 0 assets are still decoding and stay eligible for pendingDecode.
        if (width > 0 && height > 0 && (width < 512 || height < 512)) return [];
        return { src, alt, width, height };
      }) : role === 'user' ? deepQueryAll(turn, 'ms-image-chunk img, ms-prompt-image img').flatMap((image) => {
        const src = image.currentSrc || image.src || '';
        const alt = String(image.getAttribute?.('alt') || '');
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        return src ? [{ src, alt, width, height }] : [];
      }) : [];
      // Keep non-decorative remote assets even before they acquire dimensions:
      // AI Studio may expose generated images as remote URLs while the image is
      // still decoding. Decorative avatars/icons are filtered by their own
      // metadata or a small declared layout size.
      const pendingDecode = role === 'model' && deepQueryAll(turn, 'img').some((image) => {
        const src = image.currentSrc || image.src || '';
        if (!src || isDecorativeImage(image)) return false;
        return !(image.naturalWidth || image.width) || !(image.naturalHeight || image.height);
      });
      const fingerprint = JSON.stringify({
        role,
        text: normalize(text),
        images: images.map((image) => image.src),
      });
      return {
        id: turn.id || fingerprint || `${role}-${index}`,
        fingerprint,
        role,
        text,
        images,
        pendingDecode,
        thinking: hasThinking,
        thinkingText,
        thinkingOnly,
        hasMedia: !!deepQueryOne(turn, 'img, video, audio, ms-prompt-image, ms-image-chunk'),
        error: inlineError,
        loading,
        complete: role === 'model' && !loading && !thinkingOnly && !!deepQueryOne(turn,
          '.turn-footer, [data-test*="feedback" i], [aria-label*="Good response" i], [aria-label*="Bad response" i], [aria-label*="有帮助" i]',
        ),
      };
    });
    const buttons = deepQueryAll(document, 'button');
    const isGenerating = buttons.some((button) => {
      const aria = normalize(button.getAttribute('aria-label'));
      const text = normalize(button.textContent);
      return /^(?:stop|cancel|停止生成|取消)(?:\s|$)/i.test(`${aria} ${text}`.trim());
    });
    const pageAlerts = deepQueryAll(document,
      '[role="alert"], [aria-live="assertive"], mat-snack-bar-container, .mat-mdc-snack-bar-label, .error-message, ms-error-message, [data-error]',
    ).flatMap((element) => {
      const text = normalize(element.innerText || element.textContent);
      const metadata = `${element.className || ''} ${element.getAttribute('aria-label') || ''}`;
      const searchable = `${metadata} ${text}`;
      const explicitSurface = element.matches('.error-message, ms-error-message, [data-error]');
      const snackbarSurface = element.matches('mat-snack-bar-container, .mat-mdc-snack-bar-label');
      const liveRegionError = (text.length <= maxInlineErrorLength && inlineErrorRe.test(searchable))
        || (text.length <= blockedContentMaxLength && blockedContentRe.test(searchable));
      const isError = explicitSurface || (snackbarSurface ? errorRe.test(searchable) : liveRegionError);
      if (!text || !isError) return [];
      // A broad live region can wrap the whole conversation (author labels,
      // action icons, thinking indicator) next to the actual refusal. Trim to a
      // window around the first error-phrase match so the alert stays readable.
      if (text.length > 160) {
        const match = errorRe.exec(text);
        if (match) {
          const start = Math.max(0, match.index - 20);
          return [text.slice(start, match.index + match[0].length + 60)];
        }
      }
      return [text];
    });
    const alerts = Array.from(new Set([
      ...pageAlerts,
      ...turns.flatMap((turn) => turn.error ? [turn.error] : []),
    ]));
    const runSelector = runSelectors.find((selector) => deepQueryOne(document, selector)) || null;
    const runButton = runSelector ? deepQueryOne(document, runSelector) : null;
    const runButtonDisabled = !!runButton && (
      runButton.disabled || runButton.getAttribute('aria-disabled') === 'true'
    );
    const runButtonLabel = runButton
      ? normalize(`${runButton.getAttribute('aria-label') || ''} ${runButton.getAttribute('title') || ''}`)
      : '';
    const runButtonText = runButton ? normalize(runButton.textContent || '') : '';
    const isCtrl = /\b(?:ctrl|control|cmd|command)\b/i.test(runButtonLabel)
      || runButtonLabel.includes('⌘')
      || /\b(?:ctrl|control|cmd|command)\b/i.test(runButtonText)
      || runButtonText.includes('⌘');
    // The submit key follows the account setting, which AI Studio exposes in the
    // Run button tooltip. Newlines do not change Enter-vs-Ctrl+Enter, so they
    // must never be used to infer the shortcut (that mis-submits multi-line
    // prompts on accounts configured for Enter-to-send).
    const runButtonShortcut = runButton ? (isCtrl ? 'ctrl-enter' : 'enter') : null;
    return {
      url: window.location.href,
      turns,
      isGenerating,
      composerSelector,
      composerText: composer?.value ?? '',
      runButtonFound: !!runButton,
      runButtonDisabled,
      runButtonShortcut,
      alerts,
    };
  }, AI_STUDIO_SELECTORS.composer, AI_STUDIO_SELECTORS.runButton, AI_STUDIO_ERROR_RE.source, AI_STUDIO_INLINE_ERROR_RE.source, AI_STUDIO_ERROR_NODE_SELECTOR, AI_STUDIO_INLINE_ERROR_MAX_LENGTH, AI_STUDIO_BLOCKED_CONTENT_RE.source, AI_STUDIO_BLOCKED_CONTENT_MAX_LENGTH);
}

export function findNewModelTurn(snapshot, baseline) {
  return findNewAIStudioTurns(snapshot, baseline?.baseline || baseline, 'model')
    .filter((turn) => !turn.thinkingOnly)
    .at(-1) || null;
}

export async function focusAIStudioComposer(page, composerSelector) {
  if (!composerSelector) throw new CommandExecutionError('AI Studio prompt editor was not found');

  const readFocusState = () => evaluatePage(page, 'AI Studio prompt editor focus state', (selector) => {
    const composer = document.querySelector(selector);
    return {
      composerFound: !!composer,
      focused: !!composer && (document.activeElement === composer || composer.matches(':focus')),
    };
  }, composerSelector);

  if (typeof page.focus === 'function') {
    try { await page.focus(composerSelector); } catch (_) {}
  }
  let focusState = await readFocusState();
  if (!focusState?.focused && typeof page.click === 'function') {
    try { await page.click(composerSelector); } catch (_) {}
    focusState = await readFocusState();
  }
  if (!focusState?.focused) {
    throw new CommandExecutionError('AI Studio prompt editor did not receive focus after media upload');
  }
  return focusState;
}

async function bringAIStudioWindowToFront(page) {
  if (typeof page.cdp !== 'function') return 'cdp-unavailable';
  try {
    const targetId = typeof page.getActivePage === 'function' ? page.getActivePage() || null : null;
    const params = targetId ? { targetId } : {};
    const windowInfo = await page.cdp('Browser.getWindowForTarget', params);
    const windowId = windowInfo?.windowId ?? windowInfo?.result?.windowId;
    if (!windowId) return 'cdp-no-window';
    await page.cdp('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await page.cdp('Page.bringToFront', {}).catch(() => {});
    return 'cdp-restored';
  } catch {
    return 'cdp-failed';
  }
}

// Windows-only last resort: Chrome drops CDP-native key events in minimized
// windows, and AI Studio delays rendering the completed model turn until the
// tab is visible again. CDP Browser.setWindowBounds is tried first; this
// PowerShell/user32 restore is the fallback and is a no-op on other platforms.
// The window may be merely occluded (not minimized), so besides SW_RESTORE it
// briefly raises the window above others with SetWindowPos(HWND_TOPMOST) —
// that call is not subject to Windows focus-stealing rules and works from a
// background process, which is what forces Chrome to un-throttle the tab's
// rendering. The topmost flag is cleared again before the helper returns so a
// restore nudge cannot leave every AI Studio window permanently on top.
function restoreAIStudioWindow(pageTitle = '') {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = [
      "Add-Type @'",
      'using System;',
      'using System.Text;',
      'using System.Runtime.InteropServices;',
      'public class OpenCliWin {',
      '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
      '  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);',
      '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
      '  public static string[] List() {',
      '    var rows = new System.Collections.Generic.List<string>();',
      '    EnumWindows((h, l) => {',
      '      var title = new StringBuilder(512); GetWindowText(h, title, 512);',
      '      var cls = new StringBuilder(256); GetClassName(h, cls, 256);',
      '      if (cls.ToString().Contains("Chrome_WidgetWin") && title.ToString().IndexOf("AI Studio", StringComparison.OrdinalIgnoreCase) >= 0) {',
      '        rows.Add(h.ToInt64() + "|" + (IsIconic(h) ? "1" : "0") + "|" + title);',
      '      }',
      '      return true;',
      '    }, IntPtr.Zero);',
      '    return rows.ToArray();',
      '  }',
      '  public static int Raise(string row, bool top) {',
      "    IntPtr h = new IntPtr(long.Parse(row.Split('|')[0]));",
      '    ShowWindow(h, 9);',
      '    if (top) { const uint SWP_NOMOVE=0x0002, SWP_NOSIZE=0x0001, SWP_NOACTIVATE=0x0010; SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE); }',
      '    SetForegroundWindow(h);',
      '    return 1;',
      '  }',
      '  public static void ClearTop(string row) {',
      "    IntPtr h = new IntPtr(long.Parse(row.Split('|')[0]));",
      '    const uint SWP_NOMOVE=0x0002, SWP_NOSIZE=0x0001, SWP_NOACTIVATE=0x0010; SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);',
      '  }',
      '}',
      "'@",
      // Raise every AI Studio window. The page-title hint is unreliable across
      // encodings (the owned window may carry a localized/garbled title) and
      // must never exclude the window that hosts the active session tab, so it
      // only orders the list (minimized first); every match still gets raised.
      '$rows = [OpenCliWin]::List()',
      '$iconic = @($rows | Where-Object { ($_ -split "\\|")[1] -eq "1" })',
      '$rows = @($iconic + $rows | Select-Object -Unique)',
      'foreach ($r in $rows) { [OpenCliWin]::Raise($r, $true) | Out-Null }',
      'Start-Sleep -Milliseconds 1200',
      'foreach ($r in $rows) { [OpenCliWin]::ClearTop($r) }',
      'Write-Output ("restored=" + $rows.Count)',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      timeout: 12000,
      windowsHide: true,
    }, (error, stdout = '') => {
      const restored = Number(String(stdout || '').match(/restored=(\d+)/)?.[1] ?? -1);
      resolve(!error && restored > 0);
    });
  });
}

export async function submitAIStudioComposerWithKeyboard(page, options = {}) {
  const {
    composerSelector,
    expectedText = '',
    readComposerState = null,
    readFocusState = null,
    forceShortcut = null,
    deadline = null,
    windowMode: requestedWindowMode = null,
  } = options;
  const windowMode = requestedWindowMode || page?.windowMode;
  const text = String(expectedText ?? '');
  if (!composerSelector) throw new CommandExecutionError('AI Studio prompt editor was not found');
  if (typeof page.pressKey !== 'function') {
    throw new CommandExecutionError('The active OpenCLI browser backend cannot prime the prompt editor with End');
  }

  // Resolve the OS once so the priming caret move and the submit keypress use
  // the same modifier (Meta on macOS, Control elsewhere).
  const isMac = await evaluatePage(page, 'AI Studio OS detection', () => /Mac|iPod|iPhone|iPad/i.test(navigator.platform));

  const getFocusState = readFocusState || (() => evaluatePage(page, 'AI Studio prompt editor focus state', (selector) => {
    const composer = document.querySelector(selector);
    return {
      composerFound: !!composer,
      focused: !!composer && (document.activeElement === composer || composer.matches(':focus')),
    };
  }, composerSelector));
  const getComposerState = readComposerState || (() => evaluatePage(page, 'AI Studio prompt editor primed state', (expectedPrompt, composerCandidates) => {
    const composerSelectorInPage = composerCandidates.find((selector) => document.querySelector(selector)) || null;
    const composer = composerSelectorInPage ? document.querySelector(composerSelectorInPage) : null;
    const value = composer?.value ?? '';
    return {
      composerFound: !!composer,
      composerSelector: composerSelectorInPage,
      composerLength: value.length,
      promptReady: value === expectedPrompt,
      focused: !!composer && (document.activeElement === composer || composer.matches(':focus')),
      connected: !!composer?.isConnected,
      selectionStart: Number.isInteger(composer?.selectionStart) ? composer.selectionStart : null,
      selectionEnd: Number.isInteger(composer?.selectionEnd) ? composer.selectionEnd : null,
    };
  }, text, AI_STUDIO_SELECTORS.composer));

  const refocused = await page.focus(composerSelector);
  if (!refocused?.focused) throw new CommandExecutionError('Failed to refocus the AI Studio prompt editor before keyboard submit');
  const focusState = await getFocusState();
  if (!focusState?.focused) {
    throw new CommandExecutionError('AI Studio prompt editor lost focus before keyboard submit');
  }

  // Plain End on a multi-line textarea only reaches the current line end, so use
  // Control/Meta+End to move the caret to the true end of the prompt.
  await page.pressKey(isMac ? 'Meta+End' : 'Control+End');
  // Belt-and-suspenders: native End/Control+End move the caret, but a synthetic
  // key fallback cannot. Force the caret to the true end so the single submit
  // keypress appends at the end regardless of line count.
  await evaluatePage(page, 'AI Studio prompt editor caret end', (selector) => {
    const composer = document.querySelector(selector);
    if (!(composer instanceof HTMLTextAreaElement)) return false;
    composer.setSelectionRange(composer.value.length, composer.value.length);
    return true;
  }, composerSelector).catch(() => {});
  const primedState = await waitForAIStudioState(
    page,
    'AI Studio prompt editor priming',
    getComposerState,
    (state) => {
      const atEnd = !Number.isInteger(state?.selectionStart)
        || (state.selectionStart === state.composerLength && state.selectionEnd === state.composerLength);
      return !!state?.promptReady && !!state?.focused && atEnd;
    },
    {
      deadline: capAIStudioDeadline(deadline, 5),
      timeoutSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: `Expected ${text.length} characters and a focused editor at the end of the prompt.`,
    },
  );
  const primedFocusState = primedState?.focused ? primedState : await getFocusState();
  if (!primedFocusState?.focused) {
    throw new CommandExecutionError('AI Studio prompt editor lost focus after keyboard priming');
  }

  const readySnapshot = await waitForAIStudioState(
    page,
    'AI Studio media and long-text synchronization',
    () => readAIStudioSnapshot(page),
    (snapshot) => snapshot?.runButtonFound === true && snapshot.runButtonDisabled === false,
    {
      deadline,
      timeoutSeconds: 15,
      pollSeconds: 0.2,
      timeoutMessage: 'AI Studio media and long-text synchronization timed out; the Run button did not become enabled.',
    },
  );

  const refocusedAfterWait = await focusAIStudioComposer(page, composerSelector);
  if (!refocusedAfterWait?.focused) {
    throw new CommandExecutionError('Failed to refocus the AI Studio prompt editor before keyboard submit');
  }

  // AI Studio recalculates tokens for long prompts after the Run button enables;
  // a keypress inside that window is silently ignored. Require a stable, complete
  // token count before the single native shortcut.
  let previousTokenText = '';
  let stableTokenSamples = 0;
  await waitForAIStudioState(
    page,
    'AI Studio composer token-count synchronization',
    () => evaluatePage(page, 'AI Studio composer token-count state', () => {
      const root = document.querySelector('ms-prompt-box') || document.querySelector('ms-prompt-renderer');
      const header = document.querySelector('ms-token-count');
      const tokenText = [
        header?.textContent || '',
        root?.querySelector('ms-token-status')?.textContent || '',
      ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
      const busyNodes = Array.from((root?.querySelectorAll('[aria-busy="true"], mat-progress-spinner, [role="progressbar"]') || []))
        .concat(Array.from(header?.querySelectorAll('[aria-busy="true"], mat-progress-spinner, [role="progressbar"]') || []));
      const busy = busyNodes.some((node) => {
        const label = `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`;
        return /upload|上传|processing|处理中|counting|计算|thinking|思考|generating|生成/i.test(label);
      });
      return { busy, tokenText, hasTokenCount: /\d[\d,]*\s*(?:token|tokens|令牌)/i.test(tokenText) };
    }),
    (state) => {
      if (!state.tokenText) return true;
      if (state.busy || !state.hasTokenCount) {
        previousTokenText = '';
        stableTokenSamples = 0;
        return false;
      }
      if (state.tokenText === previousTokenText) stableTokenSamples += 1;
      else {
        previousTokenText = state.tokenText;
        stableTokenSamples = 1;
      }
      return stableTokenSamples >= 2;
    },
    {
      deadline: capAIStudioDeadline(deadline, 10),
      timeoutSeconds: 10,
      pollSeconds: 0.2,
      timeoutMessage: 'AI Studio did not finish token counting before the submit keypress.',
    },
  );

  const shortcut = forceShortcut || readySnapshot?.runButtonShortcut || 'enter';
  const modifierKey = isMac ? 'Meta' : 'Control';
  const keyToPress = shortcut === 'ctrl-enter' ? `${modifierKey}+Enter` : 'Enter';

  // AI Studio can re-render the composer while upload/settings settle; wait until it is
  // connected and focused immediately before the single submit keypress.
  await waitForAIStudioState(
    page,
    'AI Studio prompt editor pre-submit stability',
    async () => {
      let state = await getComposerState();
      if (!state?.focused || state.connected === false) {
        await focusAIStudioComposer(page, composerSelector).catch(() => {});
        state = await getComposerState();
      }
      return state;
    },
    (state) => !!state?.promptReady && !!state?.focused && state.connected !== false,
    {
      deadline: capAIStudioDeadline(deadline, 5),
      timeoutSeconds: 5,
      pollSeconds: 0.1,
      timeoutMessage: 'AI Studio prompt editor did not stay connected and focused before the single submit keypress.',
    },
  );

  // Foreground mode may restore and select the tab so a trusted native key
  // reaches the visible composer. Background mode must never bring Chrome or
  // the tab to the front; it uses the one-click hidden-window branch below.
  if (windowMode !== 'background') {
    if (typeof page.cdp === 'function' && typeof page.getActivePage === 'function') {
      const pageTitle = await evaluatePage(page, 'AI Studio page title', () => document.title).catch(() => '');
      const restoreMode = await bringAIStudioWindowToFront(page);
      if (restoreMode !== 'cdp-restored') await restoreAIStudioWindow(pageTitle);
    }
    if (typeof page.selectTab === 'function' && typeof page.getActivePage === 'function') {
      try {
        const targetId = page.getActivePage();
        if (targetId) await page.selectTab(targetId);
      } catch (_) {}
    }
    if (typeof page.cdp === 'function') {
      await page.cdp('Page.bringToFront', {}).catch(() => {});
    }
    await evaluatePage(page, 'AI Studio window focus', () => { window.focus(); return true; }).catch(() => {});
  }

  let tabState = await evaluatePage(page, 'AI Studio tab state', () => ({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  if (windowMode !== 'background'
    && tabState?.visibilityState !== 'visible'
    && typeof page.cdp === 'function'
    && typeof page.getActivePage === 'function') {
    const pageTitle = await evaluatePage(page, 'AI Studio page title', () => document.title).catch(() => '');
    await restoreAIStudioWindow(pageTitle);
    tabState = await evaluatePage(page, 'AI Studio tab state', () => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
    }));
  }

  let submittedAction = null;
  let submittedShortcut = null;
  if (windowMode !== 'background' && tabState?.visibilityState === 'visible') {
    // `page.pressKey()` is intentionally not used for the submit action: its
    // generic fallback dispatches a synthetic DOM KeyboardEvent when CDP is
    // unavailable, and AI Studio rejects that path (often as a misleading 403).
    // A visible tab must have one trusted CDP keypress; if the bridge cannot
    // provide it, fail rather than silently changing the submission contract.
    if (typeof page.nativeKeyPress !== 'function') {
      throw new CommandExecutionError(
        'The active OpenCLI browser backend cannot send a trusted AI Studio submit key',
        'Use a Browser Bridge with nativeKeyPress support, or run the command in background mode so the single Run-button branch can be used.',
      );
    }
    const nativeModifiers = shortcut === 'ctrl-enter' ? [isMac ? 'Meta' : 'Control'] : [];
    await page.nativeKeyPress('Enter', nativeModifiers);
    submittedAction = 'cdp-press-key';
    submittedShortcut = keyToPress;
  } else {
    const runClicked = await evaluatePage(page, 'AI Studio Run button click', (runSelectors) => {
      const runButton = runSelectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (!runButton) return { ok: false, reason: 'run button not found' };
      if (runButton.disabled || runButton.getAttribute('aria-disabled') === 'true') {
        return { ok: false, reason: 'run button disabled' };
      }
      runButton.click();
      return { ok: true };
    }, AI_STUDIO_SELECTORS.runButton);
    if (!runClicked?.ok) {
      throw new CommandExecutionError('Failed to submit the AI Studio prompt', runClicked?.reason || 'Run button click failed');
    }
    submittedAction = 'js-run-click';
  }

  return {
    action: submittedAction,
    composerState: primedState,
    shortcut: submittedShortcut,
    submitKey: shortcut,
    modifierKey,
  };
}

// Wait for the one native keyboard action (or the one hidden-window Run click)
// to become observable. A delayed DOM response is handled by continued polling;
// there is deliberately no second keyboard or DOM submission action.
export async function waitForAIStudioSubmission(page, waitStateFn, deadline) {
  const wait = (maxSeconds, timeoutMessage) => waitForAIStudioState(
    page,
    'AI Studio prompt submission',
    waitStateFn,
    (result) => !!result,
    { deadline: capAIStudioDeadline(deadline, maxSeconds), pollSeconds: 0.2, timeoutMessage },
  );
  try {
    return await wait(4, 'The prompt was inserted and the native shortcut was attempted once, but AI Studio did not expose a new user turn.');
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error;
    return await wait(30, 'The single AI Studio submission action was attempted, but AI Studio did not expose a new user turn. No second submission action was issued.');
  }
}

export async function sendAIStudioMessage(page, prompt, options = {}) {
  const deadline = options.deadline || createAIStudioDeadline(options.timeoutSeconds || 30);
  await ensureAIStudioPage(page, { deadline });
  const text = normalizeAIStudioPrompt(prompt);
  if (!text.trim()) throw new ArgumentError('prompt must not be empty');
  const baseline = await readAIStudioSnapshot(page);
  const composerSelector = await evaluatePage(page, 'AI Studio prompt editor', (selectors) => {
    return selectors.find((selector) => document.querySelector(selector)) || null;
  }, AI_STUDIO_SELECTORS.composer);
  if (!composerSelector) throw new CommandExecutionError('AI Studio prompt editor was not found');

  // Clear menus before filling so Escape cannot consume or blur the prompt text.
  await closeAIStudioTransientOverlays(page, { deadline });
  await focusAIStudioComposer(page, composerSelector);

  let filled = null;
  try {
    filled = await page.fillText(composerSelector, text);
  } catch (error) {
    filled = { verified: false, error: String(error?.message || error) };
  }
  if (!filled?.verified) {
    filled = await evaluatePage(page, 'AI Studio prompt editor fallback input', (selector, value) => {
      const composer = document.querySelector(selector);
      if (!(composer instanceof HTMLTextAreaElement)) return { verified: false, reason: 'textarea not found' };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(composer, value);
      else composer.value = value;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value.slice(-1) }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return { verified: composer.value === value, length: composer.value.length };
    }, composerSelector, text);
  }
  if (!filled?.verified) {
    throw new CommandExecutionError(
      'Failed to insert text into the AI Studio prompt editor',
      `Expected ${text.length} characters; the editor reported ${filled?.length ?? 0}.`,
    );
  }
  const readComposerState = async () => evaluatePage(page, 'AI Studio prompt editor state', (expectedText, composerCandidates) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const composerSelectorInPage = composerCandidates.find((selector) => document.querySelector(selector)) || null;
    const composer = composerSelectorInPage ? document.querySelector(composerSelectorInPage) : null;
    const value = composer?.value ?? '';
    return {
      composerFound: !!composer,
      composerSelector: composerSelectorInPage,
      composerLength: value.length,
      promptReady: value === expectedText,
      focused: !!composer && (document.activeElement === composer || composer.matches(':focus')),
      selectionStart: Number.isInteger(composer?.selectionStart) ? composer.selectionStart : null,
      selectionEnd: Number.isInteger(composer?.selectionEnd) ? composer.selectionEnd : null,
    };
  }, text, AI_STUDIO_SELECTORS.composer);

  let currentAction, currentShortcut;
  const initialSubmit = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector,
    expectedText: text,
    readComposerState,
    deadline,
  });
  currentAction = initialSubmit.action;
  currentShortcut = initialSubmit.shortcut;

  const waitStateFn = async () => {
    const current = await readAIStudioSnapshot(page);
    const evidence = getAIStudioSubmissionEvidence(current, baseline, text);
    if (current.alerts.length) {
      throw new CommandExecutionError(`AI Studio rejected the prompt: ${current.alerts.join(' | ')}`);
    }
    if (evidence.reason === 'multiple-new-user-turns') {
      throw new CommandExecutionError(
        'AI Studio produced multiple new user turns for one prompt',
        'The adapter stopped before issuing another submission action; inspect the retained trace.',
      );
    }
    return evidence.ok ? { current, evidence } : null;
  };

  const submissionResult = await waitForAIStudioSubmission(page, waitStateFn, deadline);

  return {
    baseline,
    submittedSnapshot: submissionResult.current,
    evidence: submissionResult.evidence,
    action: currentAction,
    shortcut: currentShortcut,
  };
}

// AI Studio's per-response menu (the three-dot button next to "Rerun this
// turn") exposes a "Copy as Markdown" action that writes the original
// Markdown source to the clipboard. The rendered DOM snapshot used for
// waitForAIStudioResponse loses Markdown syntax (headings, lists, table
// pipes, formula delimiters), so when the caller opts in we open that menu and
// read the clipboard to recover the exact Markdown. Returns the Markdown
// string, or '' when the menu/clipboard is unavailable.
export function matchesAIStudioMarkdownClipboard(markdown, expectedText) {
  const comparable = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '')
    .toLowerCase();
  const expected = comparable(expectedText);
  const actual = comparable(markdown);
  if (!expected || !actual) return false;
  if (expected.length < 4) return actual === expected;
  const containment = actual.includes(expected) || expected.includes(actual);
  const lengthRatio = Math.min(actual.length, expected.length) / Math.max(actual.length, expected.length);
  return containment && lengthRatio >= 0.8;
}

async function copyAIStudioResponseAsMarkdown(page, expectedText = '') {
  if (typeof page.evaluate !== 'function') return '';
  const opened = await evaluatePage(page, 'AI Studio open response menu', () => {
    const candidates = Array.from(document.querySelectorAll('ms-chat-turn'));
    const turn = candidates[candidates.length - 1];
    if (!turn) return false;
    // The per-response menu lives in <ms-chat-turn-options> ("Open options",
    // more_vert icon) on the latest turn. Prefer it over hunting for a
    // sibling of the Rerun button, which moves with layout changes.
    const optionsButton = turn.querySelector('ms-chat-turn-options button, ms-chat-turn-options [role="button"]');
    const rerun = Array.from(turn.querySelectorAll('button, [role="button"]'))
      .find((el) => /rerun|重新运行/i.test(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`));
    const menuButton = rerun
      ? (() => {
        const parent = rerun.parentElement;
        if (!parent) return null;
        const siblings = Array.from(parent.querySelectorAll('button, [role="button"]'));
        return siblings.find((el) => el !== rerun) || null;
      })()
      : null;
    const fallback = Array.from(turn.querySelectorAll('button[aria-label*="more" i], button[aria-label*="menu" i], button[aria-label*="选项" i], [data-test*="menu" i], [data-testid*="menu" i]'))[0] || null;
    const target = optionsButton || menuButton || fallback;
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);
  if (!opened) return '';

  // Give the menu a moment to render, then look for the "Copy as Markdown"
  // item. Keep the selector broad (visible label, aria, data-test) so layout
  // changes do not break extraction.
  await new Promise((resolve) => setTimeout(resolve, 350));
  const clicked = await evaluatePage(page, 'AI Studio copy as markdown', () => {
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], li, .mat-mdc-menu-item, [role="option"]'));
    const copyItem = items.find((el) => {
      const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-test') || ''} ${el.getAttribute('data-testid') || ''} ${el.textContent || ''}`;
      return /copy as markdown|复制为\s*markdown|复制为md/i.test(label);
    });
    if (!copyItem) return false;
    copyItem.click();
    return true;
  }).catch(() => false);
  if (!clicked) return '';

  // The click is a user gesture, so navigator.clipboard.readText() should be
  // permitted. Wait briefly for the clipboard write to land, then read.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const text = await evaluatePage(page, 'AI Studio read markdown clipboard', async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }).catch(() => '');
  const markdown = String(text || '').trim();
  if (!markdown) return '';

  // Clipboard reads can succeed even when the menu click did not write (for
  // example, permission denial or a stale menu node), which would otherwise
  // replace the model answer with whatever the user copied previously. Accept
  // the clipboard only when its content is recognizably the same response.
  return matchesAIStudioMarkdownClipboard(markdown, expectedText) ? markdown : '';
}

export async function waitForAIStudioResponse(page, baseline, timeoutSeconds, options = {}) {
  const timeout = requirePositiveInteger(timeoutSeconds, '--timeout');
  const deadline = options.deadline || createAIStudioDeadline(timeout);
  const baselineSnapshot = baseline?.baseline || baseline;
  // A background run must never raise the browser window; the empty-shell
  // render nudge below is gated on this mode.
  const windowMode = page?.windowMode;
  const STALL_TIMEOUT_MS = 45000;
  const TEXT_CONFIRM_MS = 1500;
  let stableKey = '';
  let stableCount = 0;
  let emptyShellSince = 0;
  let lastRenderNudge = 0;
  let lastActivityAt = Date.now();
  let lastActivityFingerprint = '';
  let confirmedText = '';
  let textConfirmSince = 0;
  return waitForAIStudioState(
    page,
    'AI Studio generation',
    async () => {
      const snapshot = await readAIStudioSnapshot(page);
      const candidate = findNewModelTurn(snapshot, baselineSnapshot);
      const now = Date.now();
      const generatedImages = (candidate?.images || [])
        .filter((image) => /^blob:|^data:/.test(String(image?.src || '')));
      const pendingImageDecode = !!candidate?.pendingDecode
        || generatedImages.some((image) => !image.width || !image.height);
      // A complete-but-empty turn shell is not a stall: it is either a slow
      // image render (the empty-shell branch below owns its timeout) or text
      // that is about to materialize. A still-decoding image is likewise an
      // active render. Both states must never trip the stall detector, or the
      // dedicated empty-shell timeout would be unreachable.
      const emptyShell = !snapshot.isGenerating && !!candidate?.complete
        && !candidate.loading && !candidate.text && (candidate.images?.length || 0) === 0;
      const stallExempt = emptyShell || pendingImageDecode;
      // Stall detection: if the page state (loading, completion, text length,
      // streamed thinking, image count, generating flag, or alerts) has not
      // changed for a long stretch while nothing is exempt, the generation is
      // stuck (e.g. a submission that never registered). Failing early beats
      // idling against the full deadline. Streamed thinking text counts as
      // activity so long reasoning phases never trip the detector.
      const activityFingerprint = JSON.stringify([
        candidate?.loading ?? null,
        candidate?.complete ?? null,
        candidate?.text?.length ?? 0,
        candidate?.thinkingText?.length ?? 0,
        candidate?.images?.length ?? 0,
        candidate?.pendingDecode ?? false,
        snapshot?.isGenerating ?? null,
        snapshot?.alerts?.length ?? 0,
      ]);
      if (stallExempt || activityFingerprint !== lastActivityFingerprint) {
        lastActivityFingerprint = activityFingerprint;
        lastActivityAt = now;
      } else if (now - lastActivityAt > STALL_TIMEOUT_MS) {
        throw new CommandExecutionError(
          'AI Studio generation stalled',
          `The page state has not changed for ${STALL_TIMEOUT_MS / 1000}s while the Run button is idle and no image is pending. The model turn is not progressing; this usually means the submission never registered or the request stalled server-side. Inspect the retained tab to confirm.`,
        );
      }
      if (snapshot.alerts.length) {
        const detail = String(candidate?.error || snapshot.alerts[0] || snapshot.alerts.join(' | ')).slice(0, 400);
        throw new CommandExecutionError(
          `AI Studio generation failed: ${detail}`,
          'AI Studio rejected the visible submission contract. Inspect the retained trace to confirm that one supported keyboard shortcut produced one new user turn; do not retry with a second submission action.',
        );
      }
      if (!candidate) return null;
      if (candidate.loading) {
        stableKey = '';
        stableCount = 0;
        return null;
      }

      // AI Studio renders the completed model turn's shell (feedback footer)
      // before its content while the tab is not actively rendered (hidden or
      // occluded). When that shell stays empty, actively raise the AI Studio
      // window so Chrome un-throttles the tab and the content materializes;
      // without this the response wait can idle for the whole --timeout. This is
      // a window-restore action, never a second submit. Background mode must
      // never raise the browser window, so the nudge is skipped there and the
      // shared deadline handles the wait.
      if (emptyShell) {
        if (emptyShellSince === 0) emptyShellSince = Date.now();
        const emptyMs = Date.now() - emptyShellSince;
        const canNudge = windowMode !== 'background'
          && (typeof page.cdp === 'function' || typeof page.selectTab === 'function');
        if (canNudge && emptyMs >= 3000 && Date.now() - lastRenderNudge >= 5000) {
          lastRenderNudge = Date.now();
          // Replicate the sequence that reliably un-throttles a hidden tab:
          // make the tab the active one, then raise the window above occluders.
          if (typeof page.selectTab === 'function' && typeof page.getActivePage === 'function') {
            const targetId = page.getActivePage();
            if (targetId) await page.selectTab(targetId).catch(() => {});
          }
          await evaluatePage(page, 'AI Studio window focus', () => { window.focus(); return true; }).catch(() => {});
          const pageTitle = await evaluatePage(page, 'AI Studio page title', () => document.title).catch(() => '');
          const restoreMode = await bringAIStudioWindowToFront(page).catch(() => 'cdp-failed');
          if (restoreMode !== 'cdp-restored') await restoreAIStudioWindow(pageTitle);
        }
        // A complete-but-empty model turn that survives the window-restore nudge
        // is a blocked/refused generation OR a slow image model still rendering
        // (e.g. Nano Banana Pro draws the footer before its image materializes).
        // 8s was too eager and killed real Pro renders; 60s still fails refusals
        // ~4x faster than the default 240s deadline without dropping slow renders.
        if (emptyMs >= 60000) {
          throw new CommandExecutionError(
            'AI Studio completed a model turn with no text and no image',
            'This usually means the request was blocked (e.g. "Prohibited content") or the image model failed to render. Inspect the retained tab for the refusal, and the trace for the turn DOM.',
          );
        }
      } else {
        emptyShellSince = 0;
      }

      const key = JSON.stringify({ text: candidate.text, images: candidate.images.map((image) => image.src) });
      if (key === stableKey) stableCount += 1;
      else {
        stableKey = key;
        stableCount = 1;
      }
      // A generated image counts as done only once it has decoded to real
      // pixels; a 0x0 blob is still rendering or failed to decode. While one is
      // pending, none of the completion signals below may fire — otherwise a
      // broken blob would be returned as a finished generation (complete flag or
      // a re-enabled Run button must not bypass the decode).
      const completionSignal = stableCount >= 2 && !pendingImageDecode && (
        candidate.complete
        || (!candidate.loading && generatedImages.some((image) => image.width > 0 && image.height > 0))
        || (!snapshot.isGenerating && snapshot.runButtonFound && !snapshot.runButtonDisabled && candidate.images.length > 0)
      );
      // A text response is only done once its content has materialized in the
      // DOM and stayed unchanged long enough: AI Studio's virtual-scrolled
      // conversation can show the completion footer before the response text
      // is rendered, and streaming output can pause briefly mid-response. The
      // old stableCount>=2 fired on a single 0.4s pause and returned a
      // truncated answer (observed: a full reply reduced to a lone first
      // character). Require the text to remain byte-identical for
      // TEXT_CONFIRM_MS after the completion signal before accepting it.
      if (!completionSignal) {
        confirmedText = '';
        textConfirmSince = 0;
        return null;
      }
      if (candidate.images.length) {
        // Image generations are binary: a decoded blob is finished; no text
        // confirmation window applies.
        return { ...candidate, url: snapshot.url };
      }
      if (candidate.text) {
        if (candidate.text === confirmedText) {
          if (textConfirmSince === 0) textConfirmSince = Date.now();
          if (Date.now() - textConfirmSince >= TEXT_CONFIRM_MS) {
            const result = { ...candidate, url: snapshot.url };
            if (options.copyAsMarkdown) {
              // Prefer the original Markdown source (headings, lists, tables,
              // formula delimiters) via the response menu's "Copy as Markdown"
              // action. The rendered DOM snapshot loses Markdown syntax, which
              // is fatal for generating textbook Markdown. Fall back to the
              // snapshot text when the menu or clipboard is unavailable.
              const markdown = await copyAIStudioResponseAsMarkdown(page, candidate.text).catch(() => '');
              if (markdown) return { ...result, text: markdown, markdown: true };
            }
            return result;
          }
        } else {
          confirmedText = candidate.text;
          textConfirmSince = Date.now();
        }
      } else {
        confirmedText = '';
        textConfirmSince = 0;
      }
      return null;
    },
    (result) => !!result,
    {
      deadline,
      pollSeconds: 0.2,
      timeoutMessage: 'AI Studio did not expose a stable completed model turn before the shared deadline. Inspect the retained tab for a quota, safety, or model-side state.',
    },
  );
}

export async function exportAIStudioImages(page, urls, options = {}) {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  if (!uniqueUrls.length) return [];
  const deadlineAt = options.deadline?.expiresAt ?? null;
  if (options.deadline) assertAIStudioDeadline(options.deadline, 'image export');
  const result = await evaluatePage(page, 'AI Studio image export', async (targetUrls, absoluteDeadline) => {
    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image blob'));
      reader.readAsDataURL(blob);
    });
    const queryAllInRoot = (root, selector) => {
      if (!root || typeof root.querySelectorAll !== 'function') return [];
      try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
    };
    const deepQueryAll = (root, selector) => {
      const matches = [];
      const seenNodes = new Set();
      const seenRoots = new Set();
      const visit = (currentRoot) => {
        if (!currentRoot || seenRoots.has(currentRoot)) return;
        seenRoots.add(currentRoot);
        if (currentRoot.shadowRoot) visit(currentRoot.shadowRoot);
        for (const node of queryAllInRoot(currentRoot, selector)) {
          if (!seenNodes.has(node)) {
            seenNodes.add(node);
            matches.push(node);
          }
        }
        for (const element of queryAllInRoot(currentRoot, '*')) {
          if (element?.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(root);
      return matches;
    };
    const directImages = deepQueryAll(document, 'ms-chat-turn img');
    const nestedImages = deepQueryAll(document, 'ms-chat-turn').flatMap((turn) => deepQueryAll(turn, 'img'));
    const images = Array.from(new Set([...directImages, ...nestedImages]));
    const results = [];
    for (const targetUrl of targetUrls) {
      const image = images.find((node) => (node.currentSrc || node.src || '') === targetUrl);
      let dataUrl = '';
      let mimeType = 'image/png';
      try {
        if (String(targetUrl).startsWith('data:')) {
          dataUrl = String(targetUrl);
          mimeType = dataUrl.match(/^data:([^;]+);/i)?.[1] || mimeType;
        } else {
          // A hung blob fetch must not stall the whole export; abort and fall
          // back to the canvas read below. Use the command's absolute deadline
          // so every image shares the remaining budget instead of receiving a
          // fresh 15-second allowance.
          const controller = new AbortController();
          const remainingMs = absoluteDeadline == null
            ? 15_000
            : Math.max(1, Math.min(15_000, absoluteDeadline - Date.now()));
          const timer = setTimeout(() => controller.abort(), remainingMs);
          try {
            const response = await fetch(String(targetUrl), { credentials: 'include', signal: controller.signal });
            if (response.ok) {
              const blob = await response.blob();
              mimeType = blob.type || mimeType;
              dataUrl = await blobToDataUrl(blob);
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {}
      if (!dataUrl && image instanceof HTMLImageElement) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(image, 0, 0);
            dataUrl = canvas.toDataURL('image/png');
            mimeType = 'image/png';
          }
        } catch {}
      }
      if (dataUrl && (!image?.naturalWidth || !image?.naturalHeight)) {
        try {
          const probe = new Image();
          const dimensions = await new Promise((resolve) => {
            probe.onload = () => resolve({ width: probe.naturalWidth || probe.width || 0, height: probe.naturalHeight || probe.height || 0 });
            probe.onerror = () => resolve({ width: 0, height: 0 });
            probe.src = dataUrl;
          });
          if (dimensions.width && dimensions.height) {
            results.push({
              url: String(targetUrl),
              dataUrl,
              mimeType,
              width: dimensions.width,
              height: dimensions.height,
            });
            continue;
          }
        } catch {}
      }
      if (dataUrl) {
        results.push({
          url: String(targetUrl),
          dataUrl,
          mimeType,
          width: image?.naturalWidth || image?.width || 0,
          height: image?.naturalHeight || image?.height || 0,
        });
      }
    }
    return results;
  }, uniqueUrls, deadlineAt);
  if (options.deadline) assertAIStudioDeadline(options.deadline, 'image export');
  return result;
}
