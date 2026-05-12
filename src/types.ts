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
  /** Observation backend. `dom` is the stable default; `ax` is an opt-in prototype. */
  source?: 'dom' | 'ax';
}

export interface WaitOptions {
  text?: string;
  selector?: string;   // wait until document.querySelector(selector) matches
  time?: number;
  timeout?: number;
}

export interface BrowserDownloadWaitResult {
  downloaded: boolean;
  id?: number;
  filename?: string;
  url?: string;
  finalUrl?: string;
  mime?: string;
  totalBytes?: number;
  state?: string;
  danger?: string;
  error?: string;
  elapsedMs: number;
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  /** Overlay current browser-state refs on visible interactive elements. */
  annotate?: boolean;
  /** Override viewport width in CSS pixels for the screenshot only (cleared after). */
  width?: number;
  /** Override viewport height in CSS pixels for the screenshot only (ignored when fullPage). */
  height?: number;
  path?: string;
}

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export type BrowserEvaluateFunction<Args extends unknown[] = unknown[], Result = unknown> = (...args: Args) => Result | Promise<Result>;

export interface IPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void>;
  evaluate<T = any>(js: string): Promise<T>;
  evaluate<Args extends unknown[], T>(fn: BrowserEvaluateFunction<Args, T>, ...args: Args): Promise<Awaited<T>>;
  /** Safely evaluate JS with pre-serialized arguments — prevents injection. */
  evaluateWithArgs?(js: string, args: Record<string, unknown>): Promise<any>;
  /**
   * Fetch JSON from inside the browser context, carrying the page's cookies.
   * This is intentionally narrow: browser-context JSON fetch, not a generic
   * HTTP client.
   */
  fetchJson(url: string, opts?: FetchJsonOptions): Promise<unknown>;
  getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  snapshot(opts?: SnapshotOptions): Promise<any>;
  click(ref: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ matches_n: number; match_level: 'exact' | 'stable' | 'reidentified' }>;
  dblClick?(ref: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ matches_n: number; match_level: 'exact' | 'stable' | 'reidentified' }>;
  hover?(ref: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ matches_n: number; match_level: 'exact' | 'stable' | 'reidentified' }>;
  focus?(ref: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ focused: boolean; matches_n: number; match_level: 'exact' | 'stable' | 'reidentified' }>;
  setChecked?(ref: string, checked: boolean, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ checked: boolean; changed: boolean; matches_n: number; match_level: 'exact' | 'stable' | 'reidentified'; kind?: string }>;
  uploadFiles?(ref: string, files: string[], opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ uploaded: boolean; files: number; file_names: string[]; target: string; matches_n: number; match_level: 'exact' | 'stable' | 'reidentified'; multiple?: boolean; accept?: string }>;
  drag?(source: string, target: string, opts?: { from?: { nth?: number; firstOnMulti?: boolean }; to?: { nth?: number; firstOnMulti?: boolean } }): Promise<{ dragged: boolean; source: string; target: string; source_matches_n: number; target_matches_n: number; source_match_level: 'exact' | 'stable' | 'reidentified'; target_match_level: 'exact' | 'stable' | 'reidentified' }>;
  typeText(ref: string, text: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{ matches_n: number; match_level: 'exact' | 'stable' | 'reidentified' }>;
  fillText(ref: string, text: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<{
    filled: boolean;
    verified: boolean;
    expected: string;
    actual: string;
    length: number;
    matches_n: number;
    match_level: 'exact' | 'stable' | 'reidentified';
    mode?: 'input' | 'textarea' | 'contenteditable';
  }>;
  pressKey(key: string): Promise<void>;
  scrollTo(ref: string, opts?: { nth?: number; firstOnMulti?: boolean }): Promise<any>;
  getFormState(): Promise<any>;
  wait(options: number | WaitOptions): Promise<void>;
  waitForDownload?(pattern?: string, timeoutMs?: number): Promise<BrowserDownloadWaitResult>;
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
  annotatedScreenshot?(options?: ScreenshotOptions): Promise<string>;
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
  /** Send a raw CDP command via chrome.debugger passthrough. */
  cdp?(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Accept or dismiss the currently open JavaScript alert/confirm/prompt dialog. */
  handleJavaScriptDialog?(accept: boolean, promptText?: string): Promise<void>;
  /** List cross-origin iframe targets in snapshot order. */
  frames?(): Promise<Array<{ index: number; frameId: string; url: string; name: string }>>;
  /** Evaluate JavaScript inside a cross-origin iframe identified by its frame index. */
  evaluateInFrame?(js: string, frameIndex: number): Promise<unknown>;
  /** Click at native coordinates via CDP Input.dispatchMouseEvent. */
  nativeClick?(x: number, y: number): Promise<void>;
  /** Type text via CDP Input.insertText. */
  nativeType?(text: string): Promise<void>;
  /** Press a key via CDP Input.dispatchKeyEvent. */
  nativeKeyPress?(key: string, modifiers?: string[]): Promise<void>;
}
