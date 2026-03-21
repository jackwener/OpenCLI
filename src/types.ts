/**
 * Page interface: type-safe abstraction over Playwright MCP browser page.
 *
 * All pipeline steps and CLI adapters should use this interface
 * instead of `any` for browser interactions.
 */

export interface IPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void>;
  evaluate(js: string): Promise<any>;
  getCookies(opts?: { domain?: string; url?: string }): Promise<Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
  }>>;
  snapshot(opts?: {
    interactive?: boolean;
    compact?: boolean;
    maxDepth?: number;
    raw?: boolean;
    viewportExpand?: number;
    maxTextLength?: number;
  }): Promise<any>;
  click(ref: string): Promise<void>;
  typeText(ref: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scrollTo(ref: string): Promise<any>;
  getFormState(): Promise<any>;
  wait(options: number | { text?: string; time?: number; timeout?: number }): Promise<void>;
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
  screenshot(options?: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean; path?: string }): Promise<string>;
}
