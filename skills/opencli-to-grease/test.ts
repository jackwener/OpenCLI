/**
 * GreaseAI JSON Test Script
 *
 * Tests a single GreaseAI JSON file using the automator and compares
 * with OpenCLI command execution results.
 *
 * Usage:
 *   npx ts-node test.ts <json-file> [options]
 *
 * Options:
 *   --cdp <url>       CDP URL (default: http://localhost:9222)
 *   --params <json>   Parameters as JSON string (e.g. '{"limit":10}')
 *   --compare         Compare with OpenCLI command results
 *   --site <name>     Site name for OpenCLI command (extracted from JSON if not provided)
 *
 * Environment:
 *   CDP_URL           Chrome DevTools Protocol URL
 *
 * Example:
 *   npx ts-node test.ts ./grease-output/www.zhihu.com-hot.json --compare
 *   npx ts-node test.ts ./www.bilibili.com-hot.json --params '{"limit":5}' --compare
 */

import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from 'dotenv';
import { Automator } from 'automator/driver-layer';

// Load .env file
config();

const execAsync = promisify(exec);

// ── Types ──

interface GreaseAction {
  action: string;
  argument: Record<string, unknown>;
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
  variables?: GreaseVariable[];
  website_domain: string;
  website_id: string;
}

interface ActionResponse {
  success: 'succeeded' | 'failed';
  extract_data?: unknown;
  url?: string;
}

interface ActionResult {
  action: string;
  result?: ActionResponse;
  error?: string;
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

async function executeActions(
  automator: any,
  actions: GreaseAction[],
  params: Record<string, unknown>
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    console.log(`\nStep ${i + 1}: ${action.action}`);

    try {
      const result = await automator.executeAction(action, params) as ActionResponse;
      console.log(`  Status: ${result.success}`);

      if (result.extract_data) {
        const data = result.extract_data;
        const dataCount = Array.isArray(data) ? data.length : 1;
        console.log(`  Data extracted: ${dataCount} items`);

        // Show first few items
        if (Array.isArray(data) && data.length > 0) {
          const preview = data.slice(0, 3);
          console.log(`  Preview (first 3):`);
          for (const item of preview) {
            console.log(`    - ${JSON.stringify(item).slice(0, 100)}...`);
          }
        }
      }

      if (result.url) {
        console.log(`  URL: ${result.url}`);
      }

      results.push({ action: action.action, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Error: ${message}`);
      results.push({ action: action.action, error: message });
    }
  }

  return results;
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
  // Build command string
  let cmdStr = `opencli ${site} ${command}`;

  // Separate positional and optional arguments
  const positionalArgs: string[] = [];
  const optionalArgs: string[] = [];

  // Check which args are positional from grease variables
  // Positional args are: required fields OR known positional names
  const positionalNames = (greaseVariables || [])
    .filter(v => v.required)
    .map(v => v.name);

  // Common positional argument names (regardless of required status)
  const commonPositionalNames = ['query', 'keyword', 'word', 'username', 'name', 'id', 'handle', 'url', 'subreddit', 'tag'];

  // Add parameters
  for (const [key, value] of Object.entries(params)) {
    // Skip empty values but keep required values
    if (value === undefined || value === null) continue;
    if (value === '' && !positionalNames.includes(key)) continue;

    // Handle positional arguments (no -- prefix)
    const isPositional = positionalNames.includes(key) || commonPositionalNames.includes(key);
    if (isPositional && value !== '') {
      positionalArgs.push(`"${value}"`);
    } else if (key === 'limit') {
      optionalArgs.push(`--limit ${value}`);
    } else if (key === 'sort' || key === 'time' || key === 'mode' || key === 'page') {
      optionalArgs.push(`--${key} "${value}"`);
    } else {
      optionalArgs.push(`--${key} "${value}"`);
    }
  }

  // Add positional args first, then optional
  cmdStr += ' ' + positionalArgs.join(' ') + ' ' + optionalArgs.join(' ');

  // Add JSON format
  cmdStr += ' -f json';

  console.log(`\nRunning OpenCLI: ${cmdStr}`);

  try {
    const { stdout, stderr } = await execAsync(cmdStr, { timeout: 60000 });

    if (stderr && !stderr.includes('Warning')) {
      console.log(`  stderr: ${stderr.slice(0, 200)}`);
    }

    // Parse JSON output
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
  opencliData: unknown[],
  greaseColumns?: string[]
): CompareResult {
  const greaseItems = Array.isArray(greaseData) ? greaseData : [greaseData];
  const differences: string[] = [];

  const greaseCount = greaseItems.length;
  const opencliCount = opencliData.length;

  // Check count match
  if (greaseCount !== opencliCount) {
    differences.push(`Count mismatch: GreaseAI=${greaseCount}, OpenCLI=${opencliCount}`);
  }

  // Sample comparison (first 3 items)
  const sampleMatch = greaseCount > 0 && opencliCount > 0;
  if (sampleMatch) {
    const greaseSample = greaseItems.slice(0, 3);
    const opencliSample = opencliData.slice(0, 3);

    for (let i = 0; i < Math.min(greaseSample.length, opencliSample.length); i++) {
      const gItem = greaseSample[i] as Record<string, unknown>;
      const oItem = opencliSample[i] as Record<string, unknown>;

      // Compare key fields
      const keysToCompare = greaseColumns || Object.keys(gItem);
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
  results: ActionResult[],
  compare?: CompareResult
): boolean {
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULT SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nCommand: ${grease.name}`);
  console.log(`Website: ${grease.website_domain}`);
  console.log(`Category: ${grease.category}`);
  console.log(`Actions executed: ${results.length}`);

  const succeeded = results.filter(r => r.result?.success === 'succeeded').length;
  const failed = results.filter(r => r.error || r.result?.success === 'failed').length;

  console.log(`\nSucceeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);

  // Check if we got data
  const evalResult = results.find(r => r.action === 'evaluate');
  if (evalResult?.result?.extract_data) {
    const data = evalResult.result.extract_data;
    console.log(`\nData returned: ${Array.isArray(data) ? data.length : 1} items`);

    if (Array.isArray(data) && data.length > 0) {
      console.log('\nSample data (GreaseAI):');
      const sample = data.slice(0, 5);
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

  return failed === 0 && (!compare || compare.match);
}

function printUsage(): void {
  console.log(`
GreaseAI JSON Test Script

Tests a single GreaseAI JSON file using the automator and optionally
compares with OpenCLI command execution results.

Usage:
  npx ts-node test.ts <json-file> [options]

Options:
  --cdp <url>       CDP URL (default: http://localhost:9222)
  --params <json>   Parameters as JSON string
  --no-compare      Skip comparison with OpenCLI command results (default: compare)
  --site <name>     Site name (extracted from JSON domain if not provided)

Environment:
  CDP_URL           Chrome DevTools Protocol URL

Examples:
  npx ts-node test.ts ./grease-output/www.zhihu.com-hot.json
  npx ts-node test.ts ./www.bilibili.com-hot.json --params '{"limit":5}'
  npx ts-node test.ts ./output.json --cdp http://localhost:9223 --no-compare

Prerequisites:
  1. Chrome running with remote debugging: chrome --remote-debugging-port=9222
  2. automator package installed (npm install)
  3. OpenCLI installed globally: npm install -g @jackwener/opencli
`);
}

function extractSiteFromDomain(domain: string): string {
  // Remove www. prefix and common suffixes
  let site = domain.replace(/^www\./, '').replace(/^m\./, '');
  site = site.replace(/\.(com|cn|net|org|rs|io|dev|app|to|me|co|info|tv)$/, '');

  // Special mappings for domain -> OpenCLI command name
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
  // Convert PascalCase/CamelCase to kebab-case
  // e.g., "TopSellers" -> "top-sellers", "Hot" -> "hot"
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

interface TestLog {
  timestamp: string;
  json_file: string;
  command: string;
  website: string;
  params: Record<string, unknown>;
  success: boolean;
  actions: {
    action: string;
    status: 'succeeded' | 'failed';
    error?: string;
  }[];
  data_count: number;
  sample_data?: unknown[];
  comparison?: {
    grease_count: number;
    opencli_count: number;
    match: boolean;
    differences: string[];
  };
}

function writeTestLog(
  jsonFile: string,
  grease: GreaseOutput,
  params: Record<string, unknown>,
  results: ActionResult[],
  compare?: CompareResult
): void {
  const succeeded = results.filter(r => r.result?.success === 'succeeded').length;
  const failed = results.filter(r => r.error || r.result?.success === 'failed').length;
  const success = failed === 0 && (!compare || compare.match);

  const evalResult = results.find(r => r.action === 'evaluate');
  const data = evalResult?.result?.extract_data;

  const log: TestLog = {
    timestamp: new Date().toISOString(),
    json_file: jsonFile,
    command: grease.name,
    website: grease.website_domain,
    params,
    success,
    actions: results.map(r => ({
      action: r.action,
      status: r.result?.success === 'succeeded' ? 'succeeded' : 'failed',
      error: r.error,
    })),
    data_count: Array.isArray(data) ? data.length : (data ? 1 : 0),
    sample_data: Array.isArray(data) ? data.slice(0, 5) : (data ? [data] : undefined),
    comparison: compare ? {
      grease_count: compare.greaseCount,
      opencli_count: compare.opencliCount,
      match: compare.match,
      differences: compare.differences,
    } : undefined,
  };

  // Write log file next to the JSON file
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
    // Handle both --params='...' and --params '...' formats
    const idx = args.indexOf(paramsStr);
    if (paramsStr.includes('=')) {
      params = JSON.parse(paramsStr.split('=')[1]);
    } else if (idx >= 0 && args[idx + 1]) {
      params = JSON.parse(args[idx + 1]);
    }
  }

  const shouldCompare = !args.includes('--no-compare'); // Default to compare
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

  // Initialize automator
  const taskId = `test-${grease.name.toLowerCase()}`;
  const automator = new Automator(taskId);

  const urlObj = new URL(cdpUrlValue);
  await automator.init({
    browser_instance_id: 'test-instance',
    cdp: {
      host: urlObj.hostname || 'localhost',
      port: parseInt(urlObj.port) || 9222,
      url: cdpUrlValue,
    },
    browser_context_id: browserContextId,
  });

  console.log('Automator initialized');

  // Execute actions
  console.log('\nExecuting GreaseAI actions...');
  const results = await executeActions(automator, grease.actions, params);

  // Get GreaseAI data
  const evalResult = results.find(r => r.action === 'evaluate');
  const greaseData = evalResult?.result?.extract_data;

  // Run OpenCLI comparison if requested
  let opencliResult: OpenCliResult | undefined;
  let compare: CompareResult | undefined;

  if (shouldCompare && greaseData) {
    const site = siteOverride || extractSiteFromDomain(grease.website_domain);
    const command = toKebabCase(grease.name);

    console.log('\n' + '-'.repeat(40));
    console.log('OPENCLI COMPARISON');
    console.log('-'.repeat(40));

    opencliResult = await runOpenCliCommand(site, command, params, grease.variables);

    if (opencliResult.success) {
      compare = compareResults(greaseData, opencliResult.data);
    }
  }

  // Print summary
  const success = printResultSummary(grease, results, compare);

  // Write test log
  writeTestLog(jsonFile, grease, params, results, compare);

  // Cleanup
  await automator.cleanup();

  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});