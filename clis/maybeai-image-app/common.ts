import * as fs from 'node:fs';
import { CliError } from '@jackwener/opencli/errors';

export interface WorkflowOptions {
  baseUrl: string;
  auth: {
    token: string;
    userId: string;
  };
  service: string;
}

export function readWorkflowOptions(kwargs: Record<string, unknown>): WorkflowOptions {
  const baseUrl = firstString(kwargs['playground-url'], process.env.MAYBEAI_PLAYGROUND_URL, process.env.NEXT_PUBLIC_PLAYGROUND_URL);
  const authToken = firstString(kwargs['auth-token'], process.env.MAYBEAI_AUTH_TOKEN, process.env.MAYBEAI_TOKEN, process.env.AUTH_TOKEN);
  const userId = firstString(kwargs['user-id'], process.env.MAYBEAI_USER_ID, process.env.USER_ID);
  const service = firstString(kwargs.service, process.env.MAYBEAI_SERVICE) || 'e-commerce';

  if (!baseUrl) {
    throw new CliError('ARGUMENT', 'Missing MAYBEAI_PLAYGROUND_URL', 'Set MAYBEAI_PLAYGROUND_URL=https://... or pass --playground-url');
  }
  if (!authToken || !userId) {
    throw new CliError('ARGUMENT', 'Missing MaybeAI auth', 'Pass --auth-token and --user-id, or configure MAYBEAI_AUTH_TOKEN and MAYBEAI_USER_ID');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    auth: {
      token: normalizeAuthToken(authToken).replace(/^Bearer\s+/i, ''),
      userId,
    },
    service,
  };
}

export function readJsonObjectInput(kwargs: Record<string, unknown>): Record<string, unknown> {
  const file = firstString(kwargs['input-file'], kwargs.file);
  const inline = firstString(kwargs.input, kwargs.json);

  if (file) {
    const raw = fs.readFileSync(file, 'utf8');
    return assertRecord(JSON.parse(raw), `JSON file must contain an object: ${file}`);
  }

  if (inline) {
    return assertRecord(JSON.parse(inline), '--input/--json must be a JSON object');
  }

  return {};
}

export function addGenerateOptions(body: Record<string, unknown>, kwargs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...body };
  if (typeof kwargs['task-id'] === 'string' && kwargs['task-id'].trim()) result.task_id = kwargs['task-id'].trim();
  return result;
}

export const WORKFLOW_ARGS = [
  { name: 'playground-url', help: 'Workflow playground URL; defaults to MAYBEAI_PLAYGROUND_URL' },
  { name: 'auth-token', help: 'User auth token; defaults to MAYBEAI_AUTH_TOKEN' },
  { name: 'user-id', help: 'User id; defaults to MAYBEAI_USER_ID' },
  { name: 'service', help: 'Workflow service; defaults to MAYBEAI_SERVICE or e-commerce' },
];

export const INPUT_ARGS = [
  { name: 'input', help: 'Inline JSON input object' },
  { name: 'json', help: 'Alias of --input' },
  { name: 'input-file', help: 'Read input object from JSON file' },
  { name: 'file', help: 'Alias of --input-file' },
];

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeAuthToken(token: string): string {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliError('ARGUMENT', message);
  return value as Record<string, unknown>;
}
