import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '@jackwener/opencli/errors';
import { readWorkflowOptions, type WorkflowOptions } from './common.js';

export type WorkflowVariable = { name: string; default_value: unknown };
export type JsonRecord = Record<string, unknown>;

export interface ToolFlowWorkflow {
  id?: string;
  title?: string;
  flows: Array<{
    id: string;
    operation?: {
      type?: string;
      tool?: {
        id?: string;
        arguments?: Array<{
          name?: string;
          type?: string;
          value?: unknown;
        }>;
      };
    };
  }>;
}

export class AppFactoryMcpClient {
  private readonly options: WorkflowOptions;
  private readonly taskId: string;
  private readonly app: string;

  constructor(kwargs: Record<string, unknown>, app: string) {
    this.options = readWorkflowOptions(kwargs);
    this.taskId = typeof kwargs['task-id'] === 'string' && kwargs['task-id'].trim()
      ? kwargs['task-id'].trim()
      : crypto.randomUUID();
    this.app = app;
  }

  async callTool(toolId: string, toolArgs: JsonRecord): Promise<unknown> {
    const response = await fetch(`${this.options.baseUrl}/api/v1/tool/function_call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.auth.token}`,
        'user-id': this.options.auth.userId,
      },
      body: JSON.stringify({
        task_id: this.taskId,
        app: this.app,
        user_id: this.options.auth.userId,
        tool_id: toolId,
        tool_args: cleanToolArgs(toolArgs),
      }),
      signal: AbortSignal.timeout(600_000),
    });

    const text = await response.text();
    const result = parseJsonText(text) ?? text;
    const error = extractErrorMessage(result);
    if (!response.ok || error) {
      throw new CliError('WORKFLOW_RUN', error || `MCP function_call failed: ${response.status}`, text.slice(0, 1000));
    }
    return result;
  }
}

export async function runToolFlow(params: {
  client: AppFactoryMcpClient;
  workflow: ToolFlowWorkflow;
  flowId: string;
  variables: WorkflowVariable[];
  outputs?: Map<string, unknown>;
}): Promise<unknown> {
  const flow = params.workflow.flows.find(item => item.id === params.flowId);
  if (!flow?.operation?.tool?.id) {
    throw new CliError('ARGUMENT', `Missing tool flow: ${params.flowId}`);
  }

  const toolArgs: JsonRecord = {};
  for (const arg of flow.operation.tool.arguments ?? []) {
    if (!arg.name) continue;
    toolArgs[arg.name] = resolveTemplateValue(arg.value, params.variables, params.outputs);
  }
  return params.client.callTool(flow.operation.tool.id, toolArgs);
}

export function loadAppFactoryWorkflow(relativePath: string): ToolFlowWorkflow {
  const root = findWorkspaceRoot();
  const filePath = path.join(root, 'app-factory', 'apps', 'shell', 'app', 'e-commerce', relativePath);
  if (!fs.existsSync(filePath)) {
    throw new CliError('ARGUMENT', `Missing app-factory workflow: ${relativePath}`, filePath);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ToolFlowWorkflow;
}

export function extractText(value: unknown, depth = 0): string {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractText(item, depth + 1);
      if (text) return text;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const record = value as JsonRecord;
  for (const key of ['cell_value', 'text', 'message', 'output', 'content']) {
    if (typeof record[key] === 'string' && record[key]) return String(record[key]).trim();
  }
  for (const key of ['result', 'structuredContent', 'raw_response', 'data', 'payload']) {
    const text = extractText(record[key], depth + 1);
    if (text) return text;
  }
  return '';
}

export function normalizeJsonLike(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value !== 'string') return value;
  const parsed = parseJsonText(value);
  return parsed === null ? value.trim() : normalizeJsonLike(parsed, depth + 1);
}

export function extractJsonPayload(value: unknown): unknown {
  const text = extractText(value);
  if (text) return normalizeJsonLike(text);
  if (value && typeof value === 'object') {
    const record = value as JsonRecord;
    return record.structuredContent ?? record.result ?? value;
  }
  return value;
}

export function extractImageUrl(value: unknown): string {
  const candidates = [extractJsonPayload(value), value];
  for (const candidate of candidates) {
    const found = findImageUrl(candidate);
    if (found) return found;
  }
  const text = extractText(value);
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  return match?.[0] ?? '';
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

export function variableMap(variables: WorkflowVariable[]): Map<string, unknown> {
  return new Map(variables.map(item => [item.name, item.default_value]));
}

export function getVariable(variables: WorkflowVariable[], name: string): unknown {
  return variables.find(item => item.name === name)?.default_value;
}

function resolveTemplateValue(value: unknown, variables: WorkflowVariable[], outputs?: Map<string, unknown>): unknown {
  if (typeof value !== 'string') return value;
  const allValues = new Map<string, unknown>([...variableMap(variables), ...(outputs ? [...outputs] : [])]);
  if (allValues.has(value)) return allValues.get(value);
  if (value.startsWith('variable:') || value.startsWith('scalar:') || value.startsWith('series:') || value.startsWith('dataframe:')) {
    return allValues.get(value) ?? '';
  }
  return value.replace(/\$\{([^}]+)\}/g, (_match, key: string) => stringifyTemplateValue(allValues.get(key) ?? ''));
}

function stringifyTemplateValue(value: unknown): string {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  if (value === null || value === undefined) return '';
  return String(value);
}

function cleanToolArgs(toolArgs: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(toolArgs).filter(([, value]) => value !== '' && value !== null && value !== undefined));
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  for (const [startChar, endChar] of [['{', '}'], ['[', ']']] as const) {
    const start = trimmed.indexOf(startChar);
    const end = trimmed.lastIndexOf(endChar);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

function extractErrorMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as JsonRecord;
  if (record.success === false || record.isError === true) {
    const direct = ['error', 'message', 'detail'].map(key => record[key]).find(item => typeof item === 'string' && item.trim());
    if (direct) return String(direct);
  }
  for (const key of ['error', 'message', 'detail']) {
    if (typeof record[key] === 'string' && record[key] && record.success === false) return String(record[key]);
  }
  return '';
}

function findImageUrl(value: unknown): string {
  if (typeof value === 'string') return value.startsWith('http') ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as JsonRecord;
  for (const key of ['url', 'image_url', 'output_url', 'generated_url']) {
    if (typeof record[key] === 'string' && String(record[key]).startsWith('http')) return String(record[key]);
  }
  for (const key of ['result', 'structuredContent', 'data']) {
    const found = findImageUrl(record[key]);
    if (found) return found;
  }
  return '';
}

function findWorkspaceRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app-factory')) && fs.existsSync(path.join(dir, 'opencli'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
