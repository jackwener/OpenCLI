import { CliError } from '@jackwener/opencli/errors';

export interface MaybeAiWorkflowAuth {
  token: string;
  userId: string;
}

export interface MaybeAiWorkflowClientOptions {
  baseUrl: string;
  auth: MaybeAiWorkflowAuth;
  systemAuth?: MaybeAiWorkflowAuth;
  service?: string;
}

export interface MaybeAiWorkflowRunOptions {
  artifactId: string;
  variables: Array<{ name: string; default_value: unknown }>;
  appId: string;
  title: string;
  taskId?: string;
  prevTaskId?: string;
  useSystemAuth?: boolean;
  service?: string;
}

interface WorkflowDetail {
  id: string;
  artifact_id: string;
  variables?: Array<{ name?: string }>;
  user_input?: Array<{ name?: string }>;
}

interface WorkflowRunBody {
  artifact_id: string;
  interaction: boolean;
  task: string;
  task_id: string;
  prev_task_id?: string;
  workflow_id: string;
  variables: Array<{ name: string; default_value: unknown }>;
  metadata: { case: string; title: string };
  last_chunk_id?: string;
  service?: string;
}

export function readMaybeAiWorkflowClientOptions(): MaybeAiWorkflowClientOptions {
  const baseUrl = process.env.MAYBEAI_PLAYGROUND_URL || process.env.NEXT_PUBLIC_PLAYGROUND_URL;
  const token = process.env.MAYBEAI_AUTH_TOKEN || process.env.MAYBEAI_TOKEN || process.env.AUTH_TOKEN;
  const userId = process.env.MAYBEAI_USER_ID || process.env.USER_ID;
  const systemToken = process.env.MAYBEAI_SYSTEM_TOKEN || process.env.BINGO_TOKEN;
  const systemUserId = process.env.MAYBEAI_SYSTEM_USER_ID || process.env.BINGO_USER_ID;

  if (!baseUrl) {
    throw new CliError('CONFIG', 'Missing MAYBEAI_PLAYGROUND_URL', 'Set MAYBEAI_PLAYGROUND_URL=https://... before running image generation.');
  }
  if (!token || !userId) {
    throw new CliError('CONFIG', 'Missing MaybeAI auth', 'Set MAYBEAI_AUTH_TOKEN and MAYBEAI_USER_ID before running image generation.');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    auth: { token, userId },
    systemAuth: systemToken && systemUserId ? { token: systemToken, userId: systemUserId } : undefined,
    service: process.env.MAYBEAI_SERVICE || 'e-commerce',
  };
}

export class MaybeAiWorkflowClient {
  constructor(private readonly options: MaybeAiWorkflowClientOptions) {}

  async run(options: MaybeAiWorkflowRunOptions): Promise<unknown[]> {
    const workflowDetail = await this.fetchWorkflowDetail(options.artifactId);
    const body: WorkflowRunBody = {
      artifact_id: workflowDetail.artifact_id,
      interaction: true,
      task: '',
      task_id: options.taskId || crypto.randomUUID(),
      prev_task_id: options.prevTaskId,
      workflow_id: workflowDetail.id,
      variables: filterWorkflowVariables(workflowDetail, options.variables),
      metadata: {
        case: options.appId,
        title: options.title,
      },
      last_chunk_id: undefined,
    };

    const service = options.service ?? this.options.service;
    if (!options.useSystemAuth && service) {
      body.service = service;
    }

    const auth = options.useSystemAuth
      ? this.options.systemAuth ?? this.options.auth
      : this.options.auth;

    const response = await fetch(`${this.options.baseUrl}/api/v1/workflow/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'user-id': auth.userId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new CliError('HTTP', `Workflow run failed: ${response.status}`, await safeResponseText(response));
    }

    return readWorkflowStream(response, body);
  }

  private async fetchWorkflowDetail(artifactId: string): Promise<WorkflowDetail> {
    const response = await fetch(`${this.options.baseUrl}/api/v1/workflow/detail/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: artifactId }),
    });

    if (!response.ok) {
      throw new CliError('HTTP', `Workflow detail failed: ${response.status}`, await safeResponseText(response));
    }

    return response.json() as Promise<WorkflowDetail>;
  }
}

export function buildSecondStepVariablesV2(
  promptConfigs: Array<Record<string, unknown>>,
  finalVariables: Array<{ name: string; default_value: unknown }>,
  appId: string,
  includeLlmModel: boolean,
): Array<{ name: string; default_value: unknown }> {
  const variableMap = new Map(finalVariables.map((item) => [item.name, item.default_value]));
  const processedPromptConfigs = promptConfigs.map(normalizePromptConfig);

  return [
    {
      name: 'variable:scalar:case',
      default_value: appId,
    },
    {
      name: 'variable:dataframe:input_data',
      default_value: processedPromptConfigs,
    },
    ...(includeLlmModel && variableMap.has('variable:scalar:llm_model')
      ? [{
        name: 'variable:scalar:llm_model',
        default_value: variableMap.get('variable:scalar:llm_model'),
      }]
      : []),
  ];
}

export function extractGeneratedImages(results: unknown[], imageFields: string[]): Array<{ type: 'image'; url: string; raw: unknown }> {
  const images: Array<{ type: 'image'; url: string; raw: unknown }> = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    for (const field of imageFields) {
      const value = getByPath(item as Record<string, unknown>, field);
      if (typeof value === 'string' && value.trim()) {
        images.push({ type: 'image', url: value, raw: item });
        break;
      }
    }
  }
  return images;
}

function filterWorkflowVariables(
  workflowDetail: WorkflowDetail,
  variables: Array<{ name: string; default_value: unknown }>,
): Array<{ name: string; default_value: unknown }> {
  const allowedNames = new Set<string>();
  for (const item of workflowDetail.variables ?? []) {
    if (item.name) allowedNames.add(item.name);
  }
  for (const item of workflowDetail.user_input ?? []) {
    if (item.name) allowedNames.add(item.name);
  }
  if (allowedNames.size === 0) return variables;
  return variables.filter((item) => allowedNames.has(item.name));
}

async function readWorkflowStream(response: Response, body: WorkflowRunBody): Promise<unknown[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];

  const decoder = new TextDecoder();
  let buffer = '';
  const dataflowOutput: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? '';

    for (const eventText of events) {
      const eventData = parseSseData(eventText);
      if (!eventData) continue;

      const maybeOutput = parseWorkflowEvent(eventData, body);
      if (maybeOutput?.type === 'output') {
        dataflowOutput.push(...maybeOutput.data);
      }
      if (maybeOutput?.type === 'failed') {
        throw new CliError('WORKFLOW', maybeOutput.message, `Task ID: ${body.task_id}`);
      }
    }
  }

  return dataflowOutput;
}

function parseSseData(eventText: string): string | null {
  const lines = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (lines.length === 0) return null;
  return lines.join('\n');
}

function parseWorkflowEvent(eventData: string, body: WorkflowRunBody): { type: 'output'; data: unknown[] } | { type: 'failed'; message: string } | null {
  const json = JSON.parse(eventData) as Record<string, unknown>;
  if (json.type !== 'content') return null;
  if (typeof json.id === 'string') body.last_chunk_id = json.id;

  const data = json.data;
  if (!data || typeof data !== 'object') return null;
  const content = (data as Record<string, unknown>).content;
  if (typeof content !== 'string') return null;

  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.event_type === 'workflow_failed' || parsed.event_type === 'action_failed') {
    return { type: 'failed', message: JSON.stringify(parsed).slice(-800) };
  }

  if (parsed.event_type !== 'dataflow_output' || typeof parsed.content !== 'string') {
    return null;
  }

  const parsedContent = JSON.parse(parsed.content) as Record<string, unknown>;
  const output = parsedContent.output as Record<string, unknown> | undefined;
  if (!output) return null;

  if (output.type === 'dataframe' && Array.isArray(output.data)) {
    return { type: 'output', data: output.data };
  }
  if (output.type === 'scalar') {
    return { type: 'output', data: [flattenScalarOutput(String(parsedContent.output_id ?? ''), output.data)] };
  }
  return null;
}

function flattenScalarOutput(outputId: string, data: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const normalizedOutputId = outputId.split(':').pop();
  if (normalizedOutputId) result[normalizedOutputId] = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    Object.assign(result, data as Record<string, unknown>);
  }
  return result;
}

function normalizePromptConfig(item: Record<string, unknown>): Record<string, unknown> {
  const result = { ...item };
  for (const key of ['product_image_url', 'reference_image_url']) {
    if (typeof result[key] !== 'string') continue;
    try {
      const parsed = JSON.parse(result[key]);
      if (Array.isArray(parsed)) result[key] = parsed;
    } catch {
      // keep original string
    }
  }
  if (typeof result.duration === 'string') {
    const duration = Number.parseInt(result.duration, 10);
    if (Number.isFinite(duration)) result.duration = duration;
  }
  return result;
}

function getByPath(item: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, item);
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
