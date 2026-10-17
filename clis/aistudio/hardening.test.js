import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { fileURLToPath } from 'node:url';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
  applyAIStudioSettings,
  exportAIStudioImages,
  readAIStudioSnapshot,
  setAIStudioNumber,
  setAIStudioOutputMode,
  setAIStudioSelect,
  setAIStudioSystemInstruction,
  setAIStudioToggle,
  uploadAIStudioImages,
  waitForAIStudioResponse,
  waitForAIStudioState,
} from './utils.js';
import { requireCompleteAIStudioImageExport } from './image.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.resolve(testDirectory, '__fixtures__');
const runSettingsFixture = path.join(fixtureDirectory, 'run-settings-zh-cn.html');
const errorStatesFixture = path.join(fixtureDirectory, 'error-states-zh-cn.html');

/* ---------- mock DOM primitives ---------- */

function fakeEl(init = {}) {
  const node = {
    ariaLabel: init.ariaLabel ?? null,
    matLabel: init.matLabel ?? null,
    text: init.text ?? '',
    value: init.value ?? null,
    type: init.type ?? '',
    min: init.min ?? '',
    max: init.max ?? '',
    role: init.role ?? '',
    disabled: init.disabled ?? false,
    ariaChecked: init.ariaChecked ?? null,
    id: '',
    className: init.className ?? '',
    innerText: init.text ?? '',
    textContent: init.text ?? '',
    onSelect: init.onSelect ?? null,
    getAttribute(name) {
      switch (name) {
        case 'aria-label': return this.ariaLabel;
        case 'aria-disabled': return this.disabled ? 'true' : null;
        case 'aria-checked': return this.ariaChecked;
        case 'role': return this.role;
        default: return null;
      }
    },
    setAttribute() {},
    closest(sel) {
      if (sel === 'mat-form-field' && this.matLabel) {
        return { querySelector: (s) => (s === 'mat-label' ? { textContent: this.matLabel } : null) };
      }
      return null;
    },
    click() {
      if (this.ariaChecked !== null) this.ariaChecked = 'true';
      if (this.onSelect) this.onSelect(this);
    },
    querySelector(sel) {
      if (sel.includes('mat-mdc-select-min-line') || sel.includes('mat-select-value-text')) {
        return { innerText: this.value, textContent: this.value };
      }
      return null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    matches() { return false; },
    classList: { contains: () => false },
    isConnected: true,
    focus() {},
    dispatchEvent() {},
  };
  return node;
}

function fakeOption(text, select) {
  return fakeEl({ text, onSelect: () => { select.value = text; } });
}

function makeRunSettingsDom() {
  const aspectSelect = fakeEl({ ariaLabel: '宽高比', matLabel: '宽高比', value: '1:1' });
  const resolutionSelect = fakeEl({ ariaLabel: '分辨率', matLabel: '分辨率', value: '1K' });
  const thinkingSelect = fakeEl({ ariaLabel: '思考级别', matLabel: '思考级别', value: '无' });
  const tempInput = fakeEl({ ariaLabel: '温度', role: 'spinbutton', type: 'number', min: '0', max: '2', value: '1' });
  const topPInput = fakeEl({ ariaLabel: 'Top P', role: 'spinbutton', type: 'number', min: '0', max: '1', value: '0.95' });
  const maxTokensInput = fakeEl({ ariaLabel: '最大输出 token 数', role: 'spinbutton', type: 'number', min: '1', max: '8192', value: '8192' });
  const options = [
    ...['1:1', '16:9', '9:16'].map((text) => fakeOption(text, aspectSelect)),
    ...['1K', '2K', '4K'].map((text) => fakeOption(text, resolutionSelect)),
    ...['无', '低', '高'].map((text) => fakeOption(text, thinkingSelect)),
  ];
  const radioImages = fakeEl({ text: '仅图片', ariaChecked: 'true' });
  const radioImagesText = fakeEl({ text: '图片和文本', ariaChecked: 'false' });
  radioImagesText.onSelect = () => { radioImages.ariaChecked = 'false'; };
  const systemButton = fakeEl({ ariaLabel: '系统指令', text: '系统指令' });
  const systemTextarea = fakeEl({ text: '' });
  const modelSelector = { innerText: '', textContent: '' };
  const root = { querySelector: (sel) => (sel === 'ms-model-selector' ? modelSelector : null) };
  const document = {
    querySelector(sel) {
      if (sel === 'ms-run-settings') return root;
      if (sel === 'ms-run-settings ms-model-selector') return modelSelector;
      if (sel === 'mat-dialog-container textarea[aria-label="System instructions"]') return systemTextarea;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'ms-run-settings mat-select') return [aspectSelect, resolutionSelect, thinkingSelect];
      if (sel === 'ms-run-settings input') return [tempInput, topPInput, maxTokensInput];
      if (sel === 'mat-option, [role="option"]') return options;
      if (sel === 'ms-run-settings [role="radio"]') return [radioImages, radioImagesText];
      if (sel === 'ms-run-settings button') return [systemButton];
      if (sel === 'mat-dialog-container textarea') return [systemTextarea];
      if (sel === 'mat-dialog-container') return [];
      return [];
    },
  };
  return {
    document,
    inputs: [tempInput, topPInput, maxTokensInput],
    selects: [aspectSelect, resolutionSelect, thinkingSelect],
    radios: [radioImages, radioImagesText],
    systemTextarea,
  };
}

function makeMockPage(dom, options = {}) {
  return {
    async wait() {},
    async fillText(selector, value) {
      if (options.fillTextFails) return { verified: false };
      const match = String(selector).match(/aria-label="([^"]+)"/);
      if (match) {
        const input = dom.inputs.find((node) => node.ariaLabel === match[1]);
        if (input) {
          input.value = String(value);
          return { verified: true };
        }
      }
      if (String(selector).startsWith('textarea#')) {
        dom.systemTextarea.value = String(value);
        return { verified: true };
      }
      return { verified: false };
    },
    async evaluate(fn, ...args) {
      return fn(...args);
    },
  };
}

async function withGlobalDom(document, fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = {
    location: { href: 'https://aistudio.google.com/prompts/new_chat' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  try {
    return await fn();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

/* ---------- fixture contracts ---------- */

it('run-settings Chinese fixture matches the parameter control selectors', () => {
  const fixture = fs.readFileSync(runSettingsFixture, 'utf8');
  for (const snippet of [
    '<ms-run-settings>',
    '<ms-model-selector>',
    'aria-label="宽高比"',
    '<mat-label>分辨率</mat-label>',
    'aria-label="思考级别"',
    'aria-label="温度"',
    'aria-label="Top P"',
    'aria-label="最大输出 token 数"',
    'role="spinbutton"',
    '<mat-option>1:1</mat-option>',
    'role="radio"',
    'aria-label="系统指令"',
  ]) {
    expect(fixture.includes(snippet)).toBeTruthy();
  }
});

it('error-states Chinese fixture carries five distinguishable error texts', () => {
  const fixture = fs.readFileSync(errorStatesFixture, 'utf8');
  for (const marker of ['role="alert"', '配额', '安全', '登录', '不可用', '超时']) {
    expect(fixture.includes(marker)).toBeTruthy();
  }
});

/* ---------- run settings controls (Item 2) ---------- */

it('aspect ratio select matches the Chinese label and settles on the final value', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const result = await withGlobalDom(dom.document, () => setAIStudioSelect(page, 'Aspect ratio', '16:9'));
  expect(result).toBe('16:9');
  expect(dom.selects[0].value).toBe('16:9');
});

it('thinking level select matches the Chinese label and settles on the final value', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const result = await withGlobalDom(dom.document, () => setAIStudioSelect(page, 'Thinking Level', '高'));
  expect(result).toBe('高');
  expect(dom.selects[2].value).toBe('高');
});

it('select rejects a value that is not among the visible options', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const error = await withGlobalDom(dom.document, () => setAIStudioSelect(page, 'Resolution', '8K'))
    .then(() => null, (e) => e);
  expect(error).toBeInstanceOf(ArgumentError);
  expect(error.message).toMatch(/8K/);
});

it('temperature number control writes and verifies the final value', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const result = await withGlobalDom(dom.document, () => setAIStudioNumber(page, 'Temperature', 0.7));
  expect(result).toBe(0.7);
  expect(dom.inputs[0].value).toBe('0.7');
});

it('number control uses the DOM fallback write when fillText fails', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom, { fillTextFails: true });
  const result = await withGlobalDom(dom.document, () => setAIStudioNumber(page, 'Temperature', 1.5));
  expect(result).toBe(1.5);
  expect(dom.inputs[0].value).toBe('1.5');
});

it('disabled number control is rejected', async () => {
  const dom = makeRunSettingsDom();
  dom.inputs[1].disabled = true;
  const page = makeMockPage(dom);
  const error = await withGlobalDom(dom.document, () => setAIStudioNumber(page, 'Top P', 0.5))
    .then(() => null, (e) => e);
  expect(error).toBeInstanceOf(ArgumentError);
  expect(error.message).toMatch(/disabled/i);
});

it('number control enforces the DOM min/max range', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const error = await withGlobalDom(dom.document, () => setAIStudioNumber(page, 'Temperature', 5))
    .then(() => null, (e) => e);
  expect(error).toBeInstanceOf(ArgumentError);
  expect(error.message).toMatch(/must be <= 2/);
});

it('image export fails when only part of the generated asset set is available', () => {
  expect(() => requireCompleteAIStudioImageExport(
    [{ src: 'blob:first' }, { src: 'blob:second' }],
    [{ url: 'blob:first', dataUrl: 'data:image/png;base64,AA==' }],
    'https://aistudio.google.com/prompts/example',
  )).toThrow(/2 image asset\(s\).*only 1 could be exported/);
});

it('Top P never aliases a separately exposed Top K control', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-run-settings><ms-model-selector></ms-model-selector>
      <mat-form-field><mat-label>Top K</mat-label>
        <input type="number" role="spinbutton" aria-label="Top K" min="0" max="1" value="0.9">
      </mat-form-field>
    </ms-run-settings>
  </body>`);
  const page = {
    async wait() {},
    async fillText() { return { verified: false }; },
    async evaluate(fn, ...args) { return fn(...args); },
  };
  await expect(withGlobalDom(dom.window.document, () => setAIStudioNumber(page, 'Top P', 0.4)))
    .rejects.toThrow(/not available/);
  dom.window.close();
});

it('system instruction dialog fills and verifies the Chinese textarea', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const result = await withGlobalDom(dom.document, () => setAIStudioSystemInstruction(page, '你是图像专家'));
  expect(result).toBe('你是图像专家');
  expect(dom.systemTextarea.value).toBe('你是图像专家');
});

it('output mode matches the Chinese radio and settles on the final selection', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const result = await withGlobalDom(dom.document, () => setAIStudioOutputMode(page, 'images-text'));
  expect(result).toBe('images-text');
  expect(dom.radios[0].ariaChecked).toBe('false');
  expect(dom.radios[1].ariaChecked).toBe('true');
});

it('applyAIStudioSettings drives the parameter controls and returns the current model', async () => {
  const dom = makeRunSettingsDom();
  const page = makeMockPage(dom);
  const settings = await withGlobalDom(dom.document, () => applyAIStudioSettings(page, {
    aspectRatio: '16:9',
    temperature: 0.7,
  }));
  expect(dom.selects[0].value).toBe('16:9');
  expect(dom.inputs[0].value).toBe('0.7');
  expect(settings.model).toBe('');
  expect(settings.selectedModel).toBe(null);
});

/* ---------- distinguishable error states (Item 3) ---------- */

const ERROR_CASES = [
  { key: 'quota', text: '已超出配额限制，请稍后重试' },
  { key: 'safety', text: '生成内容被安全策略阻止，无法输出' },
  { key: 'auth', text: '未授权访问该模型，请先登录 Google 账号' },
  { key: 'model-unavailable', text: '所选模型当前不可用，请选择其他模型' },
  { key: 'generation-timeout', text: '生成请求超时，请重试' },
];

it('snapshot surfaces quota, safety, auth, unavailable and timeout alerts distinctly', async () => {
  for (const { key, text } of ERROR_CASES) {
    const alert = fakeEl({ text });
    const document = {
      querySelectorAll: (sel) => (
        sel.includes('[role="alert"]')
          ? [alert]
          : sel === 'ms-chat-turn' ? [] : sel === 'button' ? [] : []
      ),
      querySelector: () => null,
    };
    const snapshot = await withGlobalDom(document, () => readAIStudioSnapshot({
      evaluate: async (fn, ...args) => fn(...args),
    }));
    expect(snapshot.alerts.includes(text)).toBe(true, `${key} alert not surfaced`);
  }
});

it('generation error surfaces as CommandExecutionError with the original text, not a timeout', async () => {
  for (const { key, text } of ERROR_CASES) {
    const page = {
      async wait() {},
      async evaluate() {
        return {
          turns: [],
          alerts: [text],
          url: 'https://aistudio.google.com/prompts/new_chat',
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
        };
      },
    };
    const error = await waitForAIStudioResponse(page, { turns: [] }, 5)
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(CommandExecutionError);
    expect(error).not.toBeInstanceOf(TimeoutError);
    expect(error.message).toContain(text);
  }
});

/* ---------- mock page behaviors (Item 4) ---------- */

it('state waiter raises TimeoutError when readiness never arrives', async () => {
  const page = { async wait() {} };
  const error = await waitForAIStudioState(
    page,
    'fixture never ready',
    async () => ({ ready: false }),
    (state) => state?.ready === true,
    { timeoutSeconds: 1, pollSeconds: 0.05 },
  ).then(() => null, (e) => e);
  expect(error).toBeInstanceOf(TimeoutError);
  expect(error.message).toMatch(/fixture never ready/);
});

it('export reads image pixels directly from data URLs', async () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const img = { currentSrc: dataUrl, src: dataUrl, naturalWidth: 1024, naturalHeight: 1024 };
  const document = { querySelectorAll: (sel) => (sel === 'ms-chat-turn img' ? [img] : []) };
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const result = await withGlobalDom(document, () => exportAIStudioImages(page, [dataUrl]));
  expect(result.length).toBe(1);
  expect(result[0].mimeType).toBe('image/png');
  expect(result[0].width).toBe(1024);
  expect(result[0].height).toBe(1024);
});

it('export fetches remote images as blobs', async () => {
  const url = 'https://aistudio.google.com/img/1.png';
  const img = { currentSrc: url, src: url, naturalWidth: 1024, naturalHeight: 1024 };
  const document = { querySelectorAll: (sel) => (sel === 'ms-chat-turn img' ? [img] : []) };
  const previousFetch = globalThis.fetch;
  const previousFileReader = globalThis.FileReader;
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) });
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,aGVsbG8=';
      this.onloadend?.();
    }
  };
  try {
    const page = { evaluate: async (fn, ...args) => fn(...args) };
    const result = await withGlobalDom(document, () => exportAIStudioImages(page, [url]));
    expect(result.length).toBe(1);
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].url).toBe(url);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.FileReader = previousFileReader;
  }
});

it('export falls back to a canvas read when fetching fails', async () => {
  const url = 'https://aistudio.google.com/img/2.png';
  globalThis.HTMLImageElement = class HTMLImageElement {};
  const img = Object.assign(new globalThis.HTMLImageElement(), {
    currentSrc: url,
    src: url,
    naturalWidth: 0,
    naturalHeight: 0,
    width: 512,
    height: 512,
  });
  const canvas = {
    width: 0,
    height: 0,
    toDataURL: () => 'data:image/png;base64,Y2FudmFz',
    getContext: () => ({ drawImage: () => {} }),
  };
  const document = {
    querySelectorAll: (sel) => (sel === 'ms-chat-turn img' ? [img] : []),
    createElement: (tag) => (tag === 'canvas' ? canvas : {}),
  };
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  const previousHTMLImageElement = globalThis.HTMLImageElement;
  globalThis.fetch = async () => ({ ok: false });
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = 1024;
      this.naturalHeight = 1024;
    }
    set src(value) {
      this._src = value;
      this.onload?.();
    }
    get src() {
      return this._src;
    }
  };
  try {
    const page = { evaluate: async (fn, ...args) => fn(...args) };
    const result = await withGlobalDom(document, () => exportAIStudioImages(page, [url]));
    expect(result.length).toBe(1);
    expect(result[0].mimeType).toBe('image/png');
    expect(result[0].width).toBe(1024);
    expect(result[0].height).toBe(1024);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
    globalThis.HTMLImageElement = previousHTMLImageElement;
  }
});

it('upload falls back to DataTransfer injection when setFileInput throws a bridge error', async () => {
  const tinyPng = path.join(os.tmpdir(), `opencli-aistudio-upload-${process.pid}.png`);
  fs.writeFileSync(tinyPng, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));

  globalThis.HTMLInputElement = class HTMLInputElement {};
  globalThis.DataTransfer = class DataTransfer {
    constructor() {
      this._files = [];
      this.items = { add: (file) => this._files.push(file) };
    }
    get files() {
      return this._files;
    }
  };
  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  const input = Object.assign(new globalThis.HTMLInputElement(), {
    files: [],
    dispatchEvent() {},
  });
  const mediaButton = {
    disabled: false,
    ariaExpanded: 'false',
    getAttribute(name) {
      if (name === 'aria-expanded') return this.ariaExpanded;
      if (name === 'aria-disabled') return null;
      return null;
    },
    click() {
      this.ariaExpanded = 'true';
    },
    dispatchEvent() {
      this.ariaExpanded = 'false';
    },
  };
  let injected = false;
  const matches = (selector, patterns) => patterns.some((p) => String(selector).includes(p));
  const document = {
    querySelector(selector) {
      if (matches(selector, ['selectMediaMenu', 'Insert images', '插入'])) return mediaButton;
      if (matches(selector, ['data-test-upload-file-input', 'input[type="file"]'])) return input;
      return null;
    },
    querySelectorAll(selector) {
      if (matches(selector, ['Remove media', '移除'])) return injected ? [{}] : [];
      if (selector === '[aria-expanded="true"]') return mediaButton.ariaExpanded === 'true' ? [mediaButton] : [];
      return [];
    },
    dispatchEvent() {},
  };
  const page = {
    async wait() {},
    async setFileInput() {
      throw new Error('sendCommand: max attempts exhausted');
    },
    async evaluate(fn, ...args) {
      const result = fn(...args);
      if (result?.ok) injected = true;
      return result;
    },
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousHTMLInputElement = globalThis.HTMLInputElement;
  const previousDataTransfer = globalThis.DataTransfer;
  const previousKeyboardEvent = globalThis.KeyboardEvent;
  globalThis.document = document;
  globalThis.window = {
    location: { href: 'https://aistudio.google.com/prompts/new_chat' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  try {
    const result = await uploadAIStudioImages(page, [tinyPng]);
    expect(result).toEqual([tinyPng]);
    expect(injected).toBe(true, 'DataTransfer fallback should attach the file when setFileInput throws a bridge error');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.HTMLInputElement = previousHTMLInputElement;
    globalThis.DataTransfer = previousDataTransfer;
    globalThis.KeyboardEvent = previousKeyboardEvent;
    fs.unlinkSync(tinyPng);
  }
});

it('upload assembles large files via chunked base64 injection', async () => {
  const largePng = path.join(os.tmpdir(), `opencli-aistudio-large-${process.pid}.png`);
  fs.writeFileSync(largePng, Buffer.alloc(200 * 1024, 0x89));

  globalThis.HTMLInputElement = class HTMLInputElement {};
  globalThis.DataTransfer = class DataTransfer {
    constructor() {
      this._files = [];
      this.items = { add: (file) => this._files.push(file) };
    }
    get files() {
      return this._files;
    }
  };
  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  const input = Object.assign(new globalThis.HTMLInputElement(), {
    files: [],
    dispatchEvent() {},
  });
  const mediaButton = {
    disabled: false,
    ariaExpanded: 'false',
    getAttribute(name) {
      if (name === 'aria-expanded') return this.ariaExpanded;
      if (name === 'aria-disabled') return null;
      return null;
    },
    click() {
      this.ariaExpanded = 'true';
    },
    dispatchEvent() {
      this.ariaExpanded = 'false';
    },
  };
  let injected = false;
  const matches = (selector, patterns) => patterns.some((p) => String(selector).includes(p));
  const document = {
    querySelector(selector) {
      if (matches(selector, ['selectMediaMenu', 'Insert images', '插入'])) return mediaButton;
      if (matches(selector, ['data-test-upload-file-input', 'input[type="file"]'])) return input;
      return null;
    },
    querySelectorAll(selector) {
      if (matches(selector, ['Remove media', '移除'])) return injected ? [{}] : [];
      if (selector === '[aria-expanded="true"]') return mediaButton.ariaExpanded === 'true' ? [mediaButton] : [];
      return [];
    },
    dispatchEvent() {},
  };
  const page = {
    async wait() {},
    async setFileInput() {
      throw new Error('sendCommand: max attempts exhausted');
    },
    async evaluate(fn, ...args) {
      const result = fn(...args);
      if (result?.ok) injected = true;
      return result;
    },
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousHTMLInputElement = globalThis.HTMLInputElement;
  const previousDataTransfer = globalThis.DataTransfer;
  const previousKeyboardEvent = globalThis.KeyboardEvent;
  globalThis.document = document;
  globalThis.window = {
    location: { href: 'https://aistudio.google.com/prompts/new_chat' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  try {
    const result = await uploadAIStudioImages(page, [largePng]);
    expect(result).toEqual([largePng]);
    expect(injected).toBe(true, 'chunked base64 injection should complete');
    expect(input.files.length).toBe(1, 'assembled file should be attached to the input');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.HTMLInputElement = previousHTMLInputElement;
    globalThis.DataTransfer = previousDataTransfer;
    globalThis.KeyboardEvent = previousKeyboardEvent;
    fs.unlinkSync(largePng);
  }
});

/* ---------- run-settings toggle ---------- */

function fakeSwitch({ ariaLabel, checked, syntheticWorks }) {
  return {
    ariaLabel,
    ariaChecked: checked,
    syntheticWorks,
    getAttribute(name) {
      if (name === 'aria-label') return this.ariaLabel;
      if (name === 'aria-checked') return this.ariaChecked;
      if (name === 'role') return 'switch';
      if (name === 'aria-disabled') return null;
      return null;
    },
    click() {
      // Current AI Studio builds handle synthetic clicks; older builds ignored
      // them (simulated by syntheticWorks === false).
      if (this.syntheticWorks) {
        this.ariaChecked = this.ariaChecked === 'true' ? 'false' : 'true';
      }
    },
    focus() {},
    closest() { return null; },
    dispatchEvent() {},
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    ownerDocument: {
      defaultView: {
        KeyboardEvent: class KeyboardEvent {
          constructor(type, init = {}) {
            Object.assign(this, init);
          }
        },
      },
    },
  };
}

async function withToggleDom(switchEl, page) {
  const root = { querySelector: (sel) => (sel === 'ms-model-selector' ? {} : null) };
  const document = {
    querySelector(sel) {
      if (sel === 'ms-run-settings') return root;
      if (sel === 'ms-run-settings ms-model-selector') return {};
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'ms-run-settings [role="switch"]') return [switchEl];
      if (sel === 'ms-run-settings mat-slide-toggle') return [];
      return [];
    },
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCss = globalThis.CSS;
  globalThis.document = document;
  globalThis.window = {
    location: { href: 'https://aistudio.google.com/prompts/new_chat' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  globalThis.CSS = { escape: (value) => value };
  try {
    return await setAIStudioToggle(page, 'Grounding with Google Search', false, {});
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.CSS = previousCss;
  }
}

it('toggle skips the native CDP retry when the synthesized click already flipped the switch', async () => {
  const switchEl = fakeSwitch({ ariaLabel: 'Grounding with Google Search', checked: 'true', syntheticWorks: true });
  let nativeClicks = 0;
  const page = {
    async wait() {},
    async evaluate(fn, ...args) {
      return fn(...args);
    },
    async click() {
      nativeClicks += 1;
      switchEl.ariaChecked = switchEl.ariaChecked === 'true' ? 'false' : 'true';
    },
  };

  const result = await withToggleDom(switchEl, page);

  expect(result).toBe(false);
  // An unconditional native retry would double-toggle the switch back on.
  expect(nativeClicks).toBe(0);
});

it('toggle falls back to the native CDP click when the synthesized click is ignored', async () => {
  const switchEl = fakeSwitch({ ariaLabel: 'Grounding with Google Search', checked: 'true', syntheticWorks: false });
  let nativeClicks = 0;
  const page = {
    async wait() {},
    async evaluate(fn, ...args) {
      return fn(...args);
    },
    async click() {
      nativeClicks += 1;
      switchEl.ariaChecked = switchEl.ariaChecked === 'true' ? 'false' : 'true';
    },
  };

  const result = await withToggleDom(switchEl, page);

  expect(result).toBe(false);
  expect(nativeClicks).toBe(1);
});
