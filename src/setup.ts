/**
 * setup.ts — Interactive Playwright MCP token setup
 *
 * Discovers the extension token, shows an interactive checkbox
 * for selecting which config files to update, and applies changes.
 */
import * as fs from 'node:fs';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { exec } from 'node:child_process';
import {
  type DoctorReport,
  PLAYWRIGHT_TOKEN_ENV,
  checkExtensionInstalled,
  checkTokenConnectivity,
  discoverExtensionToken,
  fileExists,
  getDefaultShellRcPath,
  runBrowserDoctor,
  shortenPath,
  toolName,
  upsertJsonConfigToken,
  upsertShellToken,
  upsertTomlConfigToken,
  writeFileWithMkdir,
} from './doctor.js';
import { getTokenFingerprint } from './browser.js';
import { type CheckboxItem, checkboxPrompt } from './tui.js';

export async function runSetup(opts: { cliVersion?: string; token?: string } = {}) {
  console.log();
  console.log(chalk.bold('  opencli setup') + chalk.dim(' — Playwright MCP token configuration'));
  console.log();

  // Step 1: Discover token
  let token = opts.token ?? null;

  if (!token) {
    const extensionToken = discoverExtensionToken();
    const envToken = process.env[PLAYWRIGHT_TOKEN_ENV] ?? null;

    if (extensionToken && envToken && extensionToken === envToken) {
      token = extensionToken;
      console.log(`  ${chalk.green('✓')} Token auto-discovered from Chrome extension`);
      console.log(`    Fingerprint: ${chalk.bold(getTokenFingerprint(token) ?? 'unknown')}`);
    } else if (extensionToken) {
      token = extensionToken;
      console.log(`  ${chalk.green('✓')} Token discovered from Chrome extension ` +
        chalk.dim(`(${getTokenFingerprint(token)})`));
      if (envToken && envToken !== extensionToken) {
        console.log(`  ${chalk.yellow('!')} Environment has different token ` +
          chalk.dim(`(${getTokenFingerprint(envToken)})`));
      }
    } else if (envToken) {
      token = envToken;
      console.log(`  ${chalk.green('✓')} Token from environment variable ` +
        chalk.dim(`(${getTokenFingerprint(token)})`));
    }
  } else {
    console.log(`  ${chalk.green('✓')} Using provided token ` +
      chalk.dim(`(${getTokenFingerprint(token)})`));
  }

  if (!token) {
    // Give precise diagnosis of why token scan failed
    const extInstall = checkExtensionInstalled();

    console.log(`  ${chalk.red('✗')} Browser token scan failed\n`);
    if (!extInstall.installed) {
      const extensionUrl = 'https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm';
      console.log(chalk.dim('  Cause: Playwright MCP Bridge extension is not installed'));
      console.log(chalk.dim('  Fix:   Opening browser to extension store...'));
      console.log(chalk.dim(`         (If it doesn't open automatically, visit: ${extensionUrl})`));

      const command = process.platform === 'darwin' ? `open "${extensionUrl}"` :
                      process.platform === 'win32' ? `start "" "${extensionUrl}"` :
                      `xdg-open "${extensionUrl}"`;
      exec(command).on('error', () => {});
    } else {
      console.log(chalk.dim(`  Cause: Extension is installed (${extInstall.browsers.join(', ')}) but token not found in LevelDB`));
      console.log(chalk.dim('  Fix:   1) Open the extension popup and verify the token is generated'));
      console.log(chalk.dim('         2) Close Chrome completely, then re-run setup'));
    }
    console.log();
    console.log(`  You can enter the token manually, or fix the above and re-run ${chalk.bold('opencli setup')}.`);
    console.log();
    const rl = createInterface({ input, output });
    const answer = await rl.question('  Token (press Enter to abort): ');
    rl.close();
    token = answer.trim();
    if (!token) {
      console.log(chalk.red('\n  No token provided. Aborting.\n'));
      return;
    }
  }

  const fingerprint = getTokenFingerprint(token) ?? 'unknown';
  console.log();

  // Step 2: Scan all config locations
  const report = await runBrowserDoctor({ token, cliVersion: opts.cliVersion });

  // Step 3: Build checkbox items
  const items: CheckboxItem[] = [];

  // Shell file
  const shellPath = report.shellFiles[0]?.path ?? getDefaultShellRcPath();
  const shellStatus = report.shellFiles[0];
  const shellFp = shellStatus?.fingerprint;
  const shellOk = shellFp === fingerprint;
  const shellTool = toolName(shellPath) || 'Shell';
  items.push({
    label: padRight(shortenPath(shellPath), 50) + chalk.dim(` [${shellTool}]`),
    value: `shell:${shellPath}`,
    checked: !shellOk,
    status: shellOk ? `configured (${shellFp})` : shellFp ? `mismatch (${shellFp})` : 'missing',
    statusColor: shellOk ? 'green' : shellFp ? 'yellow' : 'red',
  });

  // Config files
  for (const config of report.configs) {
    const fp = config.fingerprint;
    const ok = fp === fingerprint;
    const tool = toolName(config.path);
    items.push({
      label: padRight(shortenPath(config.path), 50) + chalk.dim(tool ? ` [${tool}]` : ''),
      value: `config:${config.path}`,
      checked: false,  // let user explicitly select which tools to configure
      status: ok ? `configured (${fp})` : !config.exists ? 'will create' : fp ? `mismatch (${fp})` : 'missing',
      statusColor: ok ? 'green' : 'yellow',
    });
  }

  // Step 4: Show interactive checkbox
  console.clear();
  const selected = await checkboxPrompt(items, {
    title: `  ${chalk.bold('opencli setup')} — token ${chalk.cyan(fingerprint)}`,
  });

  if (selected.length === 0) {
    console.log(chalk.dim('  No changes made.\n'));
    return;
  }

  // Step 5: Apply changes
  const written: string[] = [];
  let wroteShell = false;

  for (const sel of selected) {
    if (sel.startsWith('shell:')) {
      const p = sel.slice('shell:'.length);
      const before = fileExists(p) ? fs.readFileSync(p, 'utf-8') : '';
      writeFileWithMkdir(p, upsertShellToken(before, token, p));
      written.push(p);
      wroteShell = true;
    } else if (sel.startsWith('config:')) {
      const p = sel.slice('config:'.length);
      const config = report.configs.find(c => c.path === p);
      if (config && config.parseError) continue;
      const before = fileExists(p) ? fs.readFileSync(p, 'utf-8') : '';
      const format = config?.format ?? (p.endsWith('.toml') ? 'toml' : 'json');
      const next = format === 'toml' ? upsertTomlConfigToken(before, token) : upsertJsonConfigToken(before, token, p);
      writeFileWithMkdir(p, next);
      written.push(p);
    }
  }

  process.env[PLAYWRIGHT_TOKEN_ENV] = token;

  // Step 6: Summary
  if (written.length > 0) {
    console.log(chalk.green.bold(`  ✓ Updated ${written.length} file(s):`));
    for (const p of written) {
      const tool = toolName(p);
      console.log(`    ${chalk.dim('•')} ${shortenPath(p)}${tool ? chalk.dim(` [${tool}]`) : ''}`);
    }
    if (wroteShell) {
      console.log();
      console.log(chalk.cyan(`  💡 Run ${chalk.bold(`source ${shortenPath(shellPath)}`)} to apply token to current shell.`));
    }
  } else {
    console.log(chalk.yellow('  No files were changed.'));
  }
  console.log();

  // Step 7: Auto-verify browser connectivity
  console.log(chalk.dim('  Verifying browser connectivity...'));
  try {
    const result = await checkTokenConnectivity({ timeout: 5 });
    if (result.ok) {
      console.log(`  ${chalk.green('✓')} Browser connected in ${(result.durationMs / 1000).toFixed(1)}s`);
    } else {
      console.log(`  ${chalk.yellow('!')} Browser connectivity test failed: ${result.error ?? 'unknown'}`);
      console.log(chalk.dim('    Make sure Chrome is running with the extension enabled.'));
    }
  } catch {
    console.log(`  ${chalk.yellow('!')} Could not verify connectivity (Chrome may not be running)`);
  }
  console.log();
}

function padRight(s: string, n: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  return visible.length >= n ? s : s + ' '.repeat(n - visible.length);
}
