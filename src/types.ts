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
  getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  snapshot(opts?: SnapshotOptions): Promise<any>;
  click(ref: string): Promise<void>;
  typeText(ref: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scrollTo(ref: string): Promise<any>;
  getFormState(): Promise<any>;
  wait(options: number | WaitOptions): Promise<void>;
  tabs(): Promise<any>;
  closeTab(index?: number): Promise<void>;
  newTab(): Promise<void>;
  selectTab(index: number): Promise<void>;
  networkRequests(includeStatic?: boolean): Promise<any>;
  consoleMessages(level?: string): Promise<any>;
  scroll(direction?: string, amount?: number): Promise<void>;
  autoScroll(options?: { times?: number; delayMs?: number }): Promise<void>;
  installInterceptor(pattern: string): Promise<void>;
  getInterceptedRequests(): Promise<any[]>;
  waitForCapture(timeout?: number): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<string>;
  /**
   * Set local file paths on a file input element via CDP DOM.setFileInputFiles.
   * Chrome reads the files directly — no base64 encoding or payload size limits.
   */
  setFileInput?(files: string[], selector?: string): Promise<void>;
  closeWindow?(): Promise<void>;
  /** Returns the current page URL, or null if unavailable. */
  getCurrentUrl?(): Promise<string | null>;
  /** Returns the active tab ID, or undefined if not yet resolved. */
  getActiveTabId?(): number | undefined;
}
