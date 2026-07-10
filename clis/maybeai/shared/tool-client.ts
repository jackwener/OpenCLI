import { CliError } from '@jackwener/opencli/errors';
import { firstString, readWorkflowOptions, type WorkflowOptions } from './options.js';

const DEFAULT_TOOL_TIMEOUT_MS = 300_000;
const DEFAULT_FASTEST_API_URL = 'https://api.fastest.ai';

export interface ToolClientOptions extends WorkflowOptions {
  fastestApiUrl: string;
  organizationId?: string;
  app: string;
}

export interface MCPContentItem {
  type: string;
  text?: string;
}

export interface MCPRawResponse {
  content?: MCPContentItem[];
  isError?: boolean;
}

export interface MCPToolResult {
  content?: MCPContentItem[];
  structuredContent?: Record<string, unknown> | null;
  isError?: boolean;
  error?: string | null;
  success?: boolean;
  message?: string;
  result?: Record<string, unknown> | null;
  raw_response?: MCPRawResponse | null;
}

export interface ScriptShot {
  shot_id: string;
  timestamp?: { in_point?: number; out_point?: number };
  sequence?: string;
  narrative_context?: string;
  duration_sec?: number;
  visual_prompt?: {
    subject?: string;
    environment?: string;
    action?: string;
    camera_movement?: string;
    lighting?: string;
    physics_simulation?: string;
    angle?: string;
  };
  technical_specs?: {
    aspect_ratio?: string;
    fps?: number;
    seed?: number;
    consistency_anchor?: string;
  };
  audio_prompt?: string;
  video_url?: string;
}

export interface ScriptResult {
  script: string;
  main_image_prompt: string;
  shots: ScriptShot[];
}

export function readToolClientOptions(kwargs: Record<string, unknown>, app: string): ToolClientOptions {
  const workflowOptions = readWorkflowOptions(kwargs);
  const fastestApiUrl = firstString(kwargs['fastest-api-url'], process.env.MAYBEAI_FASTEST_API_URL, process.env.FASTEST_API_URL, process.env.NEXT_PUBLIC_FASTEST_API_URL) ?? DEFAULT_FASTEST_API_URL;
  const organizationId = firstString(kwargs['organization-id'], process.env.MAYBEAI_ORGANIZATION_ID, process.env.ORGANIZATION_ID);
  return {
    ...workflowOptions,
    fastestApiUrl: fastestApiUrl.replace(/\/+$/, ''),
    organizationId,
    app,
  };
}

export class ToolClient {
  constructor(private readonly options: ToolClientOptions) {}

  async generateVideoScript(params: {
    taskId: string;
    productImages: string[];
    referenceImages: string[];
    referenceVideos: string[];
    userInput: string;
    seconds: number;
    mode: 'copy' | 'creative';
  }): Promise<ScriptResult> {
    const response = await fetch(`${this.options.fastestApiUrl}/v1/tool/video/generate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        task_id: params.taskId,
        product_info: '',
        product_images: [...params.productImages, ...params.referenceImages],
        reference_images: [],
        user_input: params.userInput,
        seconds: params.seconds,
        reference_videos: params.referenceVideos,
        mode: params.mode,
      }),
      signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
    });
    const json = await readJsonResponse(response, 'Video script generation failed');
    return {
      script: typeof json.script === 'string' ? json.script : '',
      main_image_prompt: typeof json.main_image_prompt === 'string' ? json.main_image_prompt : '',
      shots: Array.isArray(json.shots) ? json.shots as ScriptShot[] : [],
    };
  }

  async callMcpTool(taskId: string, toolId: string, toolArgs: Record<string, unknown>): Promise<MCPToolResult> {
    const body: Record<string, unknown> = {
      task_id: taskId,
      app: this.options.app,
      tool_id: toolId,
      tool_args: cleanToolArgs(toolArgs),
    };
    if (this.options.organizationId) body.organization_id = this.options.organizationId;

    const response = await fetch(`${this.options.baseUrl}/api/v1/tool/function_call`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
    });
    const result = await readJsonResponse(response, `MCP tool call failed: ${toolId}`) as MCPToolResult;
    const errorMessage = resolveMCPError(result, `MCP tool call failed: ${toolId}`);
    if (!response.ok || errorMessage) throw new CliError('WORKFLOW_RUN', errorMessage || `MCP tool call failed: ${toolId}`);
    return result;
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.auth.token}`,
      'user-id': this.options.auth.userId,
    };
  }
}

export function parseMCPImageUrl(result: MCPToolResult): string {
  return parseMCPUrl(result, ['url', 'image_url', 'output_url'], 'No image URL returned from MCP tool');
}

export function parseMCPVideoUrl(result: MCPToolResult): string {
  return parseMCPUrl(result, ['video_url', 'url'], 'No video URL returned from MCP tool');
}

function parseMCPUrl(result: MCPToolResult, fieldNames: string[], fallbackErrorMessage: string): string {
  const errorMessage = resolveMCPError(result, fallbackErrorMessage);
  if (errorMessage) throw new CliError('WORKFLOW_RUN', errorMessage);

  const payload = getMCPPayload(result);
  if (payload) {
    for (const fieldName of fieldNames) {
      const value = payload[fieldName];
      if (typeof value === 'string' && value) return value;
    }
  }

  for (const item of getMCPContentItems(result)) {
    if (item.type !== 'text' || !item.text) continue;
    const parsed = parseMCPTextContent(item.text);
    if (parsed) {
      for (const fieldName of fieldNames) {
        const value = parsed[fieldName];
        if (typeof value === 'string' && value) return value;
      }
      continue;
    }
    if (/^https?:\/\//.test(item.text)) return item.text;
  }

  throw new CliError('WORKFLOW_RUN', fallbackErrorMessage);
}

function resolveMCPError(result: MCPToolResult, fallbackMessage: string): string | null {
  if (result.isError || result.raw_response?.isError) return result.error || result.message || fallbackMessage;
  if (result.success === false) return result.error || result.message || fallbackMessage;
  const payload = getMCPPayload(result);
  if (payload?.success === false) {
    if (typeof payload.error === 'string' && payload.error) return payload.error;
    if (typeof payload.message === 'string' && payload.message) return payload.message;
    return fallbackMessage;
  }
  return null;
}

function getMCPPayload(result: MCPToolResult): Record<string, unknown> | null {
  if (result.result && typeof result.result === 'object') return result.result;
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  for (const item of getMCPContentItems(result)) {
    if (item.type !== 'text' || !item.text) continue;
    const parsed = parseMCPTextContent(item.text);
    if (parsed) return parsed;
  }
  return null;
}

function getMCPContentItems(result: MCPToolResult): MCPContentItem[] {
  return [...(result.raw_response?.content ?? []), ...(result.content ?? [])];
}

function parseMCPTextContent(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanToolArgs(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

async function readJsonResponse(response: Response, message: string) {
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new CliError('WORKFLOW_RUN', `${message}: ${response.status}`, text.slice(0, 1000));
  }
  if (!response.ok) throw new CliError('WORKFLOW_RUN', `${message}: ${response.status}`, JSON.stringify(parsed).slice(0, 1000));
  return parsed;
}
