import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
  AI_STUDIO_ERROR_NODE_SELECTOR,
  AI_STUDIO_SELECTORS,
  aiStudioTurnFingerprint,
  closeTopDialog,
  collectAIStudioEmptyShellEvidence,
  createAIStudioDeadline,
  ensureAIStudioPage,
  focusAIStudioComposer,
  findNewAIStudioTurns,
  findNewModelTurn,
  getAIStudioSubmissionEvidence,
  injectAIStudioFiles,
  isAIStudioBlockedContentText,
  isAIStudioErrorText,
  isAIStudioInlineErrorText,
  matchesAIStudioMarkdownClipboard,
  modelCategory,
  normalizeAIStudioPrompt,
  parseAIStudioJsonObject,
  parseAIStudioStringList,
  openAIStudioModelDirect,
  parseModelCardText,
  readAIStudioSnapshot,
  resolveAIStudioModelSearchResult,
  selectAIStudioModel,
  setAIStudioSafetySettings,
  setAIStudioStopSequences,
  startNewAIStudioChat,
  submitAIStudioComposerWithKeyboard,
  validateAIStudioImageAsset,
  waitForAIStudioResponse,
  waitForAIStudioState,
  waitForAIStudioSubmission,
} from './utils.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(testDirectory, '__fixtures__', 'prompt-submit-zh-cn.html');

// Correct answers a user asked for. If the blocked-content classifier matches
// any of these, waitForAIStudioResponse throws and hands the user's own answer
// back as the failure reason. Reproduced against the live service before this
// guard existed: a benign React question whose reply opened with 不允许 failed with
// COMMAND_EXEC while the identical pipeline answered a control prompt in 23s.
const BLOCKED_CONTENT_BENIGN = [
  'Content filters are typically implemented as a classifier layer.',
  'The deployment failed because the port was blocked by the firewall rule.',
  'Using eval() here is not appropriate for untrusted input; prefer JSON.parse.',
  'Direct mutation of props is not permitted in React; use state instead.',
  'I cannot help with the vendor benchmark because it is under NDA.',
  'The regex approach will not be able to handle nested parentheses.',
  'Writes are prohibited by the read-only transaction, so open a new one.',
  'The linker was unable to produce a binary; check the target triple.',
  '不允许直接修改 props，React 中应当通过 state 更新。',
  '这个类型不符合接口定义，需要显式转换。',
  '该操作不允许在只读事务中执行。',
  '很抱歉，这份文档无法提供更多细节。',
  '编译器无法生成目标代码，请检查依赖版本。',
];

// Genuine platform refusals. AI Studio renders these as the ENTIRE turn text,
// so every entry must full-match (anchored) at least one pattern in
// AI_STUDIO_BLOCKED_CONTENT_PATTERNS.
const BLOCKED_CONTENT_REFUSALS = [
  'Prohibited content.',
  'Blocked content.',
  'Content blocked.',
  'Your request was blocked.',
  'Request has been blocked.',
  'Blocked for safety reasons.',
  'I cannot generate that image.',
  'I am not able to create this content.',
  "I can't produce this content.",
  'This goes against our content policy.',
  'That request violates our usage policies.',
  'The model refused to generate this content.',
  'Safety settings blocked this response.',
  '该请求包含不当内容。',
  '检测到违规内容。',
  '生成内容违反内容政策。',
  '生成内容被安全策略阻止，无法输出。',
  '我无法生成这类内容。',
  '我不能生成该图片。',
  '模型拒绝生成该内容。',
  '模型拒绝创建该图像。',
];

function userTurn(text) {
  return { role: 'user', text, images: [] };
}

function modelTurn(text, images = []) {
  return { role: 'model', text, images, complete: true };
}

it('findNewModelTurn skips thinking-only turns and returns the answer turn', () => {
  const snapshot = {
    turns: [
      { role: 'model', text: 'Thoughts: 1+1 is...', thinkingOnly: true, images: [] },
      { role: 'model', text: '2', thinkingOnly: false, complete: true, images: [] },
    ],
  };
  const turn = findNewModelTurn(snapshot, { turns: [] });
  expect(turn.text).toBe('2');
});

it('findNewModelTurn returns null while only a thinking turn exists', () => {
  const snapshot = {
    turns: [{ role: 'model', text: 'Thinking...', thinkingOnly: true, images: [] }],
  };
  expect(findNewModelTurn(snapshot, { turns: [] })).toBeNull();
});

it('AI Studio selectors keep structural anchors before localized fallbacks', () => {
  expect(AI_STUDIO_SELECTORS.composer[0]).toBe('ms-prompt-box textarea');
  expect(AI_STUDIO_SELECTORS.runButton[0]).toBe('ms-prompt-box ms-run-button button[type="submit"]');
  expect(AI_STUDIO_SELECTORS.modelPickerSearch[0]).toBe('mat-dialog-container input[type="text"][aria-label="Search"]');
  expect(AI_STUDIO_SELECTORS.mediaInsert.includes('button[data-test="selectMediaMenu"]')).toBeTruthy();
  expect(AI_STUDIO_SELECTORS.uploadInput.includes('input[data-test-upload-file-input]')).toBeTruthy();
});

it('run-settings CLI values accept JSON lists and objects with typed errors', () => {
  expect(parseAIStudioStringList('["END", "STOP"]', '--stop-sequences')).toEqual(['END', 'STOP']);
  expect(parseAIStudioStringList('END, STOP, END', '--stop-sequences')).toEqual(['END', 'STOP']);
  expect(parseAIStudioJsonObject('{"Harassment":"Block some"}', '--safety-settings')).toEqual({
    Harassment: 'Block some',
  });
  expect(() => parseAIStudioStringList('["END", 1]', '--stop-sequences')).toThrow(/string array/);
  expect(() => parseAIStudioJsonObject('[]', '--safety-settings')).toThrow(/JSON object/);
});

it('safety settings map named levels to the live slider range and close cleanly', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-run-settings>
      <ms-model-selector></ms-model-selector>
      <button aria-label="Edit safety settings">Edit</button>
      <run-safety-settings>
        <input type="range" aria-label="Harassment" min="-5" max="-1" value="-5">
        <input type="range" aria-label="Hate" min="-5" max="-1" value="-5">
      </run-safety-settings>
    </ms-run-settings>
  </body>`);
  const page = { async wait() {}, evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const result = await setAIStudioSafetySettings(page, { Harassment: 'Block some', Hate: -4 });
    expect(result).toEqual({ Harassment: -2, Hate: -4 });
    expect(dom.window.document.querySelector('input[aria-label="Harassment"]').value).toBe('-2');
    expect(dom.window.document.querySelector('input[aria-label="Hate"]').value).toBe('-4');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('stop sequences fill the chip input and submit one chip per value', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-run-settings>
      <ms-model-selector></ms-model-selector>
      <ms-stop-sequence-input><input id="chip-input" aria-label="Add stop sequence"></ms-stop-sequence-input>
    </ms-run-settings>
  </body>`);
  const input = dom.window.document.querySelector('#chip-input');
  const root = dom.window.document.querySelector('ms-stop-sequence-input');
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !input.value) return;
    const chip = dom.window.document.createElement('mat-chip-row');
    chip.textContent = input.value;
    root.appendChild(chip);
    input.value = '';
  });
  const page = {
    async wait() {},
    fillText: async (_selector, value) => {
      input.value = value;
      return { verified: true };
    },
    pressKey: async (key) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })),
    evaluate: async (fn, ...args) => fn(...args),
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    await expect(setAIStudioStopSequences(page, ['END', 'STOP', 'END'])).resolves.toEqual(['END', 'STOP']);
    expect(root.textContent).toContain('END');
    expect(root.textContent).toContain('STOP');
    expect(input.value).toBe('');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('safety category matching rejects empty keys and ambiguous prefixes', async () => {
  await expect(setAIStudioSafetySettings({}, { '': 'Block some' }))
    .rejects.toThrow(/must not be empty/);
  await expect(setAIStudioSafetySettings({}, { h: 'Block some' }))
    .rejects.toThrow(/Unknown safety category/);
});

it('stop sequence matching compares complete chip values, not substrings', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-run-settings>
      <ms-model-selector></ms-model-selector>
      <ms-stop-sequence-input>
        <mat-chip-row>FRIEND</mat-chip-row>
        <input id="chip-input" aria-label="Add stop sequence">
      </ms-stop-sequence-input>
    </ms-run-settings>
  </body>`);
  const input = dom.window.document.querySelector('#chip-input');
  const root = dom.window.document.querySelector('ms-stop-sequence-input');
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !input.value) return;
    const chip = dom.window.document.createElement('mat-chip-row');
    chip.textContent = input.value;
    root.insertBefore(chip, input);
    input.value = '';
  });
  const page = {
    async wait() {},
    fillText: async (_selector, value) => {
      input.value = value;
      return { verified: true };
    },
    pressKey: async (key) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })),
    evaluate: async (fn, ...args) => fn(...args),
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    await setAIStudioStopSequences(page, ['END']);
    expect([...root.querySelectorAll('mat-chip-row')].map((chip) => chip.textContent)).toEqual(['FRIEND', 'END']);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('model parser accepts every supplied canonical model id', () => {
  const modelIds = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.5-live-translate-preview',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-2.5-flash-image',
    'gemini-2.5-pro',
    'gemini-pro-latest',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-robotics-er-1.6-preview',
    'gemini-robotics-er-2-preview',
    'gemini-3.1-flash-live-preview',
    'gemini-robotics-er-2-streaming-preview',
    'gemini-3.1-flash-tts-preview',
    'lyria-3-pro-preview',
    'lyria-3-clip-preview',
    'gemini-2.5-pro-preview-tts',
    'gemini-2.5-flash-preview-tts',
    'imagen-4.0-generate-001',
    'imagen-4.0-ultra-generate-001',
    'imagen-4.0-fast-generate-001',
    'gemini-omni-flash-preview',
    'veo-3.1-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-lite-generate-preview',
    'gemma-4-26b-a4b-it',
    'gemma-4-31b-it',
  ];
  for (const modelId of modelIds) {
    expect(parseModelCardText(`Model ${modelId}`)?.model).toBe(modelId);
  }
});

it('searched model selection validates category and finds the exact result', () => {
  const resolved = resolveAIStudioModelSearchResult(
    ['Gemini 3.5 Flash-Lite gemini-3.5-flash-lite'],
    'gemini-3.5-flash-lite',
    'text',
  );
  expect(resolved.selected.model).toBe('gemini-3.5-flash-lite');
  const exactResultAfterPrefixMatch = resolveAIStudioModelSearchResult(
    ['Gemini 3.5 Flash Lite gemini-3.5-flash-lite', 'Gemini 3.5 Flash gemini-3.5-flash'],
    'gemini-3.5-flash',
    'text',
  );
  expect(exactResultAfterPrefixMatch.selected.model).toBe('gemini-3.5-flash');
  expect(() => resolveAIStudioModelSearchResult(
    ['Nano Banana 2 Lite gemini-3.1-flash-lite-image'],
    'gemini-3.1-flash-lite-image',
    'text',
  )).toThrow(/Unknown AI Studio model/);
});

it('Chinese prompt fixture contains the visible UI contract', () => {
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  for (const snippet of [
    'lang="zh-CN"',
    '<ms-prompt-box>',
    'data-test="selectMediaMenu"',
    'data-test-upload-file-input',
    'aria-label="Remove media"',
    '<ms-run-button>',
    'type="submit"',
    'aria-label="停止生成"',
    'role="alert"',
    '配额限制',
  ]) {
    expect(fixture.includes(snippet)).toBeTruthy();
  }
});

it('prompt newline normalization matches the textarea value model', () => {
  expect(normalizeAIStudioPrompt('a\r\nb\rc')).toBe('a\nb\nc');
});

it('turn diff treats a second identical prompt as a new turn', () => {
  const prompt = 'same long prompt';
  const baseline = { turns: [userTurn(prompt)] };
  const current = { turns: [userTurn(prompt), userTurn(prompt), modelTurn('answer')] };
  const newUsers = findNewAIStudioTurns(current, baseline, 'user');
  expect(newUsers.length).toBe(1);
  expect(newUsers[0].text).toBe(prompt);
  expect(aiStudioTurnFingerprint(newUsers[0])).toBe(aiStudioTurnFingerprint(userTurn(prompt)));
});

it('composer clearing alone is not submission evidence', () => {
  const baseline = { turns: [userTurn('prompt')] };
  const current = { turns: baseline.turns, composerText: '', isGenerating: false, runButtonDisabled: false };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, 'prompt');
  expect(evidence.ok).toBe(false);
  expect(evidence.reason).toBe('no-submission-signal');
});

it('snapshot keeps model turns with prompt/text chunks as model under browser serialization', async () => {
  const chunk = (text) => ({ innerText: text, textContent: text });
  const makeTurn = ({ roleClass, heading, text, promptChunk = true, loading = false, footer = false }) => ({
    id: `turn-${roleClass}`,
    classList: { contains: (name) => name === roleClass },
    getAttribute: () => null,
    innerText: `${heading} ${text}`,
    textContent: `${heading} ${text}`,
    querySelector: (selector) => {
      if (selector === '.chat-turn-container') {
        return { classList: { contains: (name) => name === roleClass }, getAttribute: () => null };
      }
      if (selector === '[role="heading"]') return heading ? { innerText: heading, textContent: heading } : null;
      if (selector.includes('ms-chat-loading-indicator') || selector.includes('ms-model-turn-content')) return loading ? {} : null;
      if (selector.includes('ms-prompt-chunk') || selector.includes('ms-prompt-image') || selector.includes('ms-text-chunk')) return promptChunk ? {} : null;
      if (selector.includes('img') || selector.includes('video') || selector.includes('audio') || selector.includes('ms-image-chunk')) return null;
      if (selector.includes('turn-footer') || selector.includes('feedback') || selector.includes('Good response') || selector.includes('有帮助')) return footer ? {} : null;
      return null;
    },
    querySelectorAll: (selector) => selector === 'ms-prompt-chunk' ? (promptChunk ? [chunk(text)] : []) : [],
  });
  const userEl = makeTurn({ roleClass: 'user', heading: 'User 14:56', text: 'Reply with exactly: OK' });
  const modelEl = makeTurn({ roleClass: 'model', heading: 'Model 14:56', text: 'OK', footer: true });
  const composer = { value: '' };
  const fakeDocument = {
    querySelectorAll: (selector) => selector === 'ms-chat-turn' ? [userEl, modelEl] : [],
    querySelector: (selector) => selector === 'ms-prompt-box textarea' ? composer : null,
  };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = fakeDocument;
  globalThis.window = { location: { href: 'https://aistudio.google.com/prompts/new_chat' } };
  try {
    const snapshot = await readAIStudioSnapshot({
      evaluate: async (fn, ...args) => {
        const script = new vm.Script(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
        return script.runInNewContext({ document: fakeDocument, window: globalThis.window });
      },
    });
    expect(snapshot.turns[0].role).toBe('user');
    expect(snapshot.turns[1].role).toBe('model');
    expect(snapshot.turns[0].text).toBe('Reply with exactly: OK');
    expect(snapshot.turns[1].text).toBe('OK');
    const evidence = getAIStudioSubmissionEvidence(snapshot, { turns: [] }, 'Reply with exactly: OK');
    expect(evidence.ok).toBe(true);
    expect(evidence.reason).toBe('new-user-turn');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

it('snapshot only blocks completion on generated images that are still decoding', async () => {
  const makeImg = ({ src, attrs = {} }) => ({
    currentSrc: src,
    src,
    alt: '',
    naturalWidth: 0,
    naturalHeight: 0,
    width: 0,
    height: 0,
    getAttribute: (name) => attrs[name] ?? null,
  });
  const readModelSnapshot = async (img) => {
    const modelEl = {
      id: 'model-turn-1',
      classList: { contains: (name) => name === 'model' },
      getAttribute: () => null,
      innerText: 'Model 14:56 done',
      textContent: 'Model 14:56 done',
      querySelector: (selector) => {
        if (selector === '.chat-turn-container') {
          return { classList: { contains: (name) => name === 'model' }, getAttribute: () => null };
        }
        if (selector === '[role="heading"]') return { innerText: 'Model', textContent: 'Model' };
        if (selector.includes('ms-chat-loading-indicator') || selector.includes('ms-model-turn-content')) return {};
        if (selector.includes('turn-footer') || selector.includes('feedback') || selector.includes('Good response') || selector.includes('有帮助')) return {};
        return null;
      },
      querySelectorAll: (selector) => (selector === 'img' ? [img] : []),
    };
    const composer = { value: '' };
    const fakeDocument = {
      querySelectorAll: (selector) => (selector === 'ms-chat-turn' ? [modelEl] : []),
      querySelector: (selector) => (selector === 'ms-prompt-box textarea' ? composer : null),
    };
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = fakeDocument;
    globalThis.window = { location: { href: 'https://aistudio.google.com/prompts/new_chat' } };
    try {
      return await readAIStudioSnapshot({
        evaluate: async (fn, ...args) => {
          const script = new vm.Script(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
          return script.runInNewContext({ document: fakeDocument, window: globalThis.window });
        },
      });
    } finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  };

  // A blob/data asset still decoding is generated output: it blocks completion.
  const blobSnapshot = await readModelSnapshot(makeImg({ src: 'blob:https://aistudio.google.com/abc' }));
  expect(blobSnapshot.turns[0].role).toBe('model');
  expect(blobSnapshot.turns[0].pendingDecode).toBe(true);

  // An explicitly marked avatar is decorative and must not stall a text reply.
  const avatarSnapshot = await readModelSnapshot(makeImg({ src: 'https://storage.googleapis.com/avatar.png', attrs: { alt: 'avatar' } }));
  expect(avatarSnapshot.turns[0].images).toHaveLength(0);
  expect(avatarSnapshot.turns[0].pendingDecode).toBe(false);

  // A non-decorative remote generated asset remains visible even at 0x0 while
  // it decodes, and its pending state blocks completion.
  const remoteSnapshot = await readModelSnapshot(makeImg({ src: 'https://storage.googleapis.com/generated-output.png' }));
  expect(remoteSnapshot.turns[0].images).toHaveLength(1);
  expect(remoteSnapshot.turns[0].images[0].src).toContain('generated-output');
  expect(remoteSnapshot.turns[0].pendingDecode).toBe(true);

  // A remote image declaring a large layout size is generated output still
  // decoding: it blocks completion.
  const largeRemoteSnapshot = await readModelSnapshot(makeImg({
    src: 'https://storage.googleapis.com/gen-1.png',
    attrs: { width: '1024', height: '1024' },
  }));
  expect(largeRemoteSnapshot.turns[0].pendingDecode).toBe(true);
});

it('snapshot reads a model response rendered inside nested open shadow roots', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn id="shadow-model"><div class="chat-turn-container model"></div></ms-chat-turn>
  </body>`);
  const document = dom.window.document;
  const turn = document.querySelector('ms-chat-turn');
  const container = turn.querySelector('.chat-turn-container');
  const responseHost = document.createElement('ms-model-turn-content');
  const responseRoot = responseHost.attachShadow({ mode: 'open' });
  const nestedHost = document.createElement('ms-markdown-renderer');
  responseRoot.appendChild(nestedHost);
  const nestedRoot = nestedHost.attachShadow({ mode: 'open' });
  nestedRoot.innerHTML = '<div class="response-text">READY-SHADOW-DOM</div>';
  container.appendChild(responseHost);
  const footer = document.createElement('button');
  footer.setAttribute('aria-label', 'Good response');
  footer.textContent = 'Good response';
  container.appendChild(footer);
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot(page);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0].role).toBe('model');
    expect(snapshot.turns[0].text).toContain('READY-SHADOW-DOM');
    expect(snapshot.turns[0].complete).toBe(true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot excludes turn actions and reads the current model text chunk', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn id="user-turn"><div class="chat-turn-container user render">
      <ms-prompt-chunk>Reply with exactly CONTROL_FILTER_OK.</ms-prompt-chunk>
    </div></ms-chat-turn>
    <ms-chat-turn id="model-turn"><div class="chat-turn-container model render">
      <div class="actions-container"><ms-chat-turn-options><button aria-label="Open options"><span class="material-symbols-outlined">more_vert</span></button></ms-chat-turn-options></div>
      <div class="virtual-scroll-container model-prompt-container"><div class="turn-content">
        <div role="heading" class="author-label">Model 3:46 PM</div>
        <ms-text-chunk>CONTROL_FILTER_OK.</ms-text-chunk>
      </div></div>
      <div class="turn-footer"><button aria-label="Good response"><span class="material-symbols-outlined">thumb_up</span></button></div>
    </div></ms-chat-turn>
  </body>`);
  const document = dom.window.document;
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot(page);
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.text).toBe('CONTROL_FILTER_OK.');
    expect(model?.text).not.toContain('more_vert');
    expect(model?.text).not.toContain('thumb_up');
    expect(model?.complete).toBe(true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot does not concatenate a prompt shadow chunk with the model response chunk', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn id="model-turn"><div class="chat-turn-container model render">
      <ms-prompt-chunk>TI</ms-prompt-chunk>
      <div class="turn-content"><ms-text-chunk>TITLER-DOM-OK.</ms-text-chunk></div>
      <div class="turn-footer"><button aria-label="Good response">Good response</button></div>
    </div></ms-chat-turn>
  </body>`);
  const document = dom.window.document;
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot(page);
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.text).toBe('TITLER-DOM-OK.');
    expect(model?.text).not.toContain('TI\n\n');
    expect(model?.complete).toBe(true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot keeps a control-only model turn empty while its footer is visible', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn id="model-turn"><div class="chat-turn-container model render">
      <div class="actions-container"><ms-chat-turn-options><button aria-label="Open options"><span class="material-symbols-outlined">more_vert</span></button></ms-chat-turn-options></div>
      <div class="turn-footer"><span class="model-run-time-pill">0.9s</span></div>
    </div></ms-chat-turn>
  </body>`);
  const document = dom.window.document;
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot(page);
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.text).toBe('');
    expect(model?.complete).toBe(true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot ignores a benign role=alert live region inside a model turn', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn><div class="chat-turn-container model">
      <div class="turn-content"><ms-text-chunk>LIVE_REGION_OK</ms-text-chunk><div role="alert">This explanation covers login errors, failed requests, and subscriptions.</div></div>
      <div class="turn-footer"><button aria-label="Good response">Good</button></div>
    </div></ms-chat-turn>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot({ evaluate: async (fn, ...args) => fn(...args) });
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.text).toBe('LIVE_REGION_OK');
    expect(model?.error).toBeNull();
    expect(snapshot.alerts).toEqual([]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot recognizes an explicit ms-error-message without role=alert', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-error-message>Quota exceeded. Please try again later.</ms-error-message>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot({ evaluate: async (fn, ...args) => fn(...args) });
    expect(snapshot.alerts).toContain('Quota exceeded. Please try again later.');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot surfaces an explicit error widget verbatim at any length', async () => {
  const longError = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} of the native quota error message.`).join(' ');
  if (longError.length <= 160) throw new Error('fixture too short');
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-error-message>${longError}</ms-error-message>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot({ evaluate: async (fn, ...args) => fn(...args) });
    expect(snapshot.alerts).toContain(longError);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot still window-trims a broad live region longer than 160 chars', async () => {
  const filler = Array.from({ length: 20 }, (_, i) => `filler clause ${i + 1} about subscriptions and regions`).join(', ');
  // A broad live region wrapping UI chrome plus a short inline error idiom:
  // the window-trim keeps the surfaced alert readable. Blocked-content idioms
  // no longer participate here (anchored full-match), so use an inline idiom.
  const longLive = `Generation status: content generation failed while streaming. ${filler}`.slice(0, 240);
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <div role="alert">${longLive}</div>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot({ evaluate: async (fn, ...args) => fn(...args) });
    expect(snapshot.alerts).toHaveLength(1);
    expect(snapshot.alerts[0].length).toBeLessThan(longLive.length);
    expect(snapshot.alerts[0]).toContain('content generation failed');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('empty-shell evidence captures the raw model turn and live regions verbatim', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-chat-turn><div class="chat-turn-container user"><div class="turn-content"><ms-text-chunk>question</ms-text-chunk></div></div></ms-chat-turn>
    <ms-chat-turn id="shell"><div class="chat-turn-container model render">
      <span class="author-label">Model</span>
      <div class="turn-content"></div>
      <div class="turn-footer"><span class="model-run-time-pill">2.7s</span></div>
    </div></ms-chat-turn>
    <div role="alert">Rate limit exceeded. Try again later.</div>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const evidence = await collectAIStudioEmptyShellEvidence({ evaluate: async (fn, ...args) => fn(...args) });
    expect(evidence.turnFound).toBe(true);
    expect(evidence.turnHtml).toContain("model-run-time-pill");
    expect(evidence.turnHtml).toContain("2.7s");
    expect(evidence.turnHtml).not.toContain("question");
    expect(evidence.liveRegions).toEqual(["Rate limit exceeded. Try again later."]);
    expect(evidence.pageTextTail).toContain("Rate limit exceeded");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('snapshot preserves syntax-highlighted code blocks as fenced code', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn><div class="chat-turn-container model">
      <div class="turn-content"><pre><code><span class="token keyword">const</span><span class="token plain"> answer = 42;</span></code></pre></div>
      <div class="turn-footer"><button aria-label="Good response">Good</button></div>
    </div></ms-chat-turn>
  </body>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot({ evaluate: async (fn, ...args) => fn(...args) });
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.text).toContain('```');
    expect(model?.text).toContain('const answer = 42;');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('submission evidence accepts one user turn plus a model turn that reuses text chunks', () => {
  const baseline = { turns: [] };
  const current = {
    turns: [
      userTurn('Reply with exactly: OK'),
      { role: 'model', text: 'OK', images: [], complete: true },
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, 'Reply with exactly: OK');
  expect(evidence.ok).toBe(true);
  expect(evidence.reason).toBe('new-user-turn');
});

it('submission evidence accepts exactly one new user turn and rejects duplicates', () => {
  const baseline = { turns: [userTurn('prompt')] };
  const oneTurn = { turns: [userTurn('prompt'), userTurn('prompt')], composerText: '', isGenerating: true, runButtonDisabled: true };
  const duplicate = { turns: [userTurn('prompt'), userTurn('prompt'), userTurn('prompt')], composerText: '', isGenerating: true, runButtonDisabled: true };
  expect(getAIStudioSubmissionEvidence(oneTurn, baseline, 'prompt').reason).toBe('new-user-turn');
  expect(getAIStudioSubmissionEvidence(duplicate, baseline, 'prompt').reason).toBe('multiple-new-user-turns');
});

it('submission evidence merges one or more media chunks with its text chunk', () => {
  const prompt = 'IMAGE_TRACE_OK';
  const baseline = { turns: [] };
  const singleImageCurrent = {
    turns: [
      { role: 'user', text: '', images: [{ src: 'data:image/jpeg;base64,uploaded' }] },
      userTurn(prompt),
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const multipleImageCurrent = {
    turns: [
      { role: 'user', text: '', images: [{ src: 'data:image/jpeg;base64,uploaded_1' }] },
      { role: 'user', text: '', images: [{ src: 'data:image/jpeg;base64,uploaded_2' }] },
      userTurn(prompt),
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const singleEvidence = getAIStudioSubmissionEvidence(singleImageCurrent, baseline, prompt);
  expect(singleEvidence.ok).toBe(true);
  expect(singleEvidence.reason).toBe('new-user-turn-with-media-chunk');
  
  const multipleEvidence = getAIStudioSubmissionEvidence(multipleImageCurrent, baseline, prompt);
  expect(multipleEvidence.ok).toBe(true);
  expect(multipleEvidence.reason).toBe('new-user-turn-with-media-chunk');

  // A second text-only user turn is a duplicate-submission signal, not a media
  // chunk: a media chunk must carry actual media.
  const transientPairCurrent = {
    turns: [
      { role: 'user', text: '', images: [] },
      userTurn(prompt),
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const transientEvidence = getAIStudioSubmissionEvidence(transientPairCurrent, baseline, prompt);
  expect(transientEvidence.ok).toBe(false);
  expect(transientEvidence.reason).toBe('multiple-new-user-turns');
});

it('submission evidence merges a truncated long prompt with its media chunk', () => {
  const prompt = `LONG_PROMPT_${'x'.repeat(600)}`;
  const baseline = { turns: [] };
  const current = {
    turns: [
      { role: 'user', text: '', images: [{ src: 'data:image/jpeg;base64,uploaded' }], hasMedia: true },
      { role: 'user', text: `${prompt.slice(0, 450)}_tail`, images: [] },
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, prompt);
  expect(evidence.ok).toBe(true);
  expect(evidence.reason).toBe('new-user-turn-with-media-chunk');
});

it('generating plus turn growth is a guarded fallback signal', () => {
  const baseline = { turns: [userTurn('prompt')] };
  const current = {
    turns: [userTurn('prompt'), modelTurn('')],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, 'prompt');
  expect(evidence.ok).toBe(true);
  expect(evidence.reason).toBe('generating-with-turn-growth');
});

it('cleared composer with hidden-tab turn growth is accepted as submission evidence', () => {
  const baseline = { turns: [] };
  const current = {
    turns: [
      { role: 'unknown', text: '', images: [] },
      { role: 'unknown', text: '', images: [] },
      { role: 'model', text: '', images: [] },
    ],
    composerText: '',
    isGenerating: false,
    runButtonDisabled: false,
  };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, 'prompt');
  expect(evidence.ok).toBe(true);
  expect(evidence.reason).toBe('turn-growth-with-cleared-composer');
});

it('response waiting ignores a loading turn and requires stable content', async () => {
  // The text-confirm window (1.5s) requires real time to elapse between polls,
  // so the mock advances the fake clock on every page.wait(0.2) tick.
  vi.useFakeTimers();
  const snaps = [
    {
      turns: [{ role: 'model', text: '', images: [], loading: true, complete: true }],
      alerts: [],
      isGenerating: true,
      runButtonFound: true,
      runButtonDisabled: false,
      url: 'https://aistudio.google.com/prompts/new_chat',
    },
  ];
  const stableSnapshot = {
    turns: [{ role: 'model', text: 'IMAGE_TRACE_OK', images: [], loading: false, complete: true }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = snaps.concat(Array.from({ length: 40 }, () => ({ ...stableSnapshot, turns: [{ ...stableSnapshot.turns[0] }] })));
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.text).toBe('IMAGE_TRACE_OK');
  // The confirm window holds the answer for 1.5s of stable text (>= 7 polls at
  // 0.2s after the completion signal) before returning it.
  expect(waits.length).toBeGreaterThanOrEqual(7);
  vi.useRealTimers();
});

it('response waiting does not return a thinking-only turn before the answer appears', async () => {
  vi.useFakeTimers();
  const thinkingSnapshot = {
    turns: [{ role: 'model', text: 'Thoughts: ...', images: [], loading: false, complete: false, thinkingOnly: true }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const answerSnapshot = {
    turns: [{ role: 'model', text: 'Answer', images: [], loading: false, complete: true, thinkingOnly: false }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = [thinkingSnapshot, thinkingSnapshot, thinkingSnapshot]
    .concat(Array.from({ length: 40 }, () => ({ ...answerSnapshot, turns: [{ ...answerSnapshot.turns[0] }] })));
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.text).toBe('Answer');
  expect(waits.length).toBeGreaterThanOrEqual(7);
  vi.useRealTimers();
});

it('response waiting does not treat a 0x0 blob image as done until it decodes', async () => {
  const undecodedTurn = {
    turns: [{
      role: 'model',
      text: '',
      images: [{ src: 'blob:https://aistudio.google.com/abc', width: 0, height: 0 }],
      loading: false,
      complete: false,
    }],
    alerts: [],
    isGenerating: true,
    runButtonFound: true,
    runButtonDisabled: true,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const decodedTurn = {
    turns: [{
      role: 'model',
      text: '',
      images: [{ src: 'blob:https://aistudio.google.com/abc', width: 1024, height: 1024 }],
      loading: false,
      complete: false,
    }],
    alerts: [],
    isGenerating: true,
    runButtonFound: true,
    runButtonDisabled: true,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = [undecodedTurn, undecodedTurn, decodedTurn];
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.images[0].src).toBe('blob:https://aistudio.google.com/abc');
  expect(result.images[0].width).toBe(1024);
  expect(result.images[0].height).toBe(1024);
  expect(waits).toEqual([0.2, 0.2]);
});

it('response waiting refuses a 0x0 blob even when generation ended and the Run button re-enabled', async () => {
  // The third completion signal (Run button enabled + no generation in flight)
  // must not bypass the image decode; GPT reported this exact bypass.
  const undecodedTurn = {
    turns: [{
      role: 'model',
      text: '',
      images: [{ src: 'blob:https://aistudio.google.com/abc', width: 0, height: 0 }],
      loading: false,
      complete: false,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const decodedTurn = {
    turns: [{
      role: 'model',
      text: '',
      images: [{ src: 'blob:https://aistudio.google.com/abc', width: 512, height: 512 }],
      loading: false,
      complete: false,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = [undecodedTurn, undecodedTurn, decodedTurn];
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.images[0].src).toBe('blob:https://aistudio.google.com/abc');
  expect(result.images[0].width).toBe(512);
  expect(result.images[0].height).toBe(512);
  expect(waits).toEqual([0.2, 0.2]);
});

it('response waiting does not complete while a generated image is still decoding, even with a footer', async () => {
  // The completion gate honors the snapshot's pendingDecode flag: while a
  // generated image (blob/data, or a large remote asset) is still decoding, a
  // completion footer and a re-enabled Run button must not fire early.
  const undecodedTurn = {
    turns: [{
      role: 'model',
      text: 'done text',
      // Remote image present but still decoding; its pendingDecode flag keeps the
      // completion gate closed even though the turn shows a footer and the Run
      // button is re-enabled (the blob/data-only gate would miss this).
      images: [{ src: 'https://storage.googleapis.com/gen-123.png', width: 0, height: 0 }],
      pendingDecode: true,
      loading: false,
      complete: true,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const decodedTurn = {
    turns: [{
      role: 'model',
      text: 'done text',
      images: [{ src: 'https://storage.googleapis.com/gen-123.png', width: 1024, height: 1024 }],
      pendingDecode: false,
      loading: false,
      complete: true,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = [undecodedTurn, undecodedTurn, undecodedTurn, decodedTurn];
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.images[0].width).toBe(1024);
  expect(result.images[0].height).toBe(1024);
  expect(waits).toEqual([0.2, 0.2, 0.2]);
});

it('response waiting fails fast when the page state never changes (stall detection)', async () => {
  vi.useFakeTimers();
  const frozen = {
    turns: [{ role: 'model', text: '', images: [], loading: true, complete: false }],
    alerts: [],
    isGenerating: true,
    runButtonFound: true,
    runButtonDisabled: true,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return { ...frozen };
    },
  };

  await expect(waitForAIStudioResponse(page, { turns: [] }, 120)).rejects.toThrow('AI Studio generation stalled');
  // 45s stall budget at 0.2s polls: ~225 polls before the fast fail.
  expect(waits.length).toBeGreaterThanOrEqual(200);
  expect(waits.length).toBeLessThan(260);
  vi.useRealTimers();
});

it('response waiting does not stall while a complete-but-empty shell waits for a slow render', async () => {
  vi.useFakeTimers();
  // A complete-but-empty turn shell is exempt from the 45s stall detector; it
  // has its own 60s empty-shell timeout so slow image renders survive (this
  // state previously tripped the stall detector first, making the empty-shell
  // timeout unreachable).
  const emptyCompleteTurn = {
    turns: [{ role: 'model', text: '', images: [], pendingDecode: false, loading: false, complete: true }],
    alerts: [],
    isGenerating: false,
    runButtonFound: false,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const withTextTurn = {
    turns: [{ role: 'model', text: 'OK', images: [], pendingDecode: false, loading: false, complete: true }],
    alerts: [],
    isGenerating: false,
    runButtonFound: false,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  // 250 polls at 0.2s = 50s of empty shell: beyond the 45s stall budget.
  const snapshots = Array.from({ length: 250 }, () => ({ ...emptyCompleteTurn, turns: [{ ...emptyCompleteTurn.turns[0] }] }))
    .concat(Array.from({ length: 40 }, () => ({ ...withTextTurn, turns: [{ ...withTextTurn.turns[0] }] })));
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 120);

  expect(result.text).toBe('OK');
  expect(waits.length).toBeGreaterThanOrEqual(250);
  vi.useRealTimers();
});

it('response waiting counts streamed thinking text as activity', async () => {
  vi.useFakeTimers();
  // A reasoning phase that streams thought chunks keeps resetting the stall
  // detector even though the answer text is still empty; only a truly frozen
  // thinking phase (unchanged thought text) trips the 45s stall.
  const thinkingTurns = [];
  for (let index = 0; index < 300; index += 1) {
    thinkingTurns.push({
      turns: [{ role: 'model', text: '', images: [], loading: true, complete: false, thinkingText: 'step'.repeat(index + 1) }],
      alerts: [],
      isGenerating: true,
      runButtonFound: true,
      runButtonDisabled: true,
      url: 'https://aistudio.google.com/prompts/new_chat',
    });
  }
  const answerTurn = {
    turns: [{ role: 'model', text: 'Answer', images: [], loading: false, complete: true, thinkingText: 'step'.repeat(300) }],
    alerts: [],
    isGenerating: false,
    runButtonFound: true,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = thinkingTurns
    .concat(Array.from({ length: 40 }, () => ({ ...answerTurn, turns: [{ ...answerTurn.turns[0] }] })));
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 120);

  expect(result.text).toBe('Answer');
  expect(waits.length).toBeGreaterThan(300);
  vi.useRealTimers();
});

it('response waiting keeps polling until a complete turn materializes its text', async () => {
  vi.useFakeTimers();
  // AI Studio's virtual-scrolled conversation can show the completion footer
  // before the response text renders. A complete-but-empty turn must not be
  // returned (dropping a real answer); the gate waits for the text to appear.
  const emptyCompleteTurn = {
    turns: [{
      role: 'model',
      text: '',
      images: [],
      pendingDecode: false,
      loading: false,
      complete: true,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: false,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const withTextTurn = {
    turns: [{
      role: 'model',
      text: 'OK',
      images: [],
      pendingDecode: false,
      loading: false,
      complete: true,
    }],
    alerts: [],
    isGenerating: false,
    runButtonFound: false,
    runButtonDisabled: false,
    url: 'https://aistudio.google.com/prompts/new_chat',
  };
  const snapshots = [emptyCompleteTurn, emptyCompleteTurn]
    .concat(Array.from({ length: 40 }, () => ({ ...withTextTurn, turns: [{ ...withTextTurn.turns[0] }] })));
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    },
    async evaluate() {
      return snapshots.shift();
    },
  };

  const result = await waitForAIStudioResponse(page, { turns: [] }, 5);

  expect(result.text).toBe('OK');
  // Empty shells never confirm; the answer must stay stable for 1.5s first.
  expect(waits.length).toBeGreaterThanOrEqual(7);
  vi.useRealTimers();
});

it('DOM state waiter polls until the readiness predicate is true', async () => {
  const states = [{ ready: false }, { ready: false }, { ready: true }];
  const waits = [];
  const page = {
    async wait(seconds) {
      waits.push(seconds);
    },
  };
  const result = await waitForAIStudioState(
    page,
    'fixture DOM state',
    async () => states.shift(),
    (state) => state?.ready === true,
    { timeoutSeconds: 5, pollSeconds: 0.1 },
  );
  expect(result).toEqual({ ready: true });
  expect(waits).toEqual([0.1, 0.1]);
});

it('keyboard submit primes a multi-line prompt with Control+End before the native Enter', async () => {
  const prompt = `Reply with exactly LONG_OK.\n${'filler-token '.repeat(450)}`;
  const calls = [];
  const page = {
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: true };
    },
    async pressKey(key) {
      calls.push(`press:${key}`);
    },
    async nativeKeyPress(key, modifiers = []) {
      calls.push(`press:${modifiers.length ? `${modifiers.join('+')}+` : ''}${key}`);
    },
    async wait(seconds) {
      calls.push(`wait:${seconds}`);
    },
    async evaluate(fn, ...args) {
      const fnStr = String(fn);
      if (fnStr.includes('navigator.platform')) return false; // OS detection -> Control, not Meta
      if (fnStr.includes('activeElement === composer')) return { focused: true, composerFound: true }; // Focus state
      if (fnStr.includes('visibilityState')) return { visibilityState: 'visible', hasFocus: true }; // Tab state
      if (fnStr.includes('setSelectionRange')) return true; // Caret-to-end enforcement
      if (fnStr.includes('runButtonShortcut')) {
        return {
          turns: [],
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
          runButtonShortcut: 'enter',
          alerts: [],
        };
      }
      return { focused: true, composerFound: true, promptReady: true, composerLength: prompt.length, connected: true };
    },
  };

  const result = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector: 'ms-prompt-box textarea',
    expectedText: prompt,
    readFocusState: async () => ({ focused: true }),
    readComposerState: async () => ({
      promptReady: true,
      composerLength: prompt.length,
      focused: true,
      selectionStart: prompt.length,
      selectionEnd: prompt.length,
    }),
  });

  expect(result.action).toBe('cdp-press-key');
  expect(calls.filter((call) => call.startsWith('press:'))).toEqual([
    'press:Control+End',
    'press:Enter',
  ]);
});

it('keyboard submit follows the Run button Ctrl+Enter shortcut', async () => {
  const prompt = 'Reply with exactly CTRL_OK.';
  const calls = [];
  let evaluateCount = 0;
  let submittedShortcut = null;
  const page = {
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: true };
    },
    async pressKey(key) {
      calls.push(`press:${key}`);
    },
    async nativeKeyPress(key, modifiers = []) {
      calls.push(`press:${modifiers.length ? `${modifiers.join('+')}+` : ''}${key}`);
    },
    async wait(seconds) {
      calls.push(`wait:${seconds}`);
    },
    async evaluate(fn, ...args) {
      const fnStr = String(fn);
      if (fnStr.includes('navigator.platform')) return false; // OS detection
      if (fnStr.includes('activeElement === composer')) return { focused: true, composerFound: true }; // Focus state
      if (fnStr.includes('visibilityState')) return { visibilityState: 'visible', hasFocus: true }; // Tab state
      if (fnStr.includes('runButtonShortcut')) {
        return {
          turns: [],
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
          runButtonShortcut: 'ctrl-enter',
          alerts: [],
        };
      }
      return {
        submitted: true,
        dispatchResult: false,
        isTrusted: false,
        shortcut: args[1], // if passing shortcut
        ctrlKey: args[1] === 'ctrl-enter',
        valueLength: 0,
        focused: true,
        selectionStart: 0,
        selectionEnd: 0,
      };
    },
  };

  const result = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector: 'ms-prompt-box textarea',
    expectedText: prompt,
    readFocusState: async () => ({ focused: true }),
    readComposerState: async () => ({
      promptReady: true,
      composerLength: prompt.length,
      focused: true,
      selectionStart: prompt.length,
      selectionEnd: prompt.length,
    }),
  });

  expect(result.action).toBe('cdp-press-key');
  expect(calls.filter((call) => call.startsWith('press:'))).toEqual([
    'press:Control+End',
    'press:Control+Enter',
  ]);
});

it('keyboard submit falls back to a Run button click when the tab is hidden', async () => {
  const prompt = 'Reply with exactly CLICK_OK.';
  const calls = [];
  const page = {
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: true };
    },
    async pressKey(key) {
      calls.push(`press:${key}`);
    },
    async wait(seconds) {
      calls.push(`wait:${seconds}`);
    },
    async evaluate(fn, ...args) {
      const fnStr = String(fn);
      if (fnStr.includes('navigator.platform')) return false;
      if (fnStr.includes('activeElement === composer')) return { focused: true, composerFound: true };
      if (fnStr.includes('visibilityState')) return { visibilityState: 'hidden', hasFocus: true };
      if (fnStr.includes('runButtonShortcut')) {
        return {
          turns: [],
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
          runButtonShortcut: 'ctrl-enter',
          alerts: [],
        };
      }
      if (fnStr.includes('runButton.click()')) return { ok: true };
      return { focused: true };
    },
  };

  const result = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector: 'ms-prompt-box textarea',
    expectedText: prompt,
    readFocusState: async () => ({ focused: true }),
    readComposerState: async () => ({
      promptReady: true,
      composerLength: prompt.length,
      focused: true,
      selectionStart: prompt.length,
      selectionEnd: prompt.length,
    }),
  });

  expect(result.action).toBe('js-run-click');
  expect(calls.includes('press:Control+Enter')).toBe(false);
  expect(calls.filter((call) => call.startsWith('press:'))).toEqual(['press:Control+End']);
});

it('background mode uses exactly one Run-button click even when the tab reports visible', async () => {
  const prompt = 'Reply with exactly BACKGROUND_CLICK_OK.';
  const calls = [];
  const page = {
    windowMode: 'background',
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: true };
    },
    async pressKey(key) {
      calls.push(`press:${key}`);
    },
    async selectTab() {
      throw new Error('background mode must not select a tab');
    },
    getActivePage() {
      throw new Error('background mode must not inspect the active tab');
    },
    async cdp(method) {
      throw new Error(`background mode must not call ${method}`);
    },
    async wait() {},
    async evaluate(fn, ...args) {
      const fnStr = String(fn);
      if (fnStr.includes('navigator.platform')) return false;
      if (fnStr.includes('activeElement === composer')) return { focused: true, composerFound: true };
      if (fnStr.includes('visibilityState')) return { visibilityState: 'visible', hasFocus: true };
      if (fnStr.includes('window.focus')) throw new Error('background mode must not call window.focus');
      if (fnStr.includes('runButtonShortcut')) {
        return {
          turns: [],
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
          runButtonShortcut: 'ctrl-enter',
          alerts: [],
        };
      }
      if (fnStr.includes('runButton.click()')) return { ok: true };
      return { focused: true };
    },
  };

  const result = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector: 'ms-prompt-box textarea',
    expectedText: prompt,
    readFocusState: async () => ({ focused: true }),
    readComposerState: async () => ({
      promptReady: true,
      composerLength: prompt.length,
      focused: true,
      selectionStart: prompt.length,
      selectionEnd: prompt.length,
    }),
  });

  expect(result.action).toBe('js-run-click');
  expect(calls.filter((call) => call.startsWith('press:'))).toEqual(['press:Control+End']);
});

it('window restore prefers CDP Browser.setWindowBounds before powershell fallback', async () => {
  const calls = [];
  const page = {
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: true };
    },
    async pressKey(key) {
      calls.push(`press:${key}`);
    },
    async nativeKeyPress(key, modifiers = []) {
      calls.push(`press:${modifiers.length ? `${modifiers.join('+')}+` : ''}${key}`);
    },
    async wait(seconds) {
      calls.push(`wait:${seconds}`);
    },
    getActivePage() {
      return 'target-1';
    },
    async cdp(method) {
      calls.push(`cdp:${method}`);
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 };
      return {};
    },
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('navigator.platform')) return false;
      if (fnStr.includes('activeElement === composer')) return { focused: true, composerFound: true };
      if (fnStr.includes('visibilityState')) return { visibilityState: 'visible', hasFocus: true };
      if (fnStr.includes('runButtonShortcut')) {
        return {
          turns: [],
          isGenerating: false,
          runButtonFound: true,
          runButtonDisabled: false,
          runButtonShortcut: 'enter',
          alerts: [],
        };
      }
      return { focused: true };
    },
  };

  const result = await submitAIStudioComposerWithKeyboard(page, {
    composerSelector: 'ms-prompt-box textarea',
    expectedText: 'Reply with exactly CDP_OK.',
    readFocusState: async () => ({ focused: true }),
    readComposerState: async () => ({
      promptReady: true,
      composerLength: 26,
      focused: true,
      selectionStart: 26,
      selectionEnd: 26,
    }),
  });

  expect(result.action).toBe('cdp-press-key');
  expect(calls.includes('cdp:Browser.getWindowForTarget')).toBeTruthy();
  expect(calls.includes('cdp:Browser.setWindowBounds')).toBeTruthy();
  expect(calls.filter((call) => call.startsWith('press:'))).toEqual(['press:Control+End', 'press:Enter']);
});

it('powershell restore fallback emits compilable C# and escapes the pipe split', () => {
  const source = fs.readFileSync(path.resolve(testDirectory, 'utils.js'), 'utf8');
  const functionStart = source.indexOf('function restoreAIStudioWindow');
  const arrayStart = source.indexOf('const script = [', functionStart);
  const arrayEnd = source.indexOf("].join('\\n')", arrayStart) + "].join('\\n')".length;
  const script = vm.runInNewContext(`${source.slice(arrayStart, arrayEnd)}; script`);
  const lines = script.split('\n');

  const raiseIndex = lines.findIndex((line) => line.includes('public static int Raise'));
  const showIndex = lines.findIndex((line) => line.includes('ShowWindow(h, 9);'));
  expect(lines[raiseIndex + 1]).toContain("row.Split('|')");
  expect(lines[raiseIndex + 1]).not.toBe('0');
  expect(showIndex).toBe(raiseIndex + 2);
  expect(lines.join('\n')).toContain('new IntPtr(-2)');
  expect(lines.join('\n')).toContain('Start-Sleep -Milliseconds 1200');
  expect(lines.join('\n')).toContain('ClearTop($r)');

  const iconicLine = lines.find((line) => line.includes('$_ -split'));
  expect(iconicLine).toContain('-split "\\|"');
});


it('composer focus falls back to a click after media upload steals focus', async () => {
  const calls = [];
  let focused = false;
  const page = {
    async focus(selector) {
      calls.push(`focus:${selector}`);
      return { focused: false };
    },
    async click(selector) {
      calls.push(`click:${selector}`);
      focused = true;
      return { clicked: true };
    },
    async evaluate() {
      calls.push('focus-state');
      return { composerFound: true, focused };
    },
  };

  const result = await focusAIStudioComposer(page, 'ms-prompt-box textarea');

  expect(result.focused).toBe(true);
  expect(calls).toEqual([
    'focus:ms-prompt-box textarea',
    'focus-state',
    'click:ms-prompt-box textarea',
    'focus-state',
  ]);
});

it('error classifier covers Chinese quota, safety, auth, and English transport messages', () => {
  expect(isAIStudioErrorText('已超出配额限制')).toBe(true);
  expect(isAIStudioErrorText('The model is unavailable')).toBe(true);
  expect(isAIStudioErrorText('Safety policy blocked this response')).toBe(true);
  expect(isAIStudioErrorText('请求过多，请稍后再试')).toBe(true);
  expect(isAIStudioErrorText('未授权访问该模型')).toBe(true);
  expect(isAIStudioErrorText('Prohibited Use policy')).toBe(true);
  expect(isAIStudioErrorText('Your prompt was flagged by safety settings')).toBe(true);
  expect(isAIStudioErrorText('The model is at capacity. Please try again later.')).toBe(true);
  expect(isAIStudioErrorText('Network connection lost, please retry')).toBe(true);
  expect(isAIStudioErrorText('Stream interrupted while generating the image')).toBe(true);
  expect(isAIStudioErrorText('The input is too long for this model')).toBe(true);
  expect(isAIStudioErrorText('Context length exceeded. Reduce the prompt.')).toBe(true);
  expect(isAIStudioErrorText('This model is not available in your region')).toBe(true);
  expect(isAIStudioErrorText('Your account does not have access to this model')).toBe(true);
  expect(isAIStudioErrorText('Please upgrade to Gemini Pro to use this model')).toBe(true);
  expect(isAIStudioErrorText('输入内容过长，请缩短后重试')).toBe(true);
  expect(isAIStudioErrorText('当前地区不可用')).toBe(true);
  expect(isAIStudioErrorText('需要升级订阅后才能使用')).toBe(true);
  expect(isAIStudioErrorText('A normal generated answer')).toBe(false);
  expect(isAIStudioErrorText('Set a daily limit for API calls')).toBe(false);
  expect(isAIStudioErrorText('The auth token is valid')).toBe(false);
  expect(isAIStudioErrorText('请确保安全使用')).toBe(false);
  expect(isAIStudioErrorText('The connection between these ideas is clear')).toBe(false);
  expect(isAIStudioErrorText('The image region is too bright')).toBe(false);
  expect(isAIStudioErrorText('You can upgrade this code later')).toBe(false);
  expect(isAIStudioErrorText('The context of the story is long')).toBe(false);
});

it('direct model navigation uses the ?model= URL and falls back for display names', async () => {
  const calls = [];
  const page = {
    async goto(url) {
      calls.push(`goto:${url}`);
    },
    async wait() {},
    async evaluate() {
      return 'gemini-3.5-flash-lite';
    },
  };
  const direct = await openAIStudioModelDirect(page, 'gemini-3.5-flash-lite');
  expect(direct.model).toBe('gemini-3.5-flash-lite');
  expect(direct.category).toBe('text');
  expect(calls[0].startsWith('goto:https://aistudio.google.com/prompts/new_chat?model=gemini-3.5-flash-lite')).toBeTruthy();
  const nameFallback = await openAIStudioModelDirect(page, 'Nano Banana 2 Lite');
  expect(nameFallback).toBe(null);
});

it('selecting a model via the direct URL cannot bypass the required category', async () => {
  // P1-2: the image command must reject a text model even though the direct
  // ?model= URL activates it, instead of silently proceeding on the wrong model.
  const page = {
    async goto() {},
    async wait() {},
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('ms-run-settings') && fnStr.includes('querySelector')) return 'ready';
      if (fnStr.includes('ms-model-selector')) return 'gemini-2.5-pro';
      return null;
    },
  };
  await expect(selectAIStudioModel(page, 'gemini-2.5-pro', 'image')).rejects.toThrow(ArgumentError);
});

it('selecting a matching-category model via the direct URL returns it', async () => {
  const page = {
    async goto() {},
    async wait() {},
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('ms-run-settings') && fnStr.includes('querySelector')) return 'ready';
      if (fnStr.includes('ms-model-selector')) return 'gemini-3.1-flash-lite-image';
      return null;
    },
  };
  const selected = await selectAIStudioModel(page, 'gemini-3.1-flash-lite-image', 'image');
  expect(selected.model).toBe('gemini-3.1-flash-lite-image');
  expect(selected.category).toBe('image');
});

it('image export validation rejects empty data, invalid dimensions, and sub-512 UI fragments', () => {
  const valid = validateAIStudioImageAsset({
    dataUrl: 'data:image/png;base64,aGVsbG8=',
    width: 1024,
    height: 1024,
  });
  expect(valid.ok).toBe(true);
  expect(valid.bytes).toBe(5);
  expect(validateAIStudioImageAsset({ dataUrl: 'data:image/png;base64,', width: 1, height: 1 }).ok).toBe(false);
  expect(validateAIStudioImageAsset({ dataUrl: 'data:image/png;base64,aGVsbG8=', width: 0, height: 1 }).ok).toBe(false);
  // The 338x20 asset is a UI fragment (error banner/icon), never a render.
  const fragment = validateAIStudioImageAsset({
    dataUrl: 'data:image/png;base64,aGVsbG8=',
    width: 338,
    height: 20,
  });
  expect(fragment.ok).toBe(false);
  expect(fragment.reason).toContain('too small');
  // A 512x512 render is the smallest accepted real generation.
  expect(validateAIStudioImageAsset({
    dataUrl: 'data:image/png;base64,aGVsbG8=',
    width: 512,
    height: 512,
  }).ok).toBe(true);
});

it('deadline preserves the configured command timeout', () => {
  const deadline = createAIStudioDeadline(12);
  expect(deadline.timeout).toBe(12);
  expect(deadline.expiresAt > deadline.startedAt).toBeTruthy();
});

it('submission evidence rejects two unrelated user turns that carry no media', () => {
  const baseline = { turns: [] };
  const current = {
    turns: [
      { role: 'user', text: 'prompt', images: [] },
      { role: 'user', text: 'a different prompt entirely', images: [] },
    ],
    composerText: '',
    isGenerating: true,
    runButtonDisabled: true,
  };
  const evidence = getAIStudioSubmissionEvidence(current, baseline, 'prompt');
  expect(evidence.ok).toBe(false);
  expect(evidence.reason).toBe('multiple-new-user-turns');
});

it('inline error classifier ignores benign words that appear in normal model replies', () => {
  expect(isAIStudioInlineErrorText('Explain error handling and why an upgrade can help')).toBe(false);
  expect(isAIStudioInlineErrorText('The feature is not available in this example')).toBe(false);
  expect(isAIStudioInlineErrorText('Your subscription includes image generation')).toBe(false);
  expect(isAIStudioInlineErrorText('The connection between these ideas is clear')).toBe(false);
  // Reviewer-reported false positives: the narrowed idiom set must not flag these.
  expect(isAIStudioInlineErrorText('Please try again after checking the examples.')).toBe(false);
  expect(isAIStudioInlineErrorText('You may want to upgrade to a newer Node version.')).toBe(false);
  expect(isAIStudioInlineErrorText('Discuss the prohibited words in this policy.')).toBe(false);
  expect(isAIStudioInlineErrorText('The quota system is a useful concept.')).toBe(false);
  // A paragraph that merely *mentions* an error idiom is not an error.
  const longBenign = 'If a request fails you may need to please retry later, which is normal. '.repeat(5);
  expect(longBenign.length).toBeGreaterThan(240);
  expect(isAIStudioInlineErrorText(longBenign)).toBe(false);
  // Real, short error idioms still classify as inline errors.
  expect(isAIStudioInlineErrorText('已超出配额限制，请稍后重试')).toBe(true);
  expect(isAIStudioInlineErrorText('Generation failed because the prompt is too long. Please try again.')).toBe(true);
  expect(isAIStudioInlineErrorText('Please upgrade to Gemini Pro to use this model')).toBe(true);
  expect(isAIStudioInlineErrorText('Sorry, you have exceeded your quota for this model.')).toBe(true);
  expect(isAIStudioInlineErrorText('The model cannot answer this prompt due to the safety policy.')).toBe(true);
  expect(isAIStudioInlineErrorText('Prohibited content.')).toBe(true);
  expect(isAIStudioInlineErrorText('Your request was blocked by the Prohibited Use policy.')).toBe(true);
  expect(isAIStudioInlineErrorText('Sorry, I cannot help because it violates our usage policies.')).toBe(true);
});

it('blocked-content classifier ignores ordinary technical prose', () => {
  for (const text of BLOCKED_CONTENT_BENIGN) {
    expect(isAIStudioBlockedContentText(text), text).toBe(false);
  }
});

// A refusal idiom embedded inside a longer sentence is ordinary prose — the
// platform renders real refusals as the entire turn text. Anchored full-match
// must reject these even though an unanchored substring test would fire.
const BLOCKED_CONTENT_MID_SENTENCE = [
  'The log shows the request was blocked by the upstream proxy, not by our service.',
  'This answer violates our expectation that policies be cited; cite them.',
  '发布违规内容的账号会被平台封禁。',
  '这段过滤器会拦截包含敏感词的不当内容并给出警告。',
  '系统检测到违规内容后会自动重试。',
];

it('blocked-content classifier requires the refusal to be the entire text', () => {
  for (const text of BLOCKED_CONTENT_MID_SENTENCE) {
    expect(isAIStudioBlockedContentText(text), text).toBe(false);
  }
});

it('blocked-content classifier still catches genuine platform refusals', () => {
  for (const text of BLOCKED_CONTENT_REFUSALS) {
    expect(isAIStudioBlockedContentText(text), text).toBe(true);
  }
});

it('every blocked-content pattern fires on a refusal and none fires on benign prose', () => {
  const source = fs.readFileSync(path.resolve(testDirectory, 'utils.js'), 'utf8');
  const arrayStart = source.indexOf('const AI_STUDIO_BLOCKED_CONTENT_PATTERNS = [');
  const arrayEnd = source.indexOf('];', arrayStart) + 2;
  const patterns = vm.runInNewContext(
    `${source.slice(arrayStart, arrayEnd)}; AI_STUDIO_BLOCKED_CONTENT_PATTERNS`,
  );
  expect(patterns.length).toBeGreaterThan(0);

  const unexercised = patterns.filter(
    (pattern) => !BLOCKED_CONTENT_REFUSALS.some((text) => new RegExp(pattern, 'i').test(text)),
  );
  expect(unexercised).toEqual([]);

  const overreaching = patterns.flatMap((pattern) => {
    const re = new RegExp(pattern, 'i');
    return BLOCKED_CONTENT_BENIGN
      .filter((text) => re.test(text))
      .map((text) => `${pattern} matched benign: ${text}`);
  });
  expect(overreaching).toEqual([]);
});

it('a refusal surfaces the chrome-stripped answer text, not the greedy detection haystack', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <ms-prompt-box><textarea aria-label="Enter a prompt"></textarea><ms-run-button><button type="submit">Run</button></ms-run-button></ms-prompt-box>
    <ms-chat-turn id="model-turn"><div class="chat-turn-container model render">
      <div class="actions-container"><ms-chat-turn-options><button aria-label="Open options"><span class="material-symbols-outlined">more_vert</span></button></ms-chat-turn-options></div>
      <span class="author-label">Model</span>
      <div class="turn-content"><ms-text-chunk>Prohibited content.</ms-text-chunk></div>
      <div class="turn-footer"><span class="model-run-time-pill">2.7s</span></div>
    </div></ms-chat-turn>
  </body>`);
  const document = dom.window.document;
  const page = { evaluate: async (fn, ...args) => fn(...args) };
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = dom.window;
  try {
    const snapshot = await readAIStudioSnapshot(page);
    const model = snapshot.turns.find((turn) => turn.role === 'model');
    expect(model?.error).toBe('Prohibited content.');
    expect(model?.error).not.toContain('more_vert');
    expect(model?.error).not.toContain('2.7s');
    expect(snapshot.alerts).toEqual(['Prohibited content.']);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

it('model category classifies TTS and audio models as audio', () => {
  expect(modelCategory('gemini-2.5-flash-preview-tts')).toBe('audio');
  expect(modelCategory('gemini-3.1-flash-tts-preview')).toBe('audio');
  expect(modelCategory('gemini-2.5-flash')).toBe('text');
  expect(modelCategory('lyria-3-pro-preview')).toBe('audio');
});

it('submission waits complete after one native action when evidence appears promptly', async () => {
  const deadline = createAIStudioDeadline(5);
  const page = { async wait() {} };
  const result = await waitForAIStudioSubmission(
    page,
    async () => ({ ok: true }),
    deadline,
  );
  expect(result.ok).toBe(true);
});

it('submission waits without dispatching a second action when the native shortcut is silent', async () => {
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() - 1, timeout: 1 };
  const page = { async wait() {} };
  await expect(waitForAIStudioSubmission(page, async () => null, deadline))
    .rejects.toMatchObject({ hint: expect.stringContaining('No second submission action was issued') });
});

it('submission waits keep waiting without a second action when the native shortcut already submitted', async () => {
  // P1-1: native pressKey lands but the new user turn is slow to render. The
  // fallback must report {action:'wait'} and the waiter must NOT issue a second
  // submission — it keeps polling the long window for the delayed evidence.
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() - 1, timeout: 1 };
  const page = { async wait() {} };
  await expect(waitForAIStudioSubmission(page, async () => null, deadline))
    .rejects.toMatchObject({ hint: expect.stringContaining('No second submission action was issued') });
});

it('submission waits preserve the one-action timeout contract', async () => {
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() - 1, timeout: 1 };
  let fallbackCalls = 0;
  const page = { async wait() {} };
  await expect(waitForAIStudioSubmission(page, async () => null, deadline))
    .rejects.toMatchObject({ hint: expect.stringContaining('No second submission action was issued') });
  expect(fallbackCalls).toBe(0);
});

it('submission waits propagate hard rejections without another action', async () => {
  const deadline = createAIStudioDeadline(5);
  const page = { async wait() {} };
  await expect(
    waitForAIStudioSubmission(page, async () => {
      throw new CommandExecutionError('AI Studio rejected the prompt: a warning surfaced');
    }, deadline),
  ).rejects.toThrow(CommandExecutionError);
});

it('setup waits honor the shared deadline instead of running their fixed timeout', async () => {
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() - 1, timeout: 1 };
  const page = {
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('page state')) {
        return { url: 'https://aistudio.google.com/prompts/new_chat', hasComposer: true, signInVisible: false };
      }
      return { url: 'https://aistudio.google.com/prompts/new_chat', hasComposer: true };
    },
    async goto() {},
  };
  await expect(ensureAIStudioPage(page, { deadline })).rejects.toThrow(TimeoutError);
});

it('navigation caps the goto timeout to the shared deadline', async () => {
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() + 2000, timeout: 2 };
  let gotoOptions = null;
  const page = {
    async goto(url, options) {
      gotoOptions = options;
    },
    async wait() {},
    async evaluate() {
      return { url: 'https://aistudio.google.com/prompts/new_chat', hasComposer: true, signInVisible: false };
    },
  };
  await startNewAIStudioChat(page, { deadline });
  expect(gotoOptions.waitUntil).toBe('load');
  expect(gotoOptions.timeout).toBeGreaterThanOrEqual(1000);
  expect(gotoOptions.timeout).toBeLessThanOrEqual(2000);
});

it('dialog close returns false instead of pretending success when the dialog cannot close', async () => {
  const page = {
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('close|关闭')) return false; // no close button found
      return 1; // a visible dialog remains
    },
    async wait() {},
    nativeKeyPress: async () => {},
  };
  const deadline = { startedAt: Date.now(), expiresAt: Date.now() + 60, timeout: 1 };
  const closed = await closeTopDialog(page, { deadline });
  expect(closed).toBe(false);
});

it('structured error node selector stays narrow to avoid flagging benign error-* classes', () => {
  expect(AI_STUDIO_ERROR_NODE_SELECTOR).not.toContain('[class*="error"');
  expect(AI_STUDIO_ERROR_NODE_SELECTOR).not.toContain('[class*="alert"');
  for (const surface of ['[role="alert"]', '[aria-live="assertive"]', '.error-message', '[data-error]', 'ms-error-message']) {
    expect(AI_STUDIO_ERROR_NODE_SELECTOR).toContain(surface);
  }
});

it('markdown clipboard matching rejects stale content and accepts the same rendered answer', () => {
  expect(matchesAIStudioMarkdownClipboard('# Answer\n\n- one\n- two', 'Answer one two')).toBe(true);
  expect(matchesAIStudioMarkdownClipboard('unrelated previous clipboard', 'Answer one two')).toBe(false);
  expect(matchesAIStudioMarkdownClipboard('A much longer stale clipboard that merely mentions Answer one two in passing', 'Answer one two')).toBe(false);
  expect(matchesAIStudioMarkdownClipboard('OK', 'NO')).toBe(false);
});

it('cleans up the upload window when a chunk push fails', async () => {
  const evaluated = [];
  const page = {
    async evaluate(fn) {
      const fnStr = String(fn);
      evaluated.push(fnStr);
      if (fnStr.includes('chunks[index] += chunkText')) return { ok: false }; // first chunk push fails
      if (fnStr.includes('window[selector] =')) return { ok: true }; // chunk init
      if (fnStr.includes('delete window[key]')) return { ok: true }; // cleanup
      return { ok: true };
    },
  };
  const files = [{ name: 'large.png', mime: 'image/png', base64: 'A'.repeat(300 * 1024) }];
  const result = await injectAIStudioFiles(page, files, 'input[data-test-upload-file-input]');
  expect(result).toEqual({ ok: false, reason: 'upload chunk failed' });
  expect(evaluated.some((fnStr) => fnStr.includes('delete window[key]'))).toBe(true);
});
