#!/usr/bin/env npx tsx
/**
 * Layer 2: Claude Code Skill E2E Testing (LLM Judge)
 *
 * Spawns Claude Code with the opencli-adapter-author skill. Claude Code
 * completes the task using browse commands AND judges its own result.
 *
 * Task format: YAML with judge_context (multi-criteria, like Browser Use)
 *
 * Usage:
 *   npx tsx autoresearch/eval-skill.ts                    # Run all
 *   npx tsx autoresearch/eval-skill.ts --task hn-top5     # Run single
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const SKILL_PATH = join(__dirname, '..', 'skills', 'opencli-adapter-author', 'SKILL.md');

// ── Types ──────────────────────────────────────────────────────────

interface SkillTask {
  name: string;
  task: string;
  url?: string;
  judge_context: string[];
  max_steps?: number;
}

interface TaskResult {
  name: string;
  passed: boolean;
  duration: number;
  cost: number;
  explanation: string;
}

// ── Task Definitions (inline, to avoid YAML dependency) ────────────

const TASKS: SkillTask[] = [
  // Extract
  { name: "extract-title-example", task: "Extract the main heading text from this page", url: "https://example.com", judge_context: ["Output must contain 'Example Domain'"] },
  { name: "extract-paragraph-wiki", task: "Extract the first paragraph of the JavaScript article", url: "https://en.wikipedia.org/wiki/JavaScript", judge_context: ["Output must mention 'programming language'", "Output must contain actual paragraph text, not just the title"] },
  { name: "extract-github-stars", task: "Find the number of stars on this repository", url: "https://github.com/browser-use/browser-use", judge_context: ["Output must contain a number (the star count)"] },
  { name: "extract-npm-downloads", task: "Find the weekly download count for this package", url: "https://www.npmjs.com/package/zod", judge_context: ["Output must contain a number (weekly downloads)"] },

  // List extraction
  { name: "list-hn-top5", task: "Extract the top 5 stories with their titles", url: "https://news.ycombinator.com", judge_context: ["Output must contain 5 story titles", "Each title must be an actual HN story, not made up"] },
  { name: "list-books-5", task: "Extract the first 5 books with their title and price", url: "https://books.toscrape.com", judge_context: ["Output must contain 5 books", "Each book must have a title and a price"] },
  { name: "list-quotes-3", task: "Extract the first 3 quotes with their text and author", url: "https://quotes.toscrape.com", judge_context: ["Output must contain 3 quotes", "Each quote must have text and an author name"] },
  { name: "list-github-trending", task: "Extract the top 3 trending repositories with name and description", url: "https://github.com/trending", judge_context: ["Output must contain 3 repositories", "Each must have a repo name"] },
  { name: "list-jsonplaceholder", task: "Extract the first 5 posts with their title", url: "https://jsonplaceholder.typicode.com/posts", judge_context: ["Output must contain 5 posts", "Each post must have a title"] },

  // Search
  { name: "search-ddg", task: "Search for 'TypeScript tutorial' and extract the first 3 result titles", url: "https://duckduckgo.com", judge_context: ["The agent must type a search query", "Output must contain at least 3 search result titles"] },
  { name: "search-npm", task: "Search for 'react' and extract the top 3 package names", url: "https://www.npmjs.com", judge_context: ["The agent must search for 'react'", "Output must contain at least 3 package names"] },
  { name: "search-wiki", task: "Search for 'Rust programming language' and extract the first sentence of the article", url: "https://en.wikipedia.org", judge_context: ["The agent must search and navigate to the article", "Output must mention 'programming language'"] },

  // Navigation
  { name: "nav-click-link", task: "Click the 'More information...' link and extract the heading of the new page", url: "https://example.com", judge_context: ["The agent must click a link", "Output must contain 'IANA' or reference the new page"] },
  { name: "nav-click-hn", task: "Click on the first story link and tell me the title of the page you land on", url: "https://news.ycombinator.com", judge_context: ["The agent must click a story link", "Output must contain the title of the destination page"] },
  { name: "nav-go-back", task: "Click the 'More information...' link, then go back, and tell me the heading of the original page", url: "https://example.com", judge_context: ["The agent must click a link then go back", "Output must contain 'Example Domain'"] },
  { name: "nav-multi-step", task: "Click the Next page link at the bottom, then extract the first quote from page 2", url: "https://quotes.toscrape.com", judge_context: ["The agent must navigate to page 2", "Output must contain a quote from page 2"] },

  // Scroll
  { name: "scroll-footer", task: "Scroll to the bottom and extract the footer text", url: "https://quotes.toscrape.com", judge_context: ["The agent must scroll down", "Output must contain footer or bottom-of-page content"] },
  { name: "scroll-pagination", task: "Find the pagination info at the bottom of the page", url: "https://books.toscrape.com", judge_context: ["Output must contain page number or pagination info"] },

  // Form
  { name: "form-fill-basic", task: "Fill the Customer Name with 'OpenCLI' and Telephone with '555-0100'. Do not submit.", url: "https://httpbin.org/forms/post", judge_context: ["The agent must type 'OpenCLI' into a name field", "The agent must type '555-0100' into a phone field", "The form must NOT be submitted"] },
  { name: "form-radio", task: "Select the 'Medium' pizza size option. Do not submit.", url: "https://httpbin.org/forms/post", judge_context: ["The agent must select a radio button for Medium size"] },
  { name: "form-login", task: "Fill the username with 'testuser' and password with 'testpass'. Do not submit.", url: "https://the-internet.herokuapp.com/login", judge_context: ["The agent must fill the username field", "The agent must fill the password field", "The form must NOT be submitted"] },

  // Complex
  { name: "complex-wiki-toc", task: "Extract the table of contents headings", url: "https://en.wikipedia.org/wiki/JavaScript", judge_context: ["Output must contain at least 5 section headings from the table of contents"] },
  { name: "complex-books-detail", task: "Click on the first book and extract its title and price from the detail page", url: "https://books.toscrape.com", judge_context: ["The agent must click on a book", "Output must contain the book title", "Output must contain a price"] },
  { name: "complex-quotes-page2", task: "Navigate to page 2 and extract the first 3 quotes with their authors", url: "https://quotes.toscrape.com", judge_context: ["The agent must navigate to page 2", "Output must contain 3 quotes with authors"] },
  { name: "complex-multi-extract", task: "Extract both the page title and the first paragraph text", url: "https://en.wikipedia.org/wiki/TypeScript", judge_context: ["Output must contain 'TypeScript'", "Output must contain actual paragraph text"] },

  // Bench (harder, real-world)
  { name: "bench-reddit", task: "Extract the titles of the top 5 posts", url: "https://old.reddit.com", judge_context: ["Output must contain 5 post titles", "Titles must be actual Reddit posts"] },
  { name: "bench-imdb", task: "Find the year and rating of The Matrix", url: "https://www.imdb.com/title/tt0133093/", judge_context: ["Output must contain '1999'", "Output must contain a rating number"] },
  { name: "bench-github-profile", task: "Extract the bio and number of public repositories", url: "https://github.com/torvalds", judge_context: ["Output must contain bio text or 'Linux'", "Output must contain a number for repos"] },
  { name: "bench-httpbin", task: "Extract the User-Agent header shown on this page", url: "https://httpbin.org/headers", judge_context: ["Output must contain a User-Agent string"] },
  { name: "bench-jsonapi-todo", task: "Extract the first 5 todo items with their title and completion status", url: "https://jsonplaceholder.typicode.com/todos", judge_context: ["Output must contain 5 todo items", "Each must have a title and completed status"] },

  // Codex form (the real test)
  { name: "codex-form-fill", task: "Fill the basic information using 'opencli' as the identity (first name=open, last name=cli, email=opencli@example.com, GitHub username=opencli). Do NOT submit the form.", url: "https://openai.com/form/codex-for-oss/", judge_context: ["The agent must fill the first name field", "The agent must fill the last name field", "The agent must fill the email field", "The form must NOT be submitted"], max_steps: 15 },
];

// ── Run Task ───────────────────────────────────────────────────────

function runSkillTask(task: SkillTask): TaskResult {
  const start = Date.now();
  const skillContent = readFileSync(SKILL_PATH, 'utf-8');
  const urlPart = task.url ? ` Start URL: ${task.url}` : '';
  const criteria = task.judge_context.map((c, i) => `${i + 1}. ${c}`).join('\n');

  const prompt = `Complete this browser task using opencli browser commands:

TASK: ${task.task}${urlPart}

After completing the task, evaluate your own result against these criteria:
${criteria}

At the very end of your response, output a JSON verdict on its own line:
{"success": true/false, "explanation": "brief explanation"}

Always close the browser with 'opencli browser close' when done.`;

  try {
    const output = execSync(
      `claude -p --dangerously-skip-permissions --allowedTools "Bash(opencli:*)" --system-prompt ${JSON.stringify(skillContent)} --output-format json --no-session-persistence ${JSON.stringify(prompt)}`,
      {
        cwd: join(__dirname, '..'),
        timeout: (task.max_steps ?? 10) * 15_000,
        encoding: 'utf-8',
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const duration = Date.now() - start;

    // Parse Claude Code output
    let resultText = '';
    let cost = 0;
    try {
      const parsed = JSON.parse(output);
      resultText = parsed.result ?? output;
      cost = parsed.total_cost_usd ?? 0;
    } catch {
      resultText = output;
    }

    // Extract verdict JSON from the result
    const verdict = extractVerdict(resultText);

    return {
      name: task.name,
      passed: verdict.success,
      duration,
      cost,
      explanation: verdict.explanation,
    };
  } catch (err: any) {
    return {
      name: task.name,
      passed: false,
      duration: Date.now() - start,
      cost: 0,
      explanation: (err.stdout ?? err.message ?? 'timeout or crash').slice(0, 200),
    };
  }
}

function extractVerdict(text: string): { success: boolean; explanation: string } {
  // Try to find and parse {"success": ...} JSON from the last occurrence
  const idx = text.lastIndexOf('{"success"');
  if (idx !== -1) {
    // Find the matching closing brace (handle escaped quotes in explanation)
    const sub = text.slice(idx);
    let braceCount = 0;
    let end = -1;
    for (let i = 0; i < sub.length; i++) {
      if (sub[i] === '{') braceCount++;
      else if (sub[i] === '}') { braceCount--; if (braceCount === 0) { end = i + 1; break; } }
    }
    if (end > 0) {
      try { return JSON.parse(sub.slice(0, end)); } catch { /* fall through */ }
    }
  }

  // Fallback: check for success indicators in text
  const lower = text.toLowerCase();
  if (lower.includes('"success": true') || lower.includes('"success":true')) {
    return { success: true, explanation: 'Parsed success from output' };
  }
  if (lower.includes('"success": false') || lower.includes('"success":false')) {
    return { success: false, explanation: 'Parsed failure from output' };
  }

  // Final fallback: assume failure if we can't parse
  return { success: false, explanation: 'Could not parse verdict from output' };
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;
  const tasks = singleTask ? TASKS.filter(t => t.name === singleTask) : TASKS;

  if (tasks.length === 0) {
    console.error(`Task "${singleTask}" not found. Available: ${TASKS.map(t => t.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🔬 Layer 2: Skill E2E (LLM Judge) — ${tasks.length} tasks\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] ${task.name}...`);

    const result = runSkillTask(task);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    const costStr = result.cost > 0 ? `, $${result.cost.toFixed(2)}` : '';
    console.log(` ${icon} (${Math.round(result.duration / 1000)}s${costStr})`);
  }

  // Summary
  const totalPassed = results.filter(r => r.passed).length;
  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:  ${totalPassed}/${results.length} (${Math.round(totalPassed / results.length * 100)}%)`);
  console.log(`  Cost:   $${totalCost.toFixed(2)}`);
  console.log(`  Time:   ${Math.round(totalDuration / 60000)}min`);

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.explanation}`);
    }
  }
  console.log('');

  // Save
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('skill-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `skill-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    totalCost,
    duration: `${Math.round(totalDuration / 60000)}min`,
    tasks: results,
  }, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
