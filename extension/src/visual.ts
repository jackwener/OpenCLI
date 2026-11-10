/** Browser-native visual actions for tabs that chrome.debugger cannot attach to. */

type VisualPointOperation = 'hover' | 'click';
type WebFrame = { frameId: number; parentFrameId: number; url: string };

type FocusCandidate = {
  frameId: number;
  kind: 'input' | 'textarea' | 'contenteditable';
  hasFocus: boolean;
};

let lastCaptureAt = 0;

function isWebUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('https://') || url.startsWith('http://'));
}

async function exactActiveWebTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!isWebUrl(tab.url) || tab.windowId === undefined) throw new Error('Visual action requires an http(s) tab.');
  const active = await chrome.tabs.query({ windowId: tab.windowId, active: true });
  if (active.length !== 1 || active[0].id !== tabId) {
    throw new Error('Visual target is not the active tab in its window; no other tab was captured or clicked.');
  }
  return tab;
}

async function accessibleFrames(tabId: number): Promise<WebFrame[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) throw new Error('Cannot inspect the target tab frames.');
  const webFrames = frames
    .filter((frame) => frame.frameId === 0 || isWebUrl(frame.url))
    .map((frame) => ({ frameId: frame.frameId, parentFrameId: frame.parentFrameId, url: frame.url }));
  if (!webFrames.some((frame) => frame.frameId === 0)) throw new Error('Target tab main frame is unavailable.');
  return webFrames;
}

async function accessibleFrameIds(tabId: number): Promise<number[]> {
  return (await accessibleFrames(tabId)).map((frame) => frame.frameId);
}

function readViewport(): { url: string; width: number; height: number } {
  return { url: location.href, width: window.innerWidth, height: window.innerHeight };
}

export async function captureVisibleTab(tabId: number): Promise<{
  url: string;
  cssWidth: number;
  cssHeight: number;
  data: string;
  transport: 'extension';
}> {
  const before = await exactActiveWebTab(tabId);
  const [view] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: readViewport });
  const viewport = view?.result;
  if (!viewport || viewport.url !== before.url || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('Visual target changed during capture.');
  }
  const waitMs = Math.max(0, 550 - (Date.now() - lastCaptureAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastCaptureAt = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(before.windowId, { format: 'png' });
  const after = await exactActiveWebTab(tabId);
  if (after.url !== before.url || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Visual target changed or browser returned no PNG.');
  }
  return {
    url: viewport.url,
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    data: dataUrl.slice('data:image/png;base64,'.length),
    transport: 'extension',
  };
}

/** Runs in one exact web frame. It never sends actions through page-visible messages. */
function pointInFrame(op: VisualPointOperation, x: number, y: number):
  | { kind: 'iframe'; src: string; left: number; top: number; clientLeft: number; clientTop: number; transform: string }
  | { kind: 'element'; tag: string } {
  if (!Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    throw new Error('Point is outside this frame.');
  }
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!hit) throw new Error('Nothing is visible at the point.');
  if (hit instanceof HTMLIFrameElement) {
    const rect = hit.getBoundingClientRect();
    return {
      kind: 'iframe', src: hit.src, left: rect.left, top: rect.top,
      clientLeft: hit.clientLeft, clientTop: hit.clientTop,
      transform: getComputedStyle(hit).transform,
    };
  }
  const target = hit.closest('button,a,input,label,select,textarea,[role="button"],[role="link"]') ?? hit;
  const mouse = (type: string) => target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0,
  }));
  if (op === 'hover') {
    mouse('mouseover');
    mouse('mousemove');
    return { kind: 'element', tag: target.tagName };
  }
  if (op !== 'click') throw new Error('Unknown visual point operation.');
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  mouse('mousedown');
  mouse('mouseup');
  if (target instanceof HTMLElement) target.click();
  else mouse('click');
  return { kind: 'element', tag: target.tagName };
}

export async function pointAction(tabId: number, op: VisualPointOperation, x: number, y: number): Promise<{
  dispatched: true;
  input: 'synthetic';
  tag: string;
}> {
  await exactActiveWebTab(tabId);
  const frames = await accessibleFrames(tabId);
  let frame = frames.find((candidate) => candidate.frameId === 0)!;
  for (let depth = 0; depth < 8; depth++) {
    await exactActiveWebTab(tabId);
    const [answer] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frame.frameId] }, func: pointInFrame, args: [op, x, y],
    });
    const result = answer?.result;
    if (!result) throw new Error('Visual point target frame did not answer.');
    if (result.kind === 'element') return { dispatched: true, input: 'synthetic', tag: result.tag };
    if (result.transform !== 'none') throw new Error('Transformed iframe coordinates are unsupported.');
    if (/^(chrome|edge)-extension:\/\//.test(result.src)) {
      throw new Error('Point is inside protected extension UI.');
    }
    const children = frames.filter((candidate) =>
      candidate.parentFrameId === frame.frameId && candidate.url === result.src,
    );
    if (children.length !== 1) {
      throw new Error('Cannot uniquely match the visible iframe to a web frame. No click was sent.');
    }
    x -= result.left + result.clientLeft;
    y -= result.top + result.clientTop;
    frame = children[0];
  }
  throw new Error('Visual point crossed too many nested iframes.');
}

function readFocusedControl(): { kind: FocusCandidate['kind'] | 'other'; hasFocus: boolean } {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  const hasFocus = document.hasFocus();
  if (element instanceof HTMLTextAreaElement) return { kind: 'textarea', hasFocus };
  if (element instanceof HTMLInputElement
      && !['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(element.type)) {
    return { kind: 'input', hasFocus };
  }
  if (element instanceof HTMLElement && element.isContentEditable) return { kind: 'contenteditable', hasFocus };
  return { kind: 'other', hasFocus };
}

async function focusCandidates(tabId: number): Promise<FocusCandidate[]> {
  const ids = await accessibleFrameIds(tabId);
  const candidates: FocusCandidate[] = [];
  for (const frameId of ids) {
    try {
      const [answer] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] }, func: readFocusedControl,
      });
      const state = answer?.result;
      if (state && state.kind !== 'other') {
        candidates.push({ frameId, kind: state.kind, hasFocus: state.hasFocus });
      }
    } catch (error) {
      if (frameId === 0) throw error;
    }
  }
  return candidates;
}

async function exactFocusedCandidate(tabId: number): Promise<FocusCandidate> {
  await exactActiveWebTab(tabId);
  const candidates = await focusCandidates(tabId);
  const focused = candidates.filter((candidate) => candidate.hasFocus);
  const choices = focused.length ? focused : candidates;
  if (choices.length !== 1) throw new Error(
    choices.length ? 'More than one text control appears focused.' : 'No text control is focused.',
  );
  return choices[0];
}

export async function focusedControl(tabId: number): Promise<{ kind: FocusCandidate['kind']; frameId: number }> {
  const candidate = await exactFocusedCandidate(tabId);
  return { kind: candidate.kind, frameId: candidate.frameId };
}

/** Runs only in the previously selected focused frame. */
function insertFocusedText(text: string, expectedKind: FocusCandidate['kind']): { typed: true; kind: string } {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  if ((expectedKind === 'input' && element instanceof HTMLInputElement)
      || (expectedKind === 'textarea' && element instanceof HTMLTextAreaElement)) {
    const control = element as HTMLInputElement | HTMLTextAreaElement;
    const start = control.selectionStart ?? control.value.length;
    const end = control.selectionEnd ?? start;
    const next = control.value.slice(0, start) + text + control.value.slice(end);
    const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Text control has no native value setter.');
    setter.call(control, next);
    control.setSelectionRange(start + text.length, start + text.length);
    control.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
    return { typed: true, kind: expectedKind };
  }
  if (expectedKind === 'contenteditable' && element instanceof HTMLElement && element.isContentEditable) {
    if (!document.execCommand('insertText', false, text)) throw new Error('Contenteditable insertion was rejected.');
    return { typed: true, kind: expectedKind };
  }
  throw new Error('Focused text control changed before insertion.');
}

export async function typeFocusedText(tabId: number, text: string): Promise<{
  typed: true;
  kind: FocusCandidate['kind'];
  frameId: number;
  input: 'synthetic';
}> {
  const candidate = await exactFocusedCandidate(tabId);
  await exactActiveWebTab(tabId);
  const [answer] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [candidate.frameId] },
    func: insertFocusedText,
    args: [text, candidate.kind],
  });
  if (!answer?.result?.typed) throw new Error('Browser did not confirm text insertion.');
  return { typed: true, kind: candidate.kind, frameId: candidate.frameId, input: 'synthetic' };
}
