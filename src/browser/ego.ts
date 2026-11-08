import { createHash } from 'node:crypto';
import { BrowserConnectError, CommandExecutionError, ConfigError } from '../errors.js';
import type { IBrowserFactory } from '../runtime.js';
import type { BrowserCookie, BrowserEvaluateFunction, ScreenshotOptions } from '../types.js';
import { isRecord, saveBase64ToFile } from '../utils.js';
import { CDPBasePage } from './base-page.js';
import { waitForDomStableJs } from './dom-helpers.js';
import { runEgo } from './ego-transport.js';
import { buildEvaluateExpression } from './utils.js';

interface EgoTab {
  page: string;
  title: string;
  url: string;
  active: boolean;
}

const spaceScript = `
if (typeof taskSpace !== 'function') throw new Error('Ego Lite SDK with taskSpace() is required');
const task = await taskSpace(input.space);
if (task.ownership !== 'agent') {
  throw new Error('OpenCLI requires an agent-owned Ego Space');
}
`;

// Use Ego's permanent labels to operate on pages, but expose target IDs to OpenCLI.
// Looking up the ID inside the Space prevents a stale ID from reaching another tab.
const tabsScript = `
const tabs = (await task.tabs()).filter(tab => tab.label && tab.openedBy === 'agent');
const describeTab = ({ targetId, title, url, active }) => ({ page: targetId, title, url, active });
`;

const pageScript = `
const tab = tabs.find(tab => tab.targetId === input.target);
if (!tab) throw new Error('The target tab is no longer in this OpenCLI Space');
const page = task.page(tab.label);
`;

export class EgoBridge implements IBrowserFactory {
  private page?: EgoPage;

  async connect(opts: NonNullable<Parameters<IBrowserFactory['connect']>[0]> = {}): Promise<EgoPage> {
    if (this.page) throw new BrowserConnectError('EgoBridge is already connected.');
    if (!opts.session) throw new ConfigError('The Ego backend requires a browser session name.');
    if (opts.contextId) {
      throw new ConfigError('OpenCLI Chrome profile routing is unavailable in Ego mode.',
        'Select the intended profile in Ego Lite before creating an OpenCLI Space.');
    }
    if (opts.siteSession === 'persistent') {
      throw new ConfigError('Persistent adapter sessions are unavailable in Ego mode.',
        'Use --site-session ephemeral. For a reusable Space, use browser --session <name>.');
    }

    const key = `${opts.surface ?? 'browser'}:${opts.session}`;
    const suffix = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const name = `OpenCLI ${key.slice(0, 48)} ${suffix}`;
    const { spaceId, tab } = await runEgo<{ spaceId: number; tab: EgoTab }>(spaceScript + tabsScript + `
      let tab = tabs.find(tab => tab.active) ?? tabs[0];
      if (!tab) {
        const created = await task.newPage();
        tab = (await task.tabs()).find(tab => tab.label === created.label && tab.openedBy === 'agent');
      }
      if (!tab) throw new Error('Could not resolve an agent-owned Page in the Ego Space');
      return { spaceId: task.spaceId, tab: describeTab(tab) };
    `, { space: name }, opts.timeout === undefined ? undefined : opts.timeout * 1000);

    this.page = new EgoPage(opts.session, spaceId, tab.page);
    return this.page;
  }

  async close(): Promise<void> {
    await this.page?.disconnect();
    this.page = undefined;
  }
}

export class EgoPage extends CDPBasePage {
  private activePage?: string;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(readonly session: string, private readonly space: number, targetId: string) {
    super();
    this.activePage = targetId;
  }

  private run<T>(body: string, input: Record<string, unknown> = {}, target?: string): Promise<T> {
    const operation = this.pending.then(() => {
      if (this.closed) throw new CommandExecutionError('The Ego Space connection is closed.');
      return runEgo<T>(spaceScript + tabsScript + (target ? pageScript : '') + body,
        { ...input, space: this.space, target });
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  private currentTarget(): string {
    if (!this.activePage) {
      throw new CommandExecutionError('No active Page in this Ego Space. Create or select a tab first.');
    }
    return this.activePage;
  }

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void> {
    const settleMs = options?.settleMs ?? 1000;
    const waitUntil = options?.waitUntil === 'none' ? 'commit' : 'load';
    const settle = waitUntil === 'load' && settleMs > 0
      ? waitForDomStableJs(settleMs, Math.min(500, settleMs)) : undefined;
    await this.run(`
      if (await page.url() !== input.url) await page.goto(input.url, { waitUntil: input.waitUntil });
      if (input.settle) await page.evaluate(input.settle);
    `, { url, waitUntil, settle }, this.currentTarget());
  }

  async evaluate<T = unknown>(js: string): Promise<T>;
  async evaluate<Args extends unknown[], T>(fn: BrowserEvaluateFunction<Args, T>, ...args: Args): Promise<Awaited<T>>;
  async evaluate(input: string | BrowserEvaluateFunction<unknown[], unknown>, ...args: unknown[]): Promise<unknown> {
    const expression = buildEvaluateExpression(input, args);
    // Use the page-scoped CDP transport so existing adapter waits longer than
    // Ego's fixed Page.evaluate limit still work (e.g. Douyin's 15s render wait).
    const result = await this.cdp('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
    if (result.exceptionDetails) {
      throw new CommandExecutionError(result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ?? 'Page evaluation failed.');
    }
    return result.result?.value;
  }

  async evaluateOnce<T = unknown>(js: string): Promise<T> {
    return this.evaluate<T>(js);
  }

  async getCookies(options: { domain?: string; url?: string } = {}): Promise<BrowserCookie[]> {
    const url = options.url ?? (options.domain ? `https://${options.domain.replace(/^\./, '')}/` : undefined);
    const result = await this.cdp('Network.getCookies', url ? { urls: [url] } : {});
    if (!isRecord(result) || !Array.isArray(result.cookies) ||
        !result.cookies.every(cookie => isRecord(cookie) && typeof cookie.name === 'string' &&
          typeof cookie.value === 'string' && typeof cookie.domain === 'string')) {
      throw new CommandExecutionError('Ego returned an invalid cookie response.');
    }
    const domain = options.domain?.replace(/^\./, '').toLowerCase();
    return (result.cookies as BrowserCookie[]).filter(cookie => {
      if (!domain) return true;
      const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase();
      return domain === cookieDomain || domain.endsWith(`.${cookieDomain}`);
    });
  }

  async getCurrentUrl(): Promise<string> {
    return this.run('return await page.url();', {}, this.currentTarget());
  }

  getActivePage(): string | undefined {
    return this.activePage;
  }

  setActivePage(target?: string): void {
    this.activePage = target;
  }

  async tabs(): Promise<EgoTab[]> {
    return this.run('return tabs.map(describeTab);');
  }

  async newTab(url?: string): Promise<string> {
    return this.run(`
      const created = await task.newPage();
      try {
        if (input.url) await created.goto(input.url);
        const tab = (await task.tabs()).find(tab => tab.label === created.label && tab.openedBy === 'agent');
        if (!tab) throw new Error('The new Ego tab could not be resolved');
        return tab.targetId;
      } catch (error) {
        await created.close().catch(() => {});
        throw error;
      } finally {
        const previous = tabs.find(tab => tab.targetId === input.previous);
        if (previous) await task.page(previous.label).evaluate('true').catch(() => {});
      }
    `, { url, previous: this.activePage });
  }

  async selectTab(target: number | string): Promise<void> {
    const tab = typeof target === 'number' ? (await this.tabs())[target]?.page : target;
    if (!tab) throw new CommandExecutionError('Ego tab not found.');
    await this.run('await page.evaluate("true");', {}, tab);
    this.setActivePage(tab);
  }

  async closeTab(target?: number | string): Promise<void> {
    const tab = typeof target === 'number' ? (await this.tabs())[target]?.page : target ?? this.currentTarget();
    if (!tab) throw new CommandExecutionError('Ego tab not found.');
    await this.run('await page.close();', {}, tab);
    if (this.activePage === tab) this.setActivePage();
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    if (options.width || options.height) {
      throw new ConfigError('Ego mode does not support screenshot viewport overrides.');
    }
    const result = await this.run(`
      const params = input.params;
      if (params.captureBeyondViewport) {
        const metrics = await page.cdp('Page.getLayoutMetrics');
        const { width, height } = metrics.cssContentSize ?? metrics.contentSize;
        params.clip = { x: 0, y: 0, width, height, scale: 1 };
      }
      return await page.cdp('Page.captureScreenshot', params);
    `, { params: {
      format: options.format ?? 'png',
      ...(options.format === 'jpeg' && { quality: options.quality ?? 80 }),
      captureBeyondViewport: options.fullPage === true,
    } }, this.currentTarget());
    if (!isRecord(result) || typeof result.data !== 'string') {
      throw new CommandExecutionError('Ego did not return screenshot data.');
    }
    if (options.path) await saveBase64ToFile(result.data, options.path);
    return result.data;
  }

  async insertText(text: string): Promise<void> {
    await this.nativeType(text);
  }

  async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.run('return await page.cdp(input.method, input.params, { timeout: 55000 });',
      { method, params }, this.currentTarget());
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    await this.pending;
  }

  async closeWindow(): Promise<void> {
    await this.disconnect();
    await runEgo(spaceScript + 'await task.finish({ keep: [] });', { space: this.space });
  }
}
