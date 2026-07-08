import { vi } from 'vitest';

/**
 * Create a page mock with all standard browser automation methods.
 *
 * @param {any[]} evaluateResults - Sequential results for page.evaluate() calls
 * @param {Record<string, any>} [overrides] - Override or add mock methods
 * @returns A mock page object compatible with OpenCLI's browser page interface
 */
export function createPageMock(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        // Navigation
        goto: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        closeTab: vi.fn().mockResolvedValue(undefined),
        newTab: vi.fn().mockResolvedValue(undefined),

        // Content extraction
        evaluate,
        snapshot: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),

        // User interaction
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        setFileInput: vi.fn().mockResolvedValue(undefined),

        // Form handling
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),

        // Monitoring
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),

        // Request interception
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),

        // Network capture
        startNetworkCapture: vi.fn().mockResolvedValue(undefined),
        readNetworkCapture: vi.fn().mockResolvedValue([]),

        // Auth
        getCookies: vi.fn().mockResolvedValue([]),

        // Wait
        wait: vi.fn().mockResolvedValue(undefined),

        ...overrides,
    };
}
