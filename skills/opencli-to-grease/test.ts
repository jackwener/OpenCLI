/**
 * GreaseAI JSON Test Script
 *
 * Tests a single GreaseAI JSON file using runTask and compares
 * with OpenCLI command execution results.
 *
 * Usage:
 *   npm run test -- <json-file> [options]
 *
 * Options:
 *   --cdp <url>       CDP URL (default: http://localhost:9222)
 *   --params <json>   Parameters as JSON string (e.g. '{"limit":10}')
 *   --no-compare      Skip comparison with OpenCLI command results
 *   --site <name>     Site name for OpenCLI command (extracted from JSON if not provided)
 *
 * Environment:
 *   CDP_URL           Chrome DevTools Protocol URL
 *
 * Example:
 *   npm run test -- ./clis/36kr/hot.json
 *   npm run test -- ./clis/zhihu/search.json --params '{"query":"AI","limit":5}'
 */

import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from 'dotenv';
import {
  runTask,
  setDebugTask,
  getDebugTaskResult,
  clearDebugTask,
  clearDebugTaskResult,
  type BrowserTask,
  type GAction,
  type DebugTaskResult,
} from 'grease-driver-layer/driver-layer';

// Load .env file
config();

const execAsync = promisify(exec);

// ── Types ──

interface GreaseAction {
  action: string;
  argument: Record<string, unknown>;
  selectors?: Array<{ selector: string; reason?: string }>;
  xpath?: string;
}

interface GreaseVariable {
  name: string;
  type?: string;
  default?: unknown;
  required?: boolean;
}

interface GreaseOutput {
  actions: GreaseAction[];
  api_endpoint?: string;
  category: string;
  description: string;
  is_public: boolean;
  method?: string;
  name: string;
  output_schema?: Array<{ name: string; type: string; description: string }>;
  variables?: GreaseVariable[];
  website_domain: string;
  website_id: string;
}

interface BrowserState {
  browserContextId: string;
}

interface OpenCliResult {
  success: boolean;
  data: unknown[];
  error?: string;
}

interface CompareResult {
  greaseCount: number;
  opencliCount: number;
  match: boolean;
  sampleMatch: boolean;
  differences: string[];
}

interface TestLog {
  timestamp: string;
  json_file: string;
  command: string;
  website: string;
  params: Record<string, unknown>;
  success: boolean;
  data_count: number;
  sample_data?: unknown[];
  comparison?: {
    grease_count: number;
    opencli_count: number;
    match: boolean;
    differences: string[];
  };
}

// ── Functions ──

async function loadGreaseJson(filePath: string): Promise<GreaseOutput> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as GreaseOutput;
}

async function getBrowserContextId(cdpUrl: string): Promise<string> {
  const stateResponse = await fetch(`${cdpUrl}/json/state`);
  const stateData = await stateResponse.json() as BrowserState[];

  if (!Array.isArray(stateData) || stateData.length === 0) {
    throw new Error('No browser context found. Ensure Chrome is running with remote debugging enabled.');
  }

  return stateData[0]?.browserContextId;
}

/**
 * Create debug task from GreaseAI JSON
 */
function createDebugTask(
  grease: GreaseOutput,
  params: Record<string, unknown>,
  cdpUrl: string,
  browserContextId: string
): BrowserTask {
  // Convert GreaseAction to GAction
  const actions: GAction[] = grease.actions.map(a => ({
    action: a.action as GAction['action'],
    argument: a.argument,
    selectors: a.selectors,
    xpath: a.xpath,
  }));

  const urlObj = new URL(cdpUrl);

  const task: BrowserTask = {
    _id: 'debug-task',
    screenshot_type: 'none',
    status: 'waiting',
    user_id: 'debug-user',
    params,
    browser_instance_id: 'dev-browser-config',
    browser_instance_info: {
      browser_config_id: 'dev-browser-config',
    },
    browser_operation: {
      name: grease.name,
      actions,
    },
  };

  return task;
}

/**
 * Run OpenCLI command and get results
 */
async function runOpenCliCommand(
  site: string,
  command: string,
  params: Record<string, unknown>,
  greaseVariables?: GreaseVariable[]
): Promise<OpenCliResult> {
  let cmdStr = `opencli ${site} ${command}`;

  const positionalArgs: string[] = [];
  const optionalArgs: string[] = [];

  const positionalNames = (greaseVariables || [])
    .filter(v => v.required)
    .map(v => v.name);

  const commonPositionalNames = ['query', 'keyword', 'word', 'username', 'name', 'id', 'handle', 'url', 'subreddit', 'tag'];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (value === '' && !positionalNames.includes(key)) continue;

    const isPositional = positionalNames.includes(key) || commonPositionalNames.includes(key);
    if (isPositional && value !== '') {
      positionalArgs.push(`"${value}"`);
    } else if (key === 'limit') {
      optionalArgs.push(`--limit ${value}`);
    } else if (key === 'sort' || key === 'time' || key === 'mode' || key === 'page') {
      optionalArgs.push(`--${key} "${value}"`);
    } else {
      // Convert underscores to hyphens for CLI flags (OpenCLI convention)
      const flagName = key.replace(/_/g, '-');
      optionalArgs.push(`--${flagName} "${value}"`);
    }
  }

  cmdStr += ' ' + positionalArgs.join(' ') + ' ' + optionalArgs.join(' ');
  cmdStr += ' -f json';

  console.log(`\nRunning OpenCLI: ${cmdStr}`);

  try {
    const { stdout, stderr } = await execAsync(cmdStr, { timeout: 60000 });

    if (stderr && !stderr.includes('Warning')) {
      console.log(`  stderr: ${stderr.slice(0, 200)}`);
    }

    const data = JSON.parse(stdout);
    const items = Array.isArray(data) ? data : [data];

    console.log(`  OpenCLI result: ${items.length} items`);

    return { success: true, data: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  OpenCLI error: ${message}`);
    return { success: false, data: [], error: message };
  }
}

/**
 * Compare GreaseAI and OpenCLI results
 */
function compareResults(
  greaseData: unknown,
  opencliData: unknown[]
): CompareResult {
  const greaseItems = Array.isArray(greaseData) ? greaseData : [greaseData];
  const differences: string[] = [];

  const greaseCount = greaseItems.length;
  const opencliCount = opencliData.length;

  if (greaseCount !== opencliCount) {
    differences.push(`Count mismatch: GreaseAI=${greaseCount}, OpenCLI=${opencliCount}`);
  }

  const sampleMatch = greaseCount > 0 && opencliCount > 0;
  if (sampleMatch) {
    const greaseSample = greaseItems.slice(0, 3);
    const opencliSample = opencliData.slice(0, 3);

    for (let i = 0; i < Math.min(greaseSample.length, opencliSample.length); i++) {
      const gItem = greaseSample[i] as Record<string, unknown>;
      const oItem = opencliSample[i] as Record<string, unknown>;

      const keysToCompare = Object.keys(gItem);
      for (const key of keysToCompare) {
        const gVal = String(gItem[key] ?? '').slice(0, 50);
        const oVal = String(oItem[key] ?? '').slice(0, 50);

        if (gVal !== oVal && gVal && oVal) {
          differences.push(`Item ${i + 1} "${key}": Grease="${gVal}" vs OpenCLI="${oVal}"`);
        }
      }
    }
  }

  return {
    greaseCount,
    opencliCount,
    match: differences.length === 0,
    sampleMatch,
    differences,
  };
}

function printCompareSummary(compare: CompareResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nGreaseAI items: ${compare.greaseCount}`);
  console.log(`OpenCLI items: ${compare.opencliCount}`);

  if (compare.match) {
    console.log('\n✓ Results MATCH');
  } else {
    console.log('\n✗ Results DIFFER:');
    for (const diff of compare.differences) {
      console.log(`  - ${diff}`);
    }
  }

  console.log('\n' + '='.repeat(60));
}

function printResultSummary(
  grease: GreaseOutput,
  extractedData: unknown | null,
  compare?: CompareResult
): boolean {
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULT SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nCommand: ${grease.name}`);
  console.log(`Website: ${grease.website_domain}`);
  console.log(`Category: ${grease.category}`);

  if (extractedData) {
    const dataCount = Array.isArray(extractedData) ? extractedData.length : 1;
    console.log(`\nData returned: ${dataCount} items`);

    if (Array.isArray(extractedData) && extractedData.length > 0) {
      console.log('\nSample data (GreaseAI):');
      const sample = extractedData.slice(0, 5);
      for (let i = 0; i < sample.length; i++) {
        const item = sample[i] as Record<string, unknown>;
        const display = Object.entries(item)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
          .join(', ');
        console.log(`  ${i + 1}. ${display}`);
      }
    }
  }

  if (compare) {
    printCompareSummary(compare);
  } else {
    console.log('\n' + '='.repeat(60));
  }

  const success = !!extractedData && (!compare || compare.match);
  return success;
}

function printUsage(): void {
  console.log(`
GreaseAI JSON Test Script

Tests a single GreaseAI JSON file using runTask and optionally
compares with OpenCLI command execution results.

Usage:
  npm run test -- <json-file> [options]

Options:
  --cdp <url>       CDP URL (default: http://localhost:9222)
  --params <json>   Parameters as JSON string
  --no-compare      Skip comparison with OpenCLI command results
  --site <name>     Site name (extracted from JSON domain if not provided)

Environment:
  CDP_URL           Chrome DevTools Protocol URL

Examples:
  npm run test -- ./clis/36kr/hot.json
  npm run test -- ./clis/zhihu/search.json --params '{"query":"AI","limit":5}'
  npm run test -- ./output.json --cdp http://localhost:9223 --no-compare

Prerequisites:
  1. Chrome running with remote debugging: chrome --remote-debugging-port=9222
  2. automator package installed (npm install)
  3. OpenCLI installed globally: npm install -g @jackwener/opencli
`);
}

function extractSiteFromDomain(domain: string): string {
  let site = domain.replace(/^www\./, '').replace(/^m\./, '');
  // Handle creator.* subdomains - use parent domain name
  site = site.replace(/^creator\./, '');
  site = site.replace(/\.(com|cn|net|org|rs|io|dev|app|to|me|co|info|tv)$/, '');

  const mappings: Record<string, string> = {
    'lobste': 'lobsters',
    'dev': 'devto',
    'bsky': 'bluesky',
    'store.steampowered': 'steam',
    'api.dictionaryapi': 'dictionary',
    'h5.xet': 'xiaoe',
    'study.xiaoe-tech': 'xiaoe',
    'm.okjike': 'jike',
    'jimeng.jianying': 'jimeng',
    'movie.douban': 'douban',
    'bbs.hupu': 'hupu',
  };

  return mappings[site] || site;
}

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function writeTestLog(
  jsonFile: string,
  grease: GreaseOutput,
  params: Record<string, unknown>,
  extractedData: unknown | null,
  compare?: CompareResult
): void {
  const success = !!extractedData && (!compare || compare.match);

  const log: TestLog = {
    timestamp: new Date().toISOString(),
    json_file: jsonFile,
    command: grease.name,
    website: grease.website_domain,
    params,
    success,
    data_count: Array.isArray(extractedData) ? extractedData.length : (extractedData ? 1 : 0),
    sample_data: Array.isArray(extractedData) ? extractedData.slice(0, 5) : (extractedData ? [extractedData] : undefined),
    comparison: compare ? {
      grease_count: compare.greaseCount,
      opencli_count: compare.opencliCount,
      match: compare.match,
      differences: compare.differences,
    } : undefined,
  };

  const logFile = jsonFile.replace(/\.json$/, '.test');
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  console.log(`\nTest log written to: ${logFile}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // Parse arguments
  const jsonFile = args.find(a => !a.startsWith('--'));
  if (!jsonFile) {
    printUsage();
    process.exit(1);
  }

  const cdpUrlValue = args.find(a => a.startsWith('--cdp'))?.split('=')[1]
    || process.env.CDP_URL
    || 'http://localhost:9222';

  const paramsStr = args.find(a => a.startsWith('--params'));
  let params: Record<string, unknown> = {};
  if (paramsStr) {
    const idx = args.indexOf(paramsStr);
    if (paramsStr.includes('=')) {
      params = JSON.parse(paramsStr.split('=')[1]);
    } else if (idx >= 0 && args[idx + 1]) {
      params = JSON.parse(args[idx + 1]);
    }
  }

  const shouldCompare = !args.includes('--no-compare');
  const siteOverride = args.find(a => a.startsWith('--site'))?.split('=')[1];

  console.log('\nGreaseAI JSON Test');
  console.log('==================\n');
  console.log(`File: ${jsonFile}`);
  console.log(`CDP: ${cdpUrlValue}`);
  console.log(`Params: ${JSON.stringify(params)}`);
  console.log(`Compare: ${shouldCompare}`);

  // Load JSON
  console.log('\nLoading GreaseAI JSON...');
  const grease = await loadGreaseJson(jsonFile);

  console.log(`\nCommand: ${grease.name}`);
  console.log(`Description: ${grease.description}`);
  console.log(`Website: ${grease.website_domain}`);
  console.log(`Actions: ${grease.actions.length}`);

  // Apply default values from variables
  if (grease.variables) {
    for (const v of grease.variables) {
      if (v.default !== undefined && params[v.name] === undefined) {
        params[v.name] = v.default;
      }
    }
    console.log(`\nVariables with defaults applied: ${JSON.stringify(params)}`);
  }

  // Get browser context
  console.log('\nConnecting to browser...');
  let browserContextId: string;
  try {
    browserContextId = await getBrowserContextId(cdpUrlValue);
    console.log(`Browser Context ID: ${browserContextId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to get browser context: ${message}`);
    console.error('\nEnsure Chrome is running with remote debugging:');
    console.error('  chrome --remote-debugging-port=9222');
    process.exit(1);
  }

  // Set CDP_URL environment variable for runTask
  process.env.CDP_URL = cdpUrlValue;

  // Create and set debug task
  const task = createDebugTask(grease, params, cdpUrlValue, browserContextId);
  setDebugTask(task);

  console.log('\nDebug task set:');
  console.log(`  - Task ID: ${task._id}`);
  console.log(`  - Operation: ${task.browser_operation.name}`);
  console.log(`  - Actions: ${task.browser_operation.actions.length}`);

  // Run task using runTask
  console.log('\nExecuting task with runTask...');

  try {
    await runTask('debug-task');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nrunTask error: ${message}`);
  }

  // Get debug task results
  const taskResult = getDebugTaskResult();
  let extractedData: unknown[] | null = null;
  if (taskResult?.extractData) {
    const parsed = JSON.parse(taskResult.extractData);
    // extractData is an array of results from all evaluate actions
    // The last evaluate result is the final processed data
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Take the last item as the final result
      const lastResult = parsed[parsed.length - 1];
      extractedData = Array.isArray(lastResult) ? lastResult : [lastResult];
    } else {
      extractedData = parsed;
    }
  }

  // Clear debug task
  clearDebugTask();
  clearDebugTaskResult();

  // Run OpenCLI comparison if requested
  let compare: CompareResult | undefined;

  if (shouldCompare) {
    const site = siteOverride || extractSiteFromDomain(grease.website_domain);
    const command = toKebabCase(grease.name);

    console.log('\n' + '-'.repeat(40));
    console.log('OPENCLI COMPARISON');
    console.log('-'.repeat(40));

    const opencliResult = await runOpenCliCommand(site, command, params, grease.variables);

    if (!extractedData) {
      // GreaseAI failed, still generate comparison with error info
      compare = {
        greaseCount: 0,
        opencliCount: opencliResult.success ? opencliResult.data.length : 0,
        match: false,
        sampleMatch: false,
        differences: ['GreaseAI returned no data'],
      };
    } else if (opencliResult.success) {
      compare = compareResults(extractedData, opencliResult.data);
    } else {
      // OpenCLI failed, still generate comparison with error info
      const greaseItems = Array.isArray(extractedData) ? extractedData : [extractedData];
      compare = {
        greaseCount: greaseItems.length,
        opencliCount: 0,
        match: false,
        sampleMatch: false,
        differences: [`OpenCLI failed: ${opencliResult.error || 'Unknown error'}`],
      };
    }
  }

  // Print summary
  const success = printResultSummary(grease, extractedData, compare);

  // Write test log
  writeTestLog(jsonFile, grease, params, extractedData, compare);

  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});