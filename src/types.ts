/**
 * Page interface: type-safe abstraction over Playwright MCP browser page.
 *
 * All pipeline steps and CLI adapters should use this interface
 * instead of `any` for browser interactions.
 */

export interface IPage {
  goto(url: string): Promise<void>;
  evaluate(js: string): Promise<any>;
  snapshot(opts?: { interactive?: boolean; compact?: boolean; maxDepth?: number; raw?: boolean }): Promise<any>;
  click(ref: string): Promise<void>;
  typeText(ref: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  wait(seconds: number): Promise<void>;
  tabs(): Promise<any>;
  closeTab(index?: number): Promise<void>;
  newTab(): Promise<void>;
  selectTab(index: number): Promise<void>;
  networkRequests(includeStatic?: boolean): Promise<any>;
  consoleMessages(level?: string): Promise<any>;
  scroll(direction?: string, amount?: number): Promise<void>;
}
