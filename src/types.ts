/**
 * Page interface: type-safe abstraction over browser page.
 *
 * All pipeline steps and CLI adapters should use this interface
 * instead of `any` for browser interactions.
 */

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
}

export interface SnapshotOptions {
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
  raw?: boolean;
  viewportExpand?: number;
  maxTextLength?: number;
}

export interface WaitOptions {
  text?: string;
  selector?: string;   // wait until document.querySelector(selector) matches
  time?: number;
  timeout?: number;
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  path?: string;
}

export interface BrowserSessionInfo {
  workspace?: string;
  connected?: boolean;
  [key: string]: unknown;
}

export interface IPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void>;
  evaluate(js: string): Promise<any>;
  /** Safely evaluate JS with pre-serialized arguments — prevents injection. */
  evaluateWithArgs?(js: string, args: Record<string, unknown>): Promise<any>;
  getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  snapshot(opts?: SnapshotOptions): Promise<any>;
  click(ref: string): Promise<void>;
  typeText(ref: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scrollTo(ref: string): Promise<any>;
  getFormState(): Promise<any>;
  wait(options: number | WaitOptions): Promise<void>;
  tabs(): Promise<any>;
  closeTab?(target?: number | string): Promise<void>;
  newTab?(url?: string): Promise<string | undefined>;
  selectTab(target: number | string): Promise<void>;
  networkRequests(includeStatic?: boolean): Promise<any>;
  consoleMessages(level?: string): Promise<any>;
  scroll(direction?: string, amount?: number): Promise<void>;
  autoScroll(options?: { times?: number; delayMs?: number }): Promise<void>;
  installInterceptor(pattern: string): Promise<void>;
  getInterceptedRequests(): Promise<any[]>;
  waitForCapture(timeout?: number): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<string>;
  startNetworkCapture?(pattern?: string): Promise<boolean>;
  readNetworkCapture?(): Promise<unknown[]>;
  /**
   * Set local file paths on a file input element via CDP DOM.setFileInputFiles.
   * Chrome reads the files directly — no base64 encoding or payload size limits.
   */
  setFileInput?(files: string[], selector?: string): Promise<void>;
  /**
   * Insert text via native CDP Input.insertText into the currently focused element.
   * Useful for rich editors that ignore synthetic DOM value/text mutations.
   */
  insertText?(text: string): Promise<void>;
  closeWindow?(): Promise<void>;
  /** Returns the current page URL, or null if unavailable. */
  getCurrentUrl?(): Promise<string | null>;
  /** Returns the active page identity (targetId), or undefined if not yet resolved. */
  getActivePage?(): string | undefined;
  /** Bind the page object to a specific page identity (targetId). */
  setActivePage?(page?: string): void;
  /** @deprecated Use getActivePage() instead */
  getActiveTabId?(): number | undefined;
  /** Send a raw CDP command via chrome.debugger passthrough. */
  cdp?(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Click at native coordinates via CDP Input.dispatchMouseEvent. */
  nativeClick?(x: number, y: number): Promise<void>;
  /** Type text via CDP Input.insertText. */
  nativeType?(text: string): Promise<void>;
  /** Press a key via CDP Input.dispatchKeyEvent. */
  nativeKeyPress?(key: string, modifiers?: string[]): Promise<void>;
}
