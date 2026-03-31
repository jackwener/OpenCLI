/**
 * Skill Saver — generates a production-quality TypeScript adapter from
 * an agent's rich execution trace.
 *
 * Flow: RichTrace → API Discovery → LLM Code Generation → Write .ts → Validate
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LLMClient } from './llm-client.js';
import { discoverApi, type DiscoveryResult } from './api-discovery.js';
import type { RichTrace } from './trace-recorder.js';

export interface SavedSkill {
  path: string;
  command: string;
}

/**
 * Generate a TS adapter from a rich trace via LLM code generation.
 */
export async function saveTraceAsSkill(
  trace: RichTrace,
  name: string,
): Promise<SavedSkill> {
  // Parse and validate name (with path traversal protection)
  const parts = name.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid skill name "${name}" — must be "site/command" format (e.g., "flights/search")`);
  }
  const [site, command] = parts;
  const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;
  if (!SAFE_NAME.test(site) || !SAFE_NAME.test(command)) {
    throw new Error(`Skill name parts must only contain alphanumeric, dash, underscore. Got: "${name}"`);
  }

  // Stage 2: API Discovery
  const discovery = discoverApi(trace);

  // Stage 3: LLM Code Generation
  const tsCode = await generateTsAdapter(trace, discovery, site, command);

  // Write .ts file
  const cliDir = join(homedir(), '.opencli', 'clis', site);
  mkdirSync(cliDir, { recursive: true });
  const filePath = join(cliDir, `${command}.ts`);
  writeFileSync(filePath, tsCode, 'utf-8');

  // Save sanitized trace as JSON for debugging (strip sensitive data)
  const traceDir = join(homedir(), '.opencli', 'traces');
  mkdirSync(traceDir, { recursive: true });
  const tracePath = join(traceDir, `${site}-${command}-${Date.now()}.json`);
  writeFileSync(tracePath, JSON.stringify(sanitizeTrace(trace), null, 2), 'utf-8');

  return {
    path: filePath,
    command: `${site} ${command}`,
  };
}

/**
 * Stage 4: Validate the generated adapter and self-repair if needed.
 *
 * Validates syntax by checking for common issues (missing imports,
 * invalid TypeScript patterns). Cannot do full import validation since
 * user CLI files resolve imports differently at runtime.
 */
export async function saveTraceAsSkillWithValidation(
  trace: RichTrace,
  name: string,
  maxRetries: number = 2,
): Promise<SavedSkill> {
  const saved = await saveTraceAsSkill(trace, name);

  // Syntax validation: check for common LLM code generation issues
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const code = readFileSync(saved.path, 'utf-8');
    const issues = validateAdapterSyntax(code);

    if (issues.length === 0) {
      return saved; // Looks good
    }

    if (attempt >= maxRetries) {
      // Last attempt — return what we have with a warning
      console.error(`Warning: Generated adapter may have issues: ${issues.join('; ')}`);
      return saved;
    }

    // Self-repair: feed issues back to LLM
    const fixedCode = await repairAdapter(code, issues.join('\n'), trace);
    writeFileSync(saved.path, fixedCode, 'utf-8');
  }

  return saved;
}

/** Check for common issues in generated adapter code. */
function validateAdapterSyntax(code: string): string[] {
  const issues: string[] = [];

  // Must have cli() call
  if (!code.includes('cli(')) {
    issues.push('Missing cli() registration call');
  }

  // Must import from registry (either package import or relative)
  if (!code.includes("from '@jackwener/opencli/registry'") && !code.includes("from '../../registry")) {
    issues.push("Missing import from '@jackwener/opencli/registry'");
  }

  // page.evaluate must use string, not arrow function
  if (/page\.evaluate\(\s*\(/.test(code)) {
    issues.push('page.evaluate() must receive a string argument, not an arrow function. Use page.evaluate(`(function() { ... })()`) instead');
  }

  // page.waitForSelector doesn't exist on IPage
  if (code.includes('page.waitForSelector')) {
    issues.push('page.waitForSelector() does not exist. Use page.wait({ selector: "..." }) instead');
  }

  // Import paths should end with .js (ESM requirement)
  if (/from ['"]\.\.\/[^'"]*(?<!\.js)['"]/.test(code)) {
    issues.push('Import paths should end with .js (ESM requirement). Use ../../registry.js not ../../registry');
  }

  return issues;
}

// ── LLM Code Generation ──────────────────────────────────────────────

async function generateTsAdapter(
  trace: RichTrace,
  discovery: DiscoveryResult,
  site: string,
  command: string,
): Promise<string> {
  const llm = new LLMClient();

  const prompt = buildGenerationPrompt(trace, discovery, site, command);

  const response = await llm.chat(
    'You are an expert TypeScript developer specializing in OpenCLI adapter generation. You output ONLY valid TypeScript code, no explanations or markdown.',
    [{ role: 'user', content: prompt }],
  );

  // Extract code from the LLM response
  const doneAction = response.actions.find(a => a.type === 'done');
  if (doneAction && doneAction.type === 'done' && doneAction.result) {
    return extractCode(doneAction.result);
  }
  // Fallback: try to extract code from the thinking field
  if (response.thinking) {
    const fromThinking = extractCode(response.thinking);
    if (fromThinking.includes('cli(')) return fromThinking;
  }
  throw new Error('LLM did not return a done action with generated code');
}

function buildGenerationPrompt(
  trace: RichTrace,
  discovery: DiscoveryResult,
  site: string,
  command: string,
): string {
  const parts: string[] = [];

  parts.push(`Generate a complete OpenCLI TypeScript adapter file for the following task.

## Task
${trace.task}
Starting URL: ${trace.startUrl ?? 'none'}

## OpenCLI Adapter Format

An adapter is a single .ts file that calls cli() to register a command:

\`\`\`typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${site}',
  name: '${command}',
  description: '...',
  domain: '...',
  strategy: Strategy.COOKIE,  // or PUBLIC, INTERCEPT, UI
  browser: true,              // false if no browser needed
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'query', type: 'string', positional: true, help: 'Search query' },
  ],
  columns: ['title', 'author', 'score'],  // fields to show in table output
  func: async (page, kwargs) => {
    // Navigate, fetch API, parse, return array of objects
    await page.goto('https://...');
    await page.wait(2);
    const result = await page.evaluate(\\\`...JS code...\\\`);
    return result;
  },
});
\`\`\`

## Strategy Guide

- Strategy.PUBLIC: No auth needed. Set browser: false, use direct fetch().
- Strategy.COOKIE: Needs browser cookies. Navigate to domain first, then fetch with credentials: 'include'.
- Strategy.INTERCEPT: Need SPA navigation to trigger API. Use page.installInterceptor() then navigate.
- Strategy.UI: Direct DOM interaction. Use page.evaluate() for extraction, page.click/typeText for interaction.

## Important Patterns

1. For COOKIE strategy: Always \`await page.goto('https://domain')\` first to establish cookie context
2. For API calls inside evaluate(): Use \`credentials: 'include'\` in fetch
3. CSRF tokens: Extract from \`document.cookie\` if needed
4. Return an ARRAY of objects matching the columns
5. Use optional chaining (?.) for defensive field access
6. For errors, just throw plain \`new Error('message')\` — do NOT import error classes from other packages
7. Throw AuthRequiredError if cookies/tokens are missing
8. Throw CommandExecutionError for API/parsing failures
9. Never throw on empty results — return []`);

  // API Discovery results
  parts.push(`\n## API Discovery`);
  parts.push(`Recommended Strategy: ${discovery.strategy.toUpperCase()}`);
  parts.push(`Needs Auth: ${discovery.needsAuth}`);
  parts.push(`Needs CSRF: ${discovery.needsCsrf}`);

  if (discovery.goldenApi) {
    const api = discovery.goldenApi;
    parts.push(`\nGolden API Found (score: ${api.score}/100):`);
    parts.push(`  URL: ${api.url}`);
    parts.push(`  Method: ${api.method}`);
    parts.push(`  Array Path: ${api.arrayPath ?? 'none'}`);
    parts.push(`  Array Length: ${api.arrayLength}`);
    parts.push(`  Field Overlap with target data: ${api.fieldOverlap}`);
    parts.push(`\nAPI Response Sample (truncated):`);
    parts.push(api.responseSample.slice(0, 2000));
  } else {
    parts.push('No suitable API found — use UI strategy with page.evaluate()');
  }

  // Auth context
  if (discovery.needsAuth) {
    parts.push(`\n## Auth Context`);
    parts.push(`Cookie names on domain: ${trace.authContext.cookieNames.join(', ')}`);
    if (trace.authContext.csrfPresent) {
      parts.push(`CSRF token found: yes (extract from cookies at runtime)`);
    }
  }

  // Agent action trace
  parts.push(`\n## Agent Action Trace`);
  for (const step of trace.steps.slice(0, 10)) { // Limit to 10 steps
    const actionDesc = step.action.type === 'type'
      ? `type[${step.selector ?? '?'}] = "${(step.action as any).text}"`
      : step.action.type === 'click'
        ? `click[${step.selector ?? '?'}] "${step.elementText ?? ''}"`
        : step.action.type;
    parts.push(`  Step ${step.stepNumber}: ${actionDesc} @ ${step.url}`);
  }

  // Agent thinking (summarized)
  if (trace.thinkingLog.length > 0) {
    parts.push(`\n## Agent Reasoning`);
    for (const t of trace.thinkingLog.slice(0, 5)) {
      parts.push(`  Step ${t.step}: ${t.thinking.slice(0, 200)}`);
    }
  }

  // Target output data
  if (trace.finalData) {
    parts.push(`\n## Expected Output Data`);
    const sample = JSON.stringify(trace.finalData, null, 2);
    parts.push(sample.slice(0, 2000));
  }

  parts.push(`\n## Requirements
- Output ONLY the TypeScript code, nothing else
- The file must be a complete, runnable adapter
- Infer reasonable args (limit, query, etc.) from the trace
- Infer columns from the output data fields
- Use ${discovery.strategy.toUpperCase()} strategy
- Domain: ${extractDomain(trace.startUrl) ?? site}
- Handle errors gracefully (AuthRequiredError, CommandExecutionError)
- Return [] if no results instead of throwing
- CRITICAL: page.evaluate() takes a STRING argument, NOT an arrow function. Write: page.evaluate(\\\`(function() { ... })()\\\`)
- CRITICAL: page.waitForSelector does NOT exist. Use: page.wait({ selector: '...' })
- CRITICAL: Import paths must end with .js — write '../../registry.js' not '../../registry'
- site must be exactly '${site}' and name must be exactly '${command}'`);

  // Respond with a done action containing the code as result
  parts.push(`\nRespond with JSON: {"thinking": "...", "nextGoal": "generate adapter", "actions": [{"type": "done", "result": "<full TypeScript code here>"}]}`);

  return parts.join('\n');
}

// ── Self-Repair ─────────────────────────────────────────────────────

async function repairAdapter(
  code: string,
  error: string,
  trace: RichTrace,
): Promise<string> {
  const llm = new LLMClient();

  const prompt = `Fix this OpenCLI TypeScript adapter that has an error.

## Error
${error}

## Current Code
\`\`\`typescript
${code}
\`\`\`

## Original Task
${trace.task}

Fix the error and output ONLY the corrected TypeScript code. No explanations.
Respond with JSON: {"thinking": "...", "nextGoal": "fix error", "actions": [{"type": "done", "result": "<fixed TypeScript code>"}]}`;

  const response = await llm.chat(
    'You are a TypeScript expert. Fix the code and output only valid TypeScript.',
    [{ role: 'user', content: prompt }],
  );

  const doneAction = response.actions.find(a => a.type === 'done');
  if (doneAction && doneAction.type === 'done' && doneAction.result) {
    return extractCode(doneAction.result);
  }
  return code; // Return original if LLM didn't produce a fix
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractCode(text: string): string {
  // Try to extract TypeScript from markdown code block
  const tsMatch = text.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/);
  if (tsMatch) return tsMatch[1].trim();

  // If the text starts with import or //, it's probably raw code
  const trimmed = text.trim();
  if (trimmed.startsWith('import ') || trimmed.startsWith('/**') || trimmed.startsWith('//')) {
    return trimmed;
  }

  // Try to find code between common markers
  const codeMatch = text.match(/(import\s+[\s\S]*?cli\(\{[\s\S]*?\}\);?)/);
  if (codeMatch) return codeMatch[1].trim();

  // Return as-is
  return trimmed;
}

/** Strip sensitive data from trace before writing to disk. */
function sanitizeTrace(trace: RichTrace): RichTrace {
  const SENSITIVE_KEYS = /^(token|access_token|refresh_token|password|secret|authorization|cookie|set-cookie|x-auth|api_key|apikey)/i;
  return {
    ...trace,
    authContext: {
      ...trace.authContext,
      csrfPresent: trace.authContext.csrfPresent,
      bearerPresent: trace.authContext.bearerPresent,
    },
    networkCapture: trace.networkCapture.map(req => ({
      ...req,
      responseBody: req.responseBody && typeof req.responseBody === 'object'
        ? JSON.parse(JSON.stringify(req.responseBody, (key, val) =>
            SENSITIVE_KEYS.test(key) ? '[REDACTED]' : val
          ))
        : req.responseBody,
    })),
  };
}

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
