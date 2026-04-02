/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in commands are registered inline here (list, validate, explore, etc.).
 * Dynamic adapter commands are registered via commanderAdapter.ts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { serializeCommand, formatArgSummary } from './serialization.js';
import { render as renderOutput } from './output.js';
import { getBrowserFactory, browserSession } from './runtime.js';
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { loadExternalClis, executeExternalCli, installExternalCli, registerExternalCli, isBinaryInstalled } from './external.js';
import { registerAllCommands } from './commanderAdapter.js';
import { EXIT_CODES, getErrorMessage } from './errors.js';
import { daemonStatus, daemonStop, daemonRestart } from './commands/daemon.js';

/** Create a browser page for operate commands. Uses 'operate' workspace for session persistence. */
async function getOperatePage(): Promise<import('./types.js').IPage> {
  const { BrowserBridge } = await import('./browser/index.js');
  const bridge = new BrowserBridge();
  return bridge.connect({ timeout: 30, workspace: 'operate:default' });
}

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  const program = new Command();
  // enablePositionalOptions: prevents parent from consuming flags meant for subcommands;
  // prerequisite for passThroughOptions to forward --help/--version to external binaries
  program
    .name('opencli')
    .description('Make any website your CLI. Zero setup. AI-powered.')
    .version(PKG_VERSION)
    .enablePositionalOptions();

  // ── Built-in: list ────────────────────────────────────────────────────────

  program
    .command('list')
    .description('List all available CLI commands')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .option('--json', 'JSON output (deprecated)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...new Set(registry.values())].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const fmt = opts.json && opts.format === 'table' ? 'json' : opts.format;
      const isStructured = fmt === 'json' || fmt === 'yaml';

      if (fmt !== 'table') {
        const rows = isStructured
          ? commands.map(serializeCommand)
          : commands.map(c => ({
              command: fullName(c),
              site: c.site,
              name: c.name,
              aliases: c.aliases?.join(', ') ?? '',
              description: c.description,
              strategy: strategyLabel(c),
              browser: !!c.browser,
              args: formatArgSummary(c.args),
            }));
        renderOutput(rows, {
          fmt,
          columns: ['command', 'site', 'name', 'aliases', 'description', 'strategy', 'browser', 'args',
                     ...(isStructured ? ['columns', 'domain'] : [])],
          title: 'opencli/list',
          source: 'opencli list',
        });
        return;
      }

      // Table (default) — grouped by site
      const sites = new Map<string, CliCommand[]>();
      for (const cmd of commands) {
        const g = sites.get(cmd.site) ?? [];
        g.push(cmd);
        sites.set(cmd.site, g);
      }

      console.log();
      console.log(chalk.bold('  opencli') + chalk.dim(' — available commands'));
      console.log();
      for (const [site, cmds] of sites) {
        console.log(chalk.bold.cyan(`  ${site}`));
        for (const cmd of cmds) {
          const label = strategyLabel(cmd);
          const tag = label === 'public'
            ? chalk.green('[public]')
            : chalk.yellow(`[${label}]`);
          const aliases = cmd.aliases?.length ? chalk.dim(` (aliases: ${cmd.aliases.join(', ')})`) : '';
          console.log(`    ${cmd.name} ${tag}${aliases}${cmd.description ? chalk.dim(` — ${cmd.description}`) : ''}`);
        }
        console.log();
      }

      const externalClis = loadExternalClis();
      if (externalClis.length > 0) {
        console.log(chalk.bold.cyan('  external CLIs'));
        for (const ext of externalClis) {
          const isInstalled = isBinaryInstalled(ext.binary);
          const tag = isInstalled ? chalk.green('[installed]') : chalk.yellow('[auto-install]');
          console.log(`    ${ext.name} ${tag}${ext.description ? chalk.dim(` — ${ext.description}`) : ''}`);
        }
        console.log();
      }

      console.log(chalk.dim(`  ${commands.length} built-in commands across ${sites.size} sites, ${externalClis.length} external CLIs`));
      console.log();
    });

  // ── Built-in: validate / verify ───────────────────────────────────────────

  program
    .command('validate')
    .description('Validate CLI definitions')
    .argument('[target]', 'site or site/name')
    .action(async (target) => {
      const { validateClisWithTarget, renderValidationReport } = await import('./validate.js');
      console.log(renderValidationReport(validateClisWithTarget([BUILTIN_CLIS, USER_CLIS], target)));
    });

  program
    .command('verify')
    .description('Validate + smoke test')
    .argument('[target]')
    .option('--smoke', 'Run smoke tests', false)
    .action(async (target, opts) => {
      const { verifyClis, renderVerifyReport } = await import('./verify.js');
      const r = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target, smoke: opts.smoke });
      console.log(renderVerifyReport(r));
      process.exitCode = r.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
    });

  // ── Built-in: explore / synthesize / generate / cascade ───────────────────

  program
    .command('explore')
    .alias('probe')
    .description('Explore a website: discover APIs, stores, and recommend strategies')
    .argument('<url>')
    .option('--site <name>')
    .option('--goal <text>')
    .option('--wait <s>', '', '3')
    .option('--auto', 'Enable interactive fuzzing')
    .option('--click <labels>', 'Comma-separated labels to click before fuzzing')
    .action(async (url, opts) => {
      const { exploreUrl, renderExploreSummary } = await import('./explore.js');
      const clickLabels = opts.click
        ? opts.click.split(',').map((s: string) => s.trim())
        : undefined;
      const workspace = `explore:${inferHost(url, opts.site)}`;
      const result = await exploreUrl(url, {
        BrowserFactory: getBrowserFactory(),
        site: opts.site,
        goal: opts.goal,
        waitSeconds: parseFloat(opts.wait),
        auto: opts.auto,
        clickLabels,
        workspace,
      });
      console.log(renderExploreSummary(result));
    });

  program
    .command('synthesize')
    .description('Synthesize CLIs from explore')
    .argument('<target>')
    .option('--top <n>', '', '3')
    .action(async (target, opts) => {
      const { synthesizeFromExplore, renderSynthesizeSummary } = await import('./synthesize.js');
      console.log(renderSynthesizeSummary(synthesizeFromExplore(target, { top: parseInt(opts.top) })));
    });

  program
    .command('generate')
    .description('One-shot: explore → synthesize → register')
    .argument('<url>')
    .option('--goal <text>')
    .option('--site <name>')
    .action(async (url, opts) => {
      const { generateCliFromUrl, renderGenerateSummary } = await import('./generate.js');
      const workspace = `generate:${inferHost(url, opts.site)}`;
      const r = await generateCliFromUrl({
        url,
        BrowserFactory: getBrowserFactory(),
        goal: opts.goal,
        site: opts.site,
        workspace,
      });
      console.log(renderGenerateSummary(r));
      process.exitCode = r.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
    });

  // ── Built-in: record ─────────────────────────────────────────────────────

  program
    .command('record')
    .description('Record API calls from a live browser session → generate YAML candidates')
    .argument('<url>', 'URL to open and record')
    .option('--site <name>', 'Site name (inferred from URL if omitted)')
    .option('--out <dir>', 'Output directory for candidates')
    .option('--poll <ms>', 'Poll interval in milliseconds', '2000')
    .option('--timeout <ms>', 'Auto-stop after N milliseconds (default: 60000)', '60000')
    .action(async (url, opts) => {
      const { recordSession, renderRecordSummary } = await import('./record.js');
      const result = await recordSession({
        BrowserFactory: getBrowserFactory(),
        url,
        site: opts.site,
        outDir: opts.out,
        pollMs: parseInt(opts.poll, 10),
        timeoutMs: parseInt(opts.timeout, 10),
      });
      console.log(renderRecordSummary(result));
      process.exitCode = result.candidateCount > 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.EMPTY_RESULT;
    });

  program
    .command('cascade')
    .description('Strategy cascade: find simplest working strategy')
    .argument('<url>')
    .option('--site <name>')
    .action(async (url, opts) => {
      const { cascadeProbe, renderCascadeResult } = await import('./cascade.js');
      const workspace = `cascade:${inferHost(url, opts.site)}`;
      const result = await browserSession(getBrowserFactory(), async (page) => {
        try {
          const siteUrl = new URL(url);
          await page.goto(`${siteUrl.protocol}//${siteUrl.host}`);
          await page.wait(2);
        } catch {}
        return cascadeProbe(page, url);
      }, { workspace });
      console.log(renderCascadeResult(result));
    });

  // ── Built-in: operate (browser control for Claude Code skill) ───────────────
  //
  // Make websites accessible for AI agents.
  // All commands wrapped in operateAction() for consistent error handling.

  const operate = program
    .command('operate')
    .description('Browser control — navigate, click, type, extract, wait (no LLM needed)');

  /** Wrap operate actions with error handling and optional --json output */
  function operateAction(fn: (page: Awaited<ReturnType<typeof getOperatePage>>, ...args: any[]) => Promise<unknown>) {
    return async (...args: any[]) => {
      try {
        const page = await getOperatePage();
        await fn(page, ...args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Extension not connected') || msg.includes('Daemon')) {
          console.error(`Browser not connected. Run 'opencli doctor' to diagnose.`);
        } else if (msg.includes('attach failed') || msg.includes('chrome-extension://')) {
          console.error(`Browser attach failed — another extension may be interfering. Try disabling 1Password.`);
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    };
  }

  // ── Navigation ──

  /** Network interceptor JS — injected on every open/navigate to capture fetch/XHR */
  const NETWORK_INTERCEPTOR_JS = `(function(){if(window.__opencli_net)return;window.__opencli_net=[];var M=200,B=50000,F=window.fetch;window.fetch=async function(){var r=await F.apply(this,arguments);try{var ct=r.headers.get('content-type')||'';if(ct.includes('json')||ct.includes('text')){var c=r.clone(),t=await c.text();if(window.__opencli_net.length<M){var b=null;if(t.length<=B)try{b=JSON.parse(t)}catch(e){b=t}window.__opencli_net.push({url:r.url||(arguments[0]&&arguments[0].url)||String(arguments[0]),method:(arguments[1]&&arguments[1].method)||'GET',status:r.status,size:t.length,ct:ct,body:b})}}}catch(e){}return r};var X=XMLHttpRequest.prototype,O=X.open,S=X.send;X.open=function(m,u){this._om=m;this._ou=u;return O.apply(this,arguments)};X.send=function(){var x=this;x.addEventListener('load',function(){try{var ct=x.getResponseHeader('content-type')||'';if((ct.includes('json')||ct.includes('text'))&&window.__opencli_net.length<M){var t=x.responseText,b=null;if(t&&t.length<=B)try{b=JSON.parse(t)}catch(e){b=t}window.__opencli_net.push({url:x._ou,method:x._om||'GET',status:x.status,size:t?t.length:0,ct:ct,body:b})}}catch(e){}});return S.apply(this,arguments)}})()`;

  operate.command('open').argument('<url>').description('Open URL in automation window')
    .action(operateAction(async (page, url) => {
      await page.goto(url);
      await page.wait(2);
      // Auto-inject network interceptor for API discovery
      try { await page.evaluate(NETWORK_INTERCEPTOR_JS); } catch { /* non-fatal */ }
      console.log(`Navigated to: ${await page.getCurrentUrl?.() ?? url}`);
    }));

  operate.command('back').description('Go back in browser history')
    .action(operateAction(async (page) => {
      await page.evaluate('history.back()');
      await page.wait(2);
      console.log('Navigated back');
    }));

  operate.command('scroll').argument('<direction>', 'up or down').option('--amount <pixels>', 'Pixels to scroll', '500')
    .description('Scroll page')
    .action(operateAction(async (page, direction, opts) => {
      if (direction !== 'up' && direction !== 'down') {
        console.error(`Invalid direction "${direction}". Use "up" or "down".`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      await page.scroll(direction, parseInt(opts.amount, 10));
      console.log(`Scrolled ${direction}`);
    }));

  // ── Inspect ──

  operate.command('state').description('Page state: URL, title, interactive elements with [N] indices')
    .action(operateAction(async (page) => {
      const snapshot = await page.snapshot({ viewportExpand: 800 });
      const url = await page.getCurrentUrl?.() ?? '';
      console.log(`URL: ${url}\n`);
      console.log(typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2));
    }));

  operate.command('screenshot').argument('[path]', 'Save to file (base64 if omitted)')
    .description('Take screenshot')
    .action(operateAction(async (page, path) => {
      if (path) {
        await page.screenshot({ path });
        console.log(`Screenshot saved to: ${path}`);
      } else {
        console.log(await page.screenshot({ format: 'png' }));
      }
    }));

  // ── Get commands (structured data extraction) ──

  const get = operate.command('get').description('Get page properties');

  get.command('title').description('Page title')
    .action(operateAction(async (page) => {
      console.log(await page.evaluate('document.title'));
    }));

  get.command('url').description('Current page URL')
    .action(operateAction(async (page) => {
      console.log(await page.getCurrentUrl?.() ?? await page.evaluate('location.href'));
    }));

  get.command('text').argument('<index>', 'Element index').description('Element text content')
    .action(operateAction(async (page, index) => {
      const text = await page.evaluate(`document.querySelector('[data-opencli-ref="${index}"]')?.textContent?.trim()`);
      console.log(text ?? '(empty)');
    }));

  get.command('value').argument('<index>', 'Element index').description('Input/textarea value')
    .action(operateAction(async (page, index) => {
      const val = await page.evaluate(`document.querySelector('[data-opencli-ref="${index}"]')?.value`);
      console.log(val ?? '(empty)');
    }));

  get.command('html').option('--selector <css>', 'CSS selector scope').description('Page HTML (or scoped)')
    .action(operateAction(async (page, opts) => {
      const sel = opts.selector ? JSON.stringify(opts.selector) : 'null';
      const html = await page.evaluate(`(${sel} ? document.querySelector(${sel})?.outerHTML : document.documentElement.outerHTML)?.slice(0, 50000)`);
      console.log(html ?? '(empty)');
    }));

  get.command('attributes').argument('<index>', 'Element index').description('Element attributes')
    .action(operateAction(async (page, index) => {
      const attrs = await page.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelector('[data-opencli-ref="${index}"]')?.attributes].map(a=>[a.name,a.value])))`);
      console.log(attrs ?? '{}');
    }));

  // ── Interact ──

  operate.command('click').argument('<index>', 'Element index from state').description('Click element by index')
    .action(operateAction(async (page, index) => {
      await page.click(index);
      console.log(`Clicked element [${index}]`);
    }));

  operate.command('type').argument('<index>', 'Element index').argument('<text>', 'Text to type')
    .description('Click element, then type text')
    .action(operateAction(async (page, index, text) => {
      await page.click(index);
      await page.wait(0.3);
      await page.typeText(index, text);
      // Detect autocomplete/combobox fields and wait for dropdown suggestions
      const isAutocomplete = await page.evaluate(`
        (() => {
          const el = document.querySelector('[data-opencli-ref="${index}"]');
          if (!el) return false;
          const role = el.getAttribute('role');
          const ac = el.getAttribute('aria-autocomplete');
          const list = el.getAttribute('list');
          return role === 'combobox' || ac === 'list' || ac === 'both' || !!list;
        })()
      `);
      if (isAutocomplete) {
        await page.wait(0.4);
        console.log(`Typed "${text}" into autocomplete [${index}] — use state to see suggestions`);
      } else {
        console.log(`Typed "${text}" into element [${index}]`);
      }
    }));

  operate.command('select').argument('<index>', 'Element index of <select>').argument('<option>', 'Option text')
    .description('Select dropdown option')
    .action(operateAction(async (page, index, option) => {
      const result = await page.evaluate(`
        (function() {
          var sel = document.querySelector('[data-opencli-ref="${index}"]');
          if (!sel || sel.tagName !== 'SELECT') return { error: 'Not a <select>' };
          var match = Array.from(sel.options).find(o => o.text.trim() === ${JSON.stringify(option)} || o.value === ${JSON.stringify(option)});
          if (!match) return { error: 'Option not found', available: Array.from(sel.options).map(o => o.text.trim()) };
          var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          if (setter) setter.call(sel, match.value); else sel.value = match.value;
          sel.dispatchEvent(new Event('input', {bubbles:true}));
          sel.dispatchEvent(new Event('change', {bubbles:true}));
          return { selected: match.text };
        })()
      `) as { error?: string; selected?: string; available?: string[] } | null;
      if (result?.error) {
        console.error(`Error: ${result.error}${result.available ? ` — Available: ${result.available.join(', ')}` : ''}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      } else {
        console.log(`Selected "${result?.selected}" in element [${index}]`);
      }
    }));

  operate.command('keys').argument('<key>', 'Key to press (Enter, Escape, Tab, Control+a)')
    .description('Press keyboard key')
    .action(operateAction(async (page, key) => {
      await page.pressKey(key);
      console.log(`Pressed: ${key}`);
    }));

  // ── Wait commands ──

  operate.command('wait')
    .argument('<type>', 'selector, text, or time')
    .argument('[value]', 'CSS selector, text string, or seconds')
    .option('--timeout <ms>', 'Timeout in milliseconds', '10000')
    .description('Wait for selector, text, or time (e.g. wait selector ".loaded", wait text "Success", wait time 3)')
    .action(operateAction(async (page, type, value, opts) => {
      const timeout = parseInt(opts.timeout, 10);
      if (type === 'time') {
        const seconds = parseFloat(value ?? '2');
        await page.wait(seconds);
        console.log(`Waited ${seconds}s`);
      } else if (type === 'selector') {
        if (!value) { console.error('Missing CSS selector'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        await page.wait({ selector: value, timeout: timeout / 1000 });
        console.log(`Element "${value}" appeared`);
      } else if (type === 'text') {
        if (!value) { console.error('Missing text'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        await page.wait({ text: value, timeout: timeout / 1000 });
        console.log(`Text "${value}" appeared`);
      } else {
        console.error(`Unknown wait type "${type}". Use: selector, text, or time`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
      }
    }));

  // ── Extract ──

  operate.command('eval').argument('<js>', 'JavaScript code').description('Execute JS in page context, return result')
    .action(operateAction(async (page, js) => {
      const result = await page.evaluate(js);
      if (typeof result === 'string') console.log(result);
      else console.log(JSON.stringify(result, null, 2));
    }));

  // ── Network (API discovery) ──

  operate.command('network')
    .option('--detail <index>', 'Show full response body of request at index')
    .option('--all', 'Show all requests including static resources')
    .description('Show captured network requests (auto-captured since last open)')
    .action(operateAction(async (page, opts) => {
      const requests = await page.evaluate(`(function(){
        var reqs = window.__opencli_net || [];
        return JSON.stringify(reqs);
      })()`) as string;

      let items: Array<{ url: string; method: string; status: number; size: number; ct: string; body: unknown }> = [];
      try { items = JSON.parse(requests); } catch { console.log('No network data captured. Run "operate open <url>" first.'); return; }

      if (items.length === 0) { console.log('No requests captured.'); return; }

      // Filter out static resources unless --all
      if (!opts.all) {
        items = items.filter(r =>
          (r.ct?.includes('json') || r.ct?.includes('xml') || r.ct?.includes('text/plain')) &&
          !/\.(js|css|png|jpg|gif|svg|woff|ico|map)(\?|$)/i.test(r.url) &&
          !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url)
        );
      }

      if (opts.detail !== undefined) {
        const idx = parseInt(opts.detail, 10);
        const req = items[idx];
        if (!req) { console.error(`Request #${idx} not found. ${items.length} requests available.`); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        console.log(`${req.method} ${req.url}`);
        console.log(`Status: ${req.status} | Size: ${req.size} | Type: ${req.ct}`);
        console.log('---');
        console.log(typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2));
      } else {
        console.log(`Captured ${items.length} API requests:\n`);
        items.forEach((r, i) => {
          const bodyPreview = r.body ? (typeof r.body === 'string' ? r.body.slice(0, 60) : JSON.stringify(r.body).slice(0, 60)) : '';
          console.log(`  [${i}] ${r.method} ${r.status} ${r.url.slice(0, 80)}`);
          if (bodyPreview) console.log(`      ${bodyPreview}...`);
        });
        console.log(`\nUse --detail <index> to see full response body.`);
      }
    }));

  // ── Init (adapter scaffolding) ──

  operate.command('init')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Generate adapter scaffold in ~/.opencli/clis/')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error('Name must be site/command format (e.g. hn/top)');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.join(os.homedir(), '.opencli', 'clis', site);
        const filePath = path.join(dir, `${command}.ts`);

        if (fs.existsSync(filePath)) {
          console.log(`Adapter already exists: ${filePath}`);
          return;
        }

        // Try to detect domain from last operate session
        let domain = site;
        try {
          const page = await getOperatePage();
          const url = await page.getCurrentUrl?.();
          if (url) { try { domain = new URL(url).hostname; } catch {} }
        } catch { /* no active session */ }

        const template = `import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${site}',
  name: '${command}',
  description: '', // TODO: describe what this command does
  domain: '${domain}',
  strategy: Strategy.PUBLIC, // TODO: PUBLIC (no auth), COOKIE (needs login), UI (DOM interaction)
  browser: false,            // TODO: set true if needs browser
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: [], // TODO: field names for table output (e.g. ['title', 'score', 'url'])
  func: async (page, kwargs) => {
    // TODO: implement data fetching
    // Prefer API calls (fetch) over browser automation
    // page is available if browser: true
    return [];
  },
});
`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, template, 'utf-8');
        console.log(`Created: ${filePath}`);
        console.log(`Edit the file to implement your adapter, then run: opencli operate verify ${name}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Verify (test adapter) ──

  operate.command('verify')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Execute an adapter and show results')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2) { console.error('Name must be site/command format'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const { execSync } = await import('node:child_process');
        const os = await import('node:os');
        const path = await import('node:path');
        const filePath = path.join(os.homedir(), '.opencli', 'clis', site, `${command}.ts`);

        const fs = await import('node:fs');
        if (!fs.existsSync(filePath)) {
          console.error(`Adapter not found: ${filePath}`);
          console.error(`Run "opencli operate init ${name}" to create it.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        console.log(`🔍 Verifying ${name}...\n`);
        console.log(`  Loading: ${filePath}`);

        try {
          const output = execSync(`node dist/main.js ${site} ${command} --limit 3`, {
            cwd: path.join(path.dirname(import.meta.url.replace('file://', '')), '..'),
            timeout: 30000,
            encoding: 'utf-8',
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          console.log(`  Executing: opencli ${site} ${command} --limit 3\n`);
          console.log(output);
          console.log(`\n  ✓ Adapter works!`);
        } catch (err: any) {
          console.log(`  Executing: opencli ${site} ${command} --limit 3\n`);
          if (err.stdout) console.log(err.stdout);
          if (err.stderr) console.error(err.stderr.slice(0, 500));
          console.log(`\n  ✗ Adapter failed. Fix the code and try again.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Session ──

  operate.command('close').description('Close the automation window')
    .action(operateAction(async (page) => {
      await page.closeWindow?.();
      console.log('Automation window closed');
    }));

  // ── Built-in: doctor / completion ──────────────────────────────────────────

  program
    .command('doctor')
    .description('Diagnose opencli browser bridge connectivity')
    .option('--no-live', 'Skip live browser connectivity test')
    .option('--sessions', 'Show active automation sessions', false)
    .action(async (opts) => {
      const { runBrowserDoctor, renderBrowserDoctorReport } = await import('./doctor.js');
      const report = await runBrowserDoctor({ live: opts.live, sessions: opts.sessions, cliVersion: PKG_VERSION });
      console.log(renderBrowserDoctorReport(report));
    });

  program
    .command('completion')
    .description('Output shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell) => {
      printCompletionScript(shell);
    });

  // ── Plugin management ──────────────────────────────────────────────────────

  const pluginCmd = program.command('plugin').description('Manage opencli plugins');

  pluginCmd
    .command('install')
    .description('Install a plugin from a git repository')
    .argument('<source>', 'Plugin source (e.g. github:user/repo)')
    .action(async (source: string) => {
      const { installPlugin } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      try {
        const result = installPlugin(source);
        await discoverPlugins();
        if (Array.isArray(result)) {
          if (result.length === 0) {
            console.log(chalk.yellow('No plugins were installed (all skipped or incompatible).'));
          } else {
            console.log(chalk.green(`\u2705 Installed ${result.length} plugin(s) from monorepo: ${result.join(', ')}`));
          }
        } else {
          console.log(chalk.green(`\u2705 Plugin "${result}" installed successfully. Commands are ready to use.`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('uninstall')
    .description('Uninstall a plugin')
    .argument('<name>', 'Plugin name')
    .action(async (name: string) => {
      const { uninstallPlugin } = await import('./plugin.js');
      try {
        uninstallPlugin(name);
        console.log(chalk.green(`✅ Plugin "${name}" uninstalled.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('update')
    .description('Update a plugin (or all plugins) to the latest version')
    .argument('[name]', 'Plugin name (required unless --all is passed)')
    .option('--all', 'Update all installed plugins')
    .action(async (name: string | undefined, opts: { all?: boolean }) => {
      if (!name && !opts.all) {
        console.error(chalk.red('Error: Please specify a plugin name or use the --all flag.'));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      if (name && opts.all) {
        console.error(chalk.red('Error: Cannot specify both a plugin name and --all.'));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const { updatePlugin, updateAllPlugins } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      if (opts.all) {
        const results = updateAllPlugins();
        if (results.length > 0) {
          await discoverPlugins();
        }

        let hasErrors = false;
        console.log(chalk.bold('  Update Results:'));
        for (const result of results) {
          if (result.success) {
            console.log(`  ${chalk.green('✓')} ${result.name}`);
            continue;
          }
          hasErrors = true;
          console.log(`  ${chalk.red('✗')} ${result.name} — ${chalk.dim(result.error)}`);
        }

        if (results.length === 0) {
          console.log(chalk.dim('  No plugins installed.'));
          return;
        }

        console.log();
        if (hasErrors) {
          console.error(chalk.red('Completed with some errors.'));
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        } else {
          console.log(chalk.green('✅ All plugins updated successfully.'));
        }
        return;
      }

      try {
        updatePlugin(name!);
        await discoverPlugins();
        console.log(chalk.green(`✅ Plugin "${name}" updated successfully.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });


  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts) => {
      const { listPlugins } = await import('./plugin.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log(chalk.dim('  No plugins installed.'));
        console.log(chalk.dim(`  Install one with: opencli plugin install github:user/repo`));
        return;
      }
      if (opts.format === 'json') {
        renderOutput(plugins, {
          fmt: 'json',
          columns: ['name', 'commands', 'source'],
          title: 'opencli/plugins',
          source: 'opencli plugin list',
        });
        return;
      }
      console.log();
      console.log(chalk.bold('  Installed plugins'));
      console.log();

      // Group by monorepo
      const standalone = plugins.filter((p) => !p.monorepoName);
      const monoGroups = new Map<string, typeof plugins>();
      for (const p of plugins) {
        if (!p.monorepoName) continue;
        const g = monoGroups.get(p.monorepoName) ?? [];
        g.push(p);
        monoGroups.set(p.monorepoName, g);
      }

      for (const p of standalone) {
        const version = p.version ? chalk.green(` @${p.version}`) : '';
        const desc = p.description ? chalk.dim(` — ${p.description}`) : '';
        const cmds = p.commands.length > 0 ? chalk.dim(` (${p.commands.join(', ')})`) : '';
        const src = p.source ? chalk.dim(` ← ${p.source}`) : '';
        console.log(`  ${chalk.cyan(p.name)}${version}${desc}${cmds}${src}`);
      }

      for (const [mono, group] of monoGroups) {
        console.log();
        console.log(chalk.bold.magenta(`  📦 ${mono}`) + chalk.dim(' (monorepo)'));
        for (const p of group) {
          const version = p.version ? chalk.green(` @${p.version}`) : '';
          const desc = p.description ? chalk.dim(` — ${p.description}`) : '';
          const cmds = p.commands.length > 0 ? chalk.dim(` (${p.commands.join(', ')})`) : '';
          console.log(`    ${chalk.cyan(p.name)}${version}${desc}${cmds}`);
        }
      }

      console.log();
      console.log(chalk.dim(`  ${plugins.length} plugin(s) installed`));
      console.log();
    });

  pluginCmd
    .command('create')
    .description('Create a new plugin scaffold')
    .argument('<name>', 'Plugin name (lowercase, hyphens allowed)')
    .option('-d, --dir <path>', 'Output directory (default: ./<name>)')
    .option('--description <text>', 'Plugin description')
    .action(async (name: string, opts: { dir?: string; description?: string }) => {
      const { createPluginScaffold } = await import('./plugin-scaffold.js');
      try {
        const result = createPluginScaffold(name, {
          dir: opts.dir,
          description: opts.description,
        });
        console.log(chalk.green(`✅ Plugin scaffold created at ${result.dir}`));
        console.log();
        console.log(chalk.bold('  Files created:'));
        for (const f of result.files) {
          console.log(`    ${chalk.cyan(f)}`);
        }
        console.log();
        console.log(chalk.dim('  Next steps:'));
        console.log(chalk.dim(`    cd ${result.dir}`));
        console.log(chalk.dim(`    opencli plugin install file://${result.dir}`));
        console.log(chalk.dim(`    opencli ${name} hello`));
      } catch (err) {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Built-in: daemon ──────────────────────────────────────────────────────
  const daemonCmd = program.command('daemon').description('Manage the opencli daemon');
  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => { await daemonStatus(); });
  daemonCmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => { await daemonStop(); });
  daemonCmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => { await daemonRestart(); });

  // ── External CLIs ─────────────────────────────────────────────────────────

  const externalClis = loadExternalClis();

  program
    .command('install')
    .description('Install an external CLI')
    .argument('<name>', 'Name of the external CLI')
    .action((name: string) => {
      const ext = externalClis.find(e => e.name === name);
      if (!ext) {
        console.error(chalk.red(`External CLI '${name}' not found in registry.`));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      installExternalCli(ext);
    });

  program
    .command('register')
    .description('Register an external CLI')
    .argument('<name>', 'Name of the CLI')
    .option('--binary <bin>', 'Binary name if different from name')
    .option('--install <cmd>', 'Auto-install command')
    .option('--desc <text>', 'Description')
    .action((name, opts) => {
      registerExternalCli(name, { binary: opts.binary, install: opts.install, description: opts.desc });
    });

  function passthroughExternal(name: string, parsedArgs?: string[]) {
    const args = parsedArgs ?? (() => {
      const idx = process.argv.indexOf(name);
      return process.argv.slice(idx + 1);
    })();
    try {
      executeExternalCli(name, args, externalClis);
    } catch (err) {
      console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
      process.exitCode = EXIT_CODES.GENERIC_ERROR;
    }
  }

  for (const ext of externalClis) {
    if (program.commands.some(c => c.name() === ext.name)) continue;
    program
      .command(ext.name)
      .description(`(External) ${ext.description || ext.name}`)
      .argument('[args...]')
      .allowUnknownOption()
      .passThroughOptions()
      .helpOption(false)
      .action((args: string[]) => passthroughExternal(ext.name, args));
  }

  // ── Antigravity serve (long-running, special case) ────────────────────────

  const antigravityCmd = program.command('antigravity').description('antigravity commands');
  antigravityCmd
    .command('serve')
    .description('Start Anthropic-compatible API proxy for Antigravity')
    .option('--port <port>', 'Server port (default: 8082)', '8082')
    .action(async (opts) => {
      const { startServe } = await import('./clis/antigravity/serve.js');
      await startServe({ port: parseInt(opts.port) });
    });

  // ── Dynamic adapter commands ──────────────────────────────────────────────

  const siteGroups = new Map<string, Command>();
  siteGroups.set('antigravity', antigravityCmd);
  registerAllCommands(program, siteGroups);

  // ── Unknown command fallback ──────────────────────────────────────────────
  // Security: do NOT auto-discover and register arbitrary system binaries.
  // Only explicitly registered external CLIs (via `opencli register`) are allowed.

  program.on('command:*', (operands: string[]) => {
    const binary = operands[0];
    console.error(chalk.red(`error: unknown command '${binary}'`));
    if (isBinaryInstalled(binary)) {
      console.error(chalk.dim(`  Tip: '${binary}' exists on your PATH. Use 'opencli register ${binary}' to add it as an external CLI.`));
    }
    program.outputHelp();
    process.exitCode = EXIT_CODES.USAGE_ERROR;
  });

  program.parse();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Infer a workspace-friendly hostname from a URL, with site override. */
function inferHost(url: string, site?: string): string {
  if (site) return site;
  try { return new URL(url).host; } catch { return 'default'; }
}
