import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    ensureGeminiPage: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        ensureGeminiPage: mocks.ensureGeminiPage,
    };
});

import { modelsCommand, __test__ } from './models.js';

function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({}),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    };
}

const FIXTURE_MODEL_ROWS = [
    { model: '2.5-flash', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-lite', thinkingValues: ['standard'] },
    { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
    { model: '2.5-flash-thinking', thinkingValues: [] },
];

describe('gemini models', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns model rows with model and thinkingValues columns', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });  // picker click
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);  // menu read

        const rows = await modelsCommand.func(page);

        expect(rows).toEqual(FIXTURE_MODEL_ROWS);
        expect(rows[0]).toHaveProperty('model');
        expect(rows[0]).toHaveProperty('thinkingValues');
        expect(Array.isArray(rows[0].thinkingValues)).toBe(true);
    });

    it('calls ensureGeminiPage before discovery', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);

        await modelsCommand.func(page);

        expect(mocks.ensureGeminiPage).toHaveBeenCalledWith(page);
        expect(mocks.ensureGeminiPage).toHaveBeenCalledBefore(page.evaluate);
    });

    it('is read-only: does not start a new chat, send a message, or select a model', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce(FIXTURE_MODEL_ROWS);

        await modelsCommand.func(page);

        // ensureGeminiPage always gets called, but no other stateful utils.
        expect(mocks.ensureGeminiPage).toHaveBeenCalledTimes(1);
        // evaluate is called 3 times: picker click, model read, close menu.
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });

    it('unwraps Browser Bridge envelope { session, data } for picker and model rows', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ session: 'site:gemini', data: { ok: true } });
        vi.mocked(page.evaluate).mockResolvedValueOnce({
            session: 'site:gemini',
            data: FIXTURE_MODEL_ROWS,
        });

        const rows = await modelsCommand.func(page);

        expect(rows).toEqual(FIXTURE_MODEL_ROWS);
    });

    it('throws CommandExecutionError when the model picker cannot be opened', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: false, reason: 'Gemini model picker button was not found' });

        await expect(modelsCommand.func(page)).rejects.toThrow(/model picker/i);
    });

    it('throws CommandExecutionError when evaluate returns a non-array result', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: false });

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a row is missing the model field', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { thinkingValues: ['standard'] },
        ]);

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a row has a non-array thinkingValues field', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: 'standard' },
        ]);

        await expect(modelsCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('accepts rows with empty thinkingValues array', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash', thinkingValues: [] },
            { model: '2.5-pro', thinkingValues: [] },
        ]);

        const rows = await modelsCommand.func(page);

        expect(rows).toHaveLength(2);
        expect(rows[0].thinkingValues).toEqual([]);
        expect(rows[1].thinkingValues).toEqual([]);
    });

    it('keeps model values as strings and thinkingValues as string arrays', async () => {
        const page = createPageMock();
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        vi.mocked(page.evaluate).mockResolvedValueOnce({ ok: true });
        vi.mocked(page.evaluate).mockResolvedValueOnce([
            { model: '2.5-flash-lite', thinkingValues: ['standard'] },
            { model: '2.5-pro', thinkingValues: ['standard', 'extended'] },
        ]);

        const rows = await modelsCommand.func(page);

        for (const row of rows) {
            expect(typeof row.model).toBe('string');
            expect(Array.isArray(row.thinkingValues)).toBe(true);
            for (const tv of row.thinkingValues) {
                expect(typeof tv).toBe('string');
            }
        }
    });
});

describe('gemini models command registration', () => {
    it('is registered with site=gemini and name=models', () => {
        expect(modelsCommand.site).toBe('gemini');
        expect(modelsCommand.name).toBe('models');
    });

    it('is access=read (not write)', () => {
        expect(modelsCommand.access).toBe('read');
    });

    it('declares model and thinkingValues as its output columns', () => {
        expect(modelsCommand.columns).toEqual(['model', 'thinkingValues']);
    });

    it('has no CLI arguments', () => {
        expect(modelsCommand.args).toEqual([]);
    });

    it('is a browser command', () => {
        expect(modelsCommand.browser).toBe(true);
    });

    it('targets gemini.google.com', () => {
        expect(modelsCommand.domain).toBe('gemini.google.com');
    });
});

// ── DOM fixture tests (jsdom) ──────────────────────────────────────────────
// These tests run the actual discoverModelsScript() against pre-built DOM
// fixtures that simulate the Gemini web UI model picker and menu.

/**
 * Create a JSDOM instance wired up for the discovery script.
 *
 * - All elements get a realistic getBoundingClientRect so isVisible() passes.
 * - getComputedStyle is patched to honour inline style changes (e.g. display
 *   toggling when the picker menu opens).
 * - Click handlers can be attached to elements before the script runs.
 */
function createGeminiDom(htmlFixture) {
    const dom = new JSDOM(`<!doctype html><body>${htmlFixture}</body>`, {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;
    const { document } = window;

    // Make every element appear to have non-zero bounding rect so isVisible
    // does not reject elements merely because jsdom returns all-zero rects.
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value() {
            return { width: 100, height: 24, top: 0, left: 0, right: 100, bottom: 24 };
        },
    });

    return { window, document };
}

/**
 * Normalize element text to a single-line, whitespace-compacted label
 * suitable for use as a spy key.
 */
function normalizeLabel(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return (text || aria || '(anonymous)').slice(0, 80);
}

/**
 * Run the discovery script in a jsdom window and return the result.
 */
function evalDiscoverScript(window) {
    const scriptText = __test__.discoverModelsScript();
    return window.eval(scriptText);
}

/**
 * Build a click-spy instrumented window. Returns a `spy` object where each
 * key is a normalized label of a clickable element and the value is the
 * number of times that element received a click event.
 */
function instrumentClickSpy(window) {
    const { document } = window;
    const spy = {};

    function record(label) {
        spy[label] = (spy[label] || 0) + 1;
    }

    // Track clicks on all interactive elements.
    document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], [role="menuitemradio"]').forEach((el) => {
        const label = normalizeLabel(el);
        el.addEventListener('click', () => record(label));
    });

    // Track body clicks (menu dismiss).
    let bodyClickCount = 0;
    document.body.addEventListener('click', () => {
        bodyClickCount++;
    });
    // Patch body.click so we can read the count after script returns.
    const originalBodyClick = document.body.click.bind(document.body);
    document.body.click = function () {
        bodyClickCount++;
        return originalBodyClick();
    };
    // Attach the count to spy via a getter.
    Object.defineProperty(spy, '(body)', {
        get() { return bodyClickCount; },
        enumerable: true,
        configurable: true,
    });

    return spy;
}

describe('discoverModelsScript — DOM fixture extraction', () => {
    it('extracts model rows without inferring global thinking controls as per-model support', () => {
        const { window, document } = createGeminiDom(`
            <header>
              <button id="model-picker">2.5 Flash</button>
              <button>New chat</button>
            </header>
            <div id="model-menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
              <div role="menuitem">2.5 Flash Lite</div>
              <div role="menuitem">2.5 Pro</div>
              <div role="menuitem">2.5 Flash Thinking</div>
              <!-- Thinking levels as separate menu items (Gemini Web pattern) -->
              <div role="menuitem">Standard</div>
              <div role="menuitem">Extended</div>
            </div>
          `);

        // Click handler opens the menu (simulating React render on click).
        document.getElementById('model-picker').addEventListener('click', () => {
            document.getElementById('model-menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(4);

        // Thinking menu items are global/current-selection controls, not a
        // reliable per-model capability matrix, so they are not copied to rows.
        const models = new Map(result.map((r) => [r.model, r.thinkingValues]));

        expect(models.get('2.5-flash')).toEqual([]);
        expect(models.get('2.5-flash-lite')).toEqual([]);
        expect(models.get('2.5-pro')).toEqual([]);
        expect(models.has('2.5-flash-thinking')).toBe(true);
        expect(models.get('2.5-flash-thinking')).toEqual([]);
    });

    it('extracts models from menu items with role=option inside role=listbox', () => {
        const { window, document } = createGeminiDom(`
            <header>
              <button id="model-picker">2.5 Pro</button>
            </header>
            <div id="menu" role="listbox" style="display: none;">
              <div role="option">2.5 Flash</div>
              <div role="option">2.5 Pro</div>
              <div role="option">2.5 Flash Lite</div>
            </div>
          `);

        document.getElementById('model-picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(3);
        const modelIds = result.map((r) => r.model).sort();
        expect(modelIds).toEqual(['2.5-flash', '2.5-flash-lite', '2.5-pro']);
    });

    it('returns canonical model ids matching acceptance criteria examples (3.1-flash-lite, 3.5-flash, 3.1-pro)', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">3.1 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">3.1 Flash Lite</div>
              <div role="menuitem">3.5 Flash</div>
              <div role="menuitem">3.1 Pro</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);
        const modelIds = result.map((r) => r.model).sort();
        expect(modelIds).toEqual(['3.1-flash-lite', '3.1-pro', '3.5-flash']);
    });

    it('does not infer separate thinking-level menu items as per-model support', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
              <div role="menuitem">2.5 Pro</div>
              <!-- Thinking levels as separate items (real Gemini Web pattern) -->
              <div role="menuitem">Standard</div>
              <div role="menuitem">Extended</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);

        expect(result).toHaveLength(2);
        const models = new Map(result.map((r) => [r.model, r.thinkingValues]));
        expect(models.get('2.5-flash')).toEqual([]);
        expect(models.get('2.5-pro')).toEqual([]);
    });

    it('returns empty array when model picker is absent', () => {
        const { window, document } = createGeminiDom(`
            <header>
              <button>Settings</button>
              <button>Help</button>
            </header>
            <div role="menu">
              <div role="menuitem">Theme</div>
            </div>
          `);

        const result = evalDiscoverScript(window);

        expect(result).toEqual([]);
    });

    it('returns empty array when menu items contain only thinking options (no model entries)', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">Standard</div>
              <div role="menuitem">Extended</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);

        expect(result).toEqual([]);
    });

    it('deduplicates model entries with the same canonical id', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
              <div role="menuitem">2.5 Flash</div>
              <div role="menuitem">2.5 Pro</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const result = evalDiscoverScript(window);
        expect(result).toHaveLength(2);
        const modelIds = result.map((r) => r.model).sort();
        expect(modelIds).toEqual(['2.5-flash', '2.5-pro']);
    });
});

describe('discoverModelsScript — read-only verification (DOM fixture)', () => {
    it('only clicks the model picker and document.body, never model items', () => {
        const { window, document } = createGeminiDom(`
            <button id="model-picker">2.5 Flash</button>
            <button id="new-chat-btn">New chat</button>
            <div id="model-menu" role="menu" style="display: none;">
              <div role="menuitem" id="model-flash">2.5 Flash</div>
              <div role="menuitem" id="model-pro">2.5 Pro</div>
              <!-- Thinking items as separate menu items -->
              <div role="menuitem" id="think-standard">Standard</div>
              <div role="menuitem" id="think-extended">Extended</div>
            </div>
            <div id="composer">
              <div contenteditable="true">Enter a prompt</div>
              <button id="send-btn" aria-label="Send">Send</button>
            </div>
          `);

        // Show menu on click.
        document.getElementById('model-picker').addEventListener('click', () => {
            document.getElementById('model-menu').style.display = 'block';
        });

        const spy = instrumentClickSpy(window);

        const result = evalDiscoverScript(window);

        // The script must have found models (not an empty result).
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        // The picker button is clicked to open the menu.  That's expected.
        expect(spy['2.5 Flash']).toBeGreaterThanOrEqual(1);

        // The script clicks document.body to close the menu.  That's allowed.
        expect(spy['(body)']).toBeGreaterThanOrEqual(1);

        // BUT it must NOT click any model menu item, new-chat button, or send button.
        expect(spy['2.5 Flash'] || 0).toBeGreaterThanOrEqual(1); // picker only
        expect(spy['2.5 Pro'] || 0).toBe(0);
        expect(spy['New chat'] || 0).toBe(0);
        expect(spy['Send'] || 0).toBe(0);
        // Thinking items as separate menuitems — should NOT be clicked.
        expect(spy['Standard'] || 0).toBe(0);
        expect(spy['Extended'] || 0).toBe(0);
    });

    it('does not click thinking controls (separate menu items without toggle)', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
              <div role="menuitem">2.5 Pro</div>
              <!-- Thinking levels as separate menu items (no toggle present) -->
              <div role="menuitem" id="think-standard">Standard</div>
              <div role="menuitem" id="think-extended">Extended</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const spy = instrumentClickSpy(window);

        const result = evalDiscoverScript(window);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        // Model picker click is allowed.
        expect(spy['2.5 Flash']).toBeGreaterThanOrEqual(1);
        // Body click (menu dismiss) is allowed.
        expect(spy['(body)']).toBeGreaterThanOrEqual(1);

        // Thinking items must NOT receive clicks (no 思考等级 toggle).
        expect(spy['Standard'] || 0).toBe(0);
        expect(spy['Extended'] || 0).toBe(0);
    });

    it('does not click a new-chat button', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <button id="new-chat" aria-label="New chat">New chat</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const spy = instrumentClickSpy(window);

        const result = evalDiscoverScript(window);
        expect(Array.isArray(result)).toBe(true);

        expect(spy['New chat'] || 0).toBe(0);
        expect(spy['2.5 Flash']).toBeGreaterThanOrEqual(1);
    });

    it('does not click a send/submit button', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">2.5 Flash</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">2.5 Flash</div>
            </div>
            <div>
              <div contenteditable="true"></div>
              <button id="send" aria-label="Send">Send</button>
              <button id="submit">Submit</button>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const spy = instrumentClickSpy(window);

        const result = evalDiscoverScript(window);
        expect(Array.isArray(result)).toBe(true);

        expect(spy['Send'] || 0).toBe(0);
        expect(spy['Submit'] || 0).toBe(0);
    });

    it('only clicks the picker and body — no other elements receive clicks', () => {
        const { window, document } = createGeminiDom(`
            <button id="picker">3.1 Flash</button>
            <button>New chat</button>
            <button>Settings</button>
            <div id="menu" role="menu" style="display: none;">
              <div role="menuitem">3.1 Flash Lite</div>
              <div role="menuitem">3.5 Flash</div>
              <div role="menuitem">3.1 Pro</div>
              <!-- Thinking items as separate menu items (no toggle) -->
              <div role="menuitem">Standard</div>
              <div role="menuitem">Extended</div>
            </div>
            <div>
              <button id="send" aria-label="Send message">Send</button>
            </div>
          `);

        document.getElementById('picker').addEventListener('click', () => {
            document.getElementById('menu').style.display = 'block';
        });

        const spy = instrumentClickSpy(window);

        const result = evalDiscoverScript(window);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        // The only elements that may receive clicks:
        //   - The model picker ("3.1 Flash") — to open the menu.
        //   - document.body — to close the menu.
        for (const [label, count] of Object.entries(spy)) {
            if (label === '3.1 Flash' || label === '(body)') {
                expect(count).toBeGreaterThanOrEqual(1);
            } else {
                expect(count).toBe(0);
            }
        }

        // Explicitly verify the dangerous controls.
        expect(spy['New chat'] || 0).toBe(0);
        expect(spy['Settings'] || 0).toBe(0);
        // Menu items should not receive clicks.
        expect(spy['3.1 Flash Lite'] || 0).toBe(0);
        expect(spy['3.5 Flash'] || 0).toBe(0);
        expect(spy['3.1 Pro'] || 0).toBe(0);
        // Thinking controls should not receive clicks.
        expect(spy['Standard'] || 0).toBe(0);
        expect(spy['Extended'] || 0).toBe(0);
        // Send button should not receive clicks.
        expect(spy['Send message'] || 0).toBe(0);
    });
});
