import { CliError } from '@jackwener/opencli/errors';

const DEFAULT_TIMEOUT_MS = 120_000;
const DETAIL_TIMEOUT_MS = 60_000;

export interface WorkflowAuth {
  token: string;
  userId: string;
}

export interface WorkflowClientOptions {
  baseUrl: string;
  auth: WorkflowAuth;
  service: string;
}

export class WorkflowClient {
  constructor(private readonly options: WorkflowClientOptions) {}

  async run(params: {
    artifactId: string;
    variables: Array<{ name: string; default_value: unknown }>;
    appId: string;
    title: string;
    taskId?: string;
    prevTaskId?: string;
    useSystemAuth?: boolean;
    service?: string;
  }): Promise<unknown[]> {
    const workflowDetail = await this.fetchWorkflowDetail(params.artifactId);
    const filteredVariables = filterWorkflowVariables(workflowDetail, params.variables);
    const selectedService = params.service || this.options.service;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.auth.token}`,
      'user-id': this.options.auth.userId,
    };

    const baseTaskId = params.taskId || crypto.randomUUID();
    const attemptTaskIds: string[] = [];
    const maxRetries = getWorkflowRetryLimit();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const currentTaskId = attempt === 0 ? baseTaskId : crypto.randomUUID();
      attemptTaskIds.push(currentTaskId);
      const body: Record<string, unknown> = {
        artifact_id: workflowDetail.artifact_id,
        interaction: true,
        task: '',
        task_id: currentTaskId,
        workflow_id: workflowDetail.id,
        variables: filteredVariables,
        metadata: { case: params.appId, title: params.title },
        last_chunk_id: null,
      };
      if (params.prevTaskId) body.prev_task_id = params.prevTaskId;
      if (!params.useSystemAuth && selectedService) body.service = selectedService;

      try {
        const response = await fetch(`${this.options.baseUrl}/api/v1/workflow/run`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
          const text = await response.text();
          const error = cliWorkflowError('WORKFLOW_RUN', `Workflow run failed: ${response.status}`, text, { taskId: currentTaskId });
          if (attempt < maxRetries && isRetryableRunFailure(error)) continue;
          throw withRetryDetails(error, attemptTaskIds);
        }
        return await readWorkflowStream(response, body as { task_id: string; last_chunk_id: string | null });
      } catch (error) {
        const cliError = toCliWorkflowError(error, currentTaskId);
        if (attempt < maxRetries && isRetryableRunFailure(cliError)) continue;
        throw withRetryDetails(cliError, attemptTaskIds);
      }
    }

    throw cliWorkflowError('WORKFLOW_RUN', 'Workflow run exhausted retries', `Task IDs: ${attemptTaskIds.join(', ')}`, { taskIds: attemptTaskIds, retryCount: attemptTaskIds.length - 1 });
  }

  async fetchWorkflowDetail(artifactId: string) {
    const response = await fetch(`${this.options.baseUrl}/api/v1/workflow/detail/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: artifactId }),
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });
    if (!response.ok) throw cliWorkflowError('WORKFLOW_RUN', `Workflow detail failed: ${response.status}`, await response.text());
    return await response.json() as { id: string; artifact_id: string; variables?: Array<{ name?: string }>; user_input?: Array<{ name?: string }> };
  }
}

export function buildSecondStepVariablesV2(promptConfigs: Array<Record<string, unknown>>, finalVariables: Array<{ name: string; default_value: unknown }>, appId: string, includeLlmModel: boolean) {
  const variableMap = Object.fromEntries(finalVariables.map(item => [item.name, item.default_value]));
  const processedPromptConfigs = promptConfigs.map(normalizePromptConfig);
  const variables: Array<{ name: string; default_value: unknown }> = [
    { name: 'variable:scalar:case', default_value: appId },
    { name: 'variable:dataframe:input_data', default_value: processedPromptConfigs },
  ];
  if (includeLlmModel && Object.prototype.hasOwnProperty.call(variableMap, 'variable:scalar:llm_model')) {
    variables.push({ name: 'variable:scalar:llm_model', default_value: variableMap['variable:scalar:llm_model'] });
  }
  return variables;
}

export function extractGeneratedImages(results: unknown[], imageFields: string[]) {
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

export function filterWorkflowVariables(workflowDetail: { variables?: Array<{ name?: string }>; user_input?: Array<{ name?: string }> }, variables: Array<{ name: string; default_value: unknown }>) {
  const allowedNames = new Set([...(workflowDetail.variables ?? []), ...(workflowDetail.user_input ?? [])].map(item => item?.name).filter((name): name is string => typeof name === 'string' && name.length > 0));
  if (allowedNames.size === 0) return variables;
  return variables.filter(item => allowedNames.has(item.name));
}

function normalizePromptConfig(item: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...item };
  for (const key of ['product_image_url', 'reference_image_url']) {
    const value = result[key];
    if (typeof value !== 'string') continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) result[key] = parsed;
    } catch {}
  }
  if (typeof result.duration === 'string') {
    const parsed = Number(result.duration);
    if (Number.isFinite(parsed)) result.duration = parsed;
  }
  return result;
}

async function readWorkflowStream(response: Response, body: { task_id: string; last_chunk_id: string | null }) {
  const reader = response.body?.getReader();
  if (!reader) throw cliWorkflowError('WORKFLOW_RUN', 'Workflow stream is empty', `Task ID: ${body.task_id}`, { taskId: body.task_id });
  const decoder = new TextDecoder();
  let buffer = '';
  const dataflowOutput: unknown[] = [];
  let sawOutputEvent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const eventText of events) {
      const eventData = parseSseData(eventText);
      if (!eventData) continue;
      const parsed = parseWorkflowEvent(eventData, body);
      if (!parsed) continue;
      if (parsed.type === 'output') {
        sawOutputEvent = true;
        dataflowOutput.push(...parsed.data);
      } else if (parsed.type === 'failed') {
        throw cliWorkflowError('WORKFLOW_RUN', parsed.message, `Task ID: ${body.task_id}`, { taskId: body.task_id });
      }
    }
  }

  if (!sawOutputEvent) throw cliWorkflowError('WORKFLOW_RUN', 'Workflow run did not return any dataflow_output event', `Task ID: ${body.task_id}`, { taskId: body.task_id });
  return dataflowOutput;
}

function parseSseData(eventText: string) {
  const lines = eventText.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function parseWorkflowEvent(eventData: string, body: { task_id: string; last_chunk_id: string | null }) {
  const payload = unwrapStreamPayload(JSON.parse(eventData));
  if (payload?.type !== 'content') return null;
  if (typeof payload.id === 'string') body.last_chunk_id = payload.id;
  if (!payload.data || typeof payload.data !== 'object' || typeof payload.data.content !== 'string') return null;

  const parsed = JSON.parse(payload.data.content);
  if (parsed.event_type === 'workflow_failed' || parsed.event_type === 'action_failed') {
    return { type: 'failed' as const, message: JSON.stringify(parsed).slice(-800) };
  }
  if (parsed.event_type !== 'dataflow_output' || typeof parsed.content !== 'string') return null;

  const parsedContent = JSON.parse(parsed.content);
  const output = parsedContent.output;
  if (!output || typeof output !== 'object') return null;
  if (output.type === 'dataframe' && Array.isArray(output.data)) {
    if (output.data.length === 0) throw cliWorkflowError('WORKFLOW_RUN', 'Workflow returned empty dataframe output', JSON.stringify(parsed).slice(-800), { taskId: body.task_id });
    return { type: 'output' as const, data: output.data };
  }
  if (output.type === 'scalar') {
    return { type: 'output' as const, data: [flattenScalarOutput(String(parsedContent.output_id ?? ''), output.data)] };
  }
  return null;
}

function unwrapStreamPayload(payload: any): any {
  let current = payload;
  for (let index = 0; index < 3; index += 1) {
    if (current && typeof current === 'object' && current.type === 'content' && current.data && typeof current.data === 'object') return current;
    if (current && typeof current === 'object' && typeof current.content === 'string') {
      try {
        current = JSON.parse(current.content);
        continue;
      } catch {
        break;
      }
    }
    if (current && typeof current === 'object' && current.data && typeof current.data === 'object' && typeof current.data.content === 'string') {
      try {
        const nested = JSON.parse(current.data.content);
        if (nested && typeof nested === 'object' && nested.type === 'content') {
          current = nested;
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }
  return current;
}

function getWorkflowRetryLimit() {
  const raw = (process.env.MAYBEAI_WORKFLOW_MAX_RETRIES || '2').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 2;
}

function isRetryableRunFailure(error: CliError) {
  const haystack = `${error.message}\n${error.hint ?? ''}`.toLowerCase();
  const retrySignals = ['workflow run failed: 429', 'workflow run failed: 500', 'workflow run failed: 502', 'workflow run failed: 503', 'workflow run failed: 504', 'workflow request failed', 'action_failed', 'workflow_failed', 'toolcallerror', 'connection', 'timeout'];
  return retrySignals.some(signal => haystack.includes(signal));
}

function withRetryDetails(error: CliError, taskIds: string[]) {
  const details = [`Task IDs: ${taskIds.join(', ')}`];
  if (!error.hint?.includes('Task IDs:')) details.unshift(error.hint ?? '');
  return cliWorkflowError(error.code, error.message, details.filter(Boolean).join(' | '), { taskId: taskIds[taskIds.length - 1], taskIds, retryCount: Math.max(0, taskIds.length - 1) });
}

function flattenScalarOutput(outputId: string, data: unknown) {
  const result: Record<string, unknown> = {};
  const normalizedOutputId = outputId ? outputId.split(':').at(-1) : '';
  if (normalizedOutputId) result[normalizedOutputId] = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(result, data);
  return result;
}

function getByPath(item: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, segment) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined), item);
}

function cliWorkflowError(code: string, message: string, hint?: string, details?: Record<string, unknown>) {
  const detailHint = details ? Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' | ') : '';
  return new CliError(code, message, [hint, detailHint].filter(Boolean).join(' | '));
}

function toCliWorkflowError(error: unknown, taskId: string) {
  if (error instanceof CliError) return error;
  if (error instanceof Error) return cliWorkflowError('WORKFLOW_RUN', `Workflow request failed: ${error.name}`, error.message, { taskId });
  return cliWorkflowError('WORKFLOW_RUN', 'Workflow request failed', String(error), { taskId });
}
