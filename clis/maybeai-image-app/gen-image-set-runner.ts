import { CliError } from '@jackwener/opencli/errors';
import {
  AppFactoryMcpClient,
  extractImageUrl,
  extractJsonPayload,
  getVariable,
  loadAppFactoryWorkflow,
  mapWithConcurrency,
  normalizeJsonLike,
  runToolFlow,
  type JsonRecord,
  type WorkflowVariable,
} from './app-factory-mcp.js';
import {
  IMAGE_SET_COUNT_FIELDS,
  getImageSetTotalCount,
  normalizeImageSetConfig,
  readString,
  readStringArray,
} from './interaction.js';

const IMAGE_GENERATION_TOOL_ID = 'maybe_image_generation__generate_image_from_images';
const IMAGE_GENERATION_CONCURRENCY = 3;

const mainWorkflow = loadAppFactoryWorkflow('gen-image-set/workflows/main.json');
const styleWorkflow = loadAppFactoryWorkflow('gen-image-set/workflows/style.json');
const humanStrategyWorkflow = loadAppFactoryWorkflow('gen-image-set/workflows/human-strategy.json');
const referenceWorkflow = loadAppFactoryWorkflow('gen-image-set/workflows/reference.json');

interface PromptTask {
  final_prompt: string;
  product_image_url?: string;
  app?: string;
  title?: string;
  json?: unknown;
}

export async function runGenImageSet(input: Record<string, unknown>, kwargs: Record<string, unknown>) {
  normalizeImageSetConfig(input);
  if (getImageSetTotalCount(input) < 3) {
    throw new CliError('ARGUMENT', 'gen-image-set requires at least 3 images', 'Use --preset standard or set module counts such as --white-bg-count 1 --scene-count 1 --detail-count 1.');
  }
  const variables = buildGenImageSetVariables(input);
  const client = new AppFactoryMcpClient(kwargs, 'gen-image-set');

  const selectedStylePrompt = readString(input.selected_style_prompt);
  if (!selectedStylePrompt) {
    const styleResults = await runDirectStyleAnalysis(client, variables);
    const style = pickFirstStyle(styleResults);
    if (style) {
      variables.push({ name: 'variable:scalar:selected_style_prompt', default_value: buildSelectedStylePrompt(style, input) });
      variables.push({ name: 'variable:scalar:selected_style_source', default_value: 'trend_analysis' });
    }
  }

  const humanStrategy = await runDirectHumanStrategy(client, variables);
  applyHumanStrategyVariables(variables, humanStrategy);

  const reference = await runDirectReferenceImage(client, variables);
  applyReferenceVariables(variables, reference);

  const images = await runDirectMainImageSet(client, variables);
  return {
    status: 'success',
    app: 'gen-image-set',
    title: '商品套图',
    images,
    resolvedInput: input,
    warnings: [],
  };
}

function buildGenImageSetVariables(input: Record<string, unknown>): WorkflowVariable[] {
  const products = readStringArray(input.products ?? input.product_images);
  if (products.length === 0) throw new CliError('ARGUMENT', 'Missing products', 'Pass --products or include products in --input JSON.');

  const variables: WorkflowVariable[] = [
    { name: 'variable:series:product_image_url', default_value: products },
    { name: 'variable:scalar:platform', default_value: readString(input.platform) },
    { name: 'variable:scalar:target_market', default_value: readString(input.market ?? input.target_market) },
    { name: 'variable:scalar:user_requirements', default_value: readString(input.requirements ?? input.user_requirements ?? input.prompt) },
    { name: 'variable:scalar:scene_human_mode', default_value: readString(input.scene_human_mode) || 'auto' },
    { name: 'variable:scalar:resolution', default_value: readString(input.resolution) || '2K' },
    { name: 'variable:scalar:aspect_ratio', default_value: readString(input.ratio ?? input.aspect_ratio) || 'auto' },
    { name: 'variable:scalar:analysis_llm_model', default_value: readString(input.analysis_model) || 'gemini-3-flash' },
    { name: 'variable:scalar:reference_generation_model', default_value: readString(input.reference_generation_model ?? input.engine) || 'google/gemini-3.1-flash-image-preview' },
    { name: 'variable:scalar:reference_aspect_ratio', default_value: '1:1' },
    { name: 'variable:scalar:reference_resolution', default_value: readString(input.resolution) || '2K' },
    { name: 'variable:scalar:llm_model', default_value: readString(input.engine) || 'google/gemini-3.1-flash-image-preview' },
    { name: 'variable:scalar:selected_style_prompt', default_value: readString(input.selected_style_prompt) },
    { name: 'variable:scalar:selected_style_source', default_value: readString(input.selected_style_source) },
    { name: 'variable:scalar:reference_image_url', default_value: readString(input.reference_image ?? input.reference_image_url) },
    { name: 'variable:scalar:reference_model_seed', default_value: readString(input.reference_model_seed) },
  ];

  for (const key of IMAGE_SET_COUNT_FIELDS) {
    variables.push({ name: `variable:scalar:${key}`, default_value: Number(input[key] ?? 0) });
  }
  return dedupeVariablesKeepLast(variables);
}

async function runDirectStyleAnalysis(client: AppFactoryMcpClient, variables: WorkflowVariable[]): Promise<unknown> {
  const styleVariables = upsertVariable(
    upsertVariable(variables, 'variable:scalar:number_of_styles', 4),
    'variable:scalar:llm_model',
    'gemini-3-flash',
  );
  return runToolFlow({ client, workflow: styleWorkflow, flowId: 'analyze_style_directions', variables: styleVariables });
}

async function runDirectHumanStrategy(client: AppFactoryMcpClient, variables: WorkflowVariable[]): Promise<unknown> {
  return runToolFlow({ client, workflow: humanStrategyWorkflow, flowId: 'analyze_human_reference_strategy', variables });
}

async function runDirectReferenceImage(client: AppFactoryMcpClient, variables: WorkflowVariable[]): Promise<JsonRecord> {
  const usePersonReference = String(getVariable(variables, 'variable:scalar:use_person_reference') ?? '');
  const referenceImageUrl = String(getVariable(variables, 'variable:scalar:reference_image_url') ?? '').trim();

  if (usePersonReference !== 'yes') {
    return {
      reference_image_url: '',
      reference_source: 'not_required',
      effective_model_seed: '',
      person_anchor: '',
      human_presence_policy: '',
    };
  }

  if (referenceImageUrl) {
    const result = await runToolFlow({
      client,
      workflow: referenceWorkflow,
      flowId: 'analyze_user_provided_reference',
      variables,
      outputs: new Map([['series:user_reference_image_urls', [referenceImageUrl]]]),
    });
    return asRecord(extractJsonPayload(result));
  }

  const result = await runToolFlow({ client, workflow: referenceWorkflow, flowId: 'generate_reference_image', variables });
  return {
    reference_image_url: extractImageUrl(result),
    reference_source: 'generated_from_prompt',
    effective_model_seed: String(getVariable(variables, 'variable:scalar:reference_model_seed') ?? ''),
    person_anchor: '',
    human_presence_policy: '',
  };
}

async function runDirectMainImageSet(client: AppFactoryMcpClient, variables: WorkflowVariable[]) {
  const outputs = new Map<string, unknown>();
  const mappingContext = await runToolFlow({ client, workflow: mainWorkflow, flowId: 'normalize_color_mapping_context', variables, outputs });
  outputs.set('scalar:mapping_context', mappingContext);

  const promptPayload = await runToolFlow({ client, workflow: mainWorkflow, flowId: 'generate_prompts_from_product_image', variables, outputs });
  const promptTasks = extractPromptTasks(promptPayload);
  if (promptTasks.length === 0) throw new CliError('WORKFLOW_RUN', '未解析到套图 prompt 任务');

  const finalPromptTasks = promptTasks.map(task => ({
    ...task,
    final_prompt: `${task.final_prompt}\n\nFINAL SAFETY CHECK:\nPreserve the exact reference product. Do not recolor or redesign the product. Keep visible text concise and localized for the target market.`,
  }));

  const imageUrls = buildGenerationImageUrls(variables);
  if (imageUrls.length === 0) throw new CliError('ARGUMENT', '缺少可用于生图的参考图片');

  const model = getVariable(variables, 'variable:scalar:llm_model');
  const aspectRatio = getVariable(variables, 'variable:scalar:aspect_ratio');
  const resolution = getVariable(variables, 'variable:scalar:resolution');
  return mapWithConcurrency(finalPromptTasks, IMAGE_GENERATION_CONCURRENCY, async task => {
    const result = await client.callTool(IMAGE_GENERATION_TOOL_ID, {
      prompt: task.final_prompt,
      image_urls: imageUrls,
      model,
      aspect_ratio: aspectRatio,
      resolution,
    });
    return {
      type: 'image',
      url: extractImageUrl(result),
      title: String(task.title || '生套图'),
      module: String(task.app || ''),
      raw: {
        style_dna: normalizeJsonLike(typeof task.json === 'string' ? task.json : JSON.stringify(task.json ?? {})),
      },
    };
  });
}

function extractPromptTasks(payload: unknown): PromptTask[] {
  const parsed = extractJsonPayload(payload);
  const rows = Array.isArray(parsed) ? parsed : (asRecord(parsed).data as unknown[]);
  if (!Array.isArray(rows)) return [];
  return rows.map(item => {
    const record = asRecord(item);
    return {
      final_prompt: String(record.final_prompt ?? record.prompt ?? ''),
      product_image_url: typeof record.product_image_url === 'string' ? record.product_image_url : undefined,
      app: typeof record.app === 'string' ? record.app : undefined,
      title: typeof record.title === 'string' ? record.title : undefined,
      json: record.json,
    };
  }).filter(item => item.final_prompt);
}

function buildGenerationImageUrls(variables: WorkflowVariable[]): string[] {
  const products = readStringArray(getVariable(variables, 'variable:series:product_image_url'));
  const reference = readString(getVariable(variables, 'variable:scalar:reference_image_url'));
  return [...(reference ? [reference] : []), ...products];
}

function pickFirstStyle(value: unknown): JsonRecord | null {
  const payload = extractJsonPayload(value);
  const record = asRecord(payload);
  const styles = Array.isArray(record.styles) ? record.styles : [];
  return styles.find((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item)) ?? null;
}

function buildSelectedStylePrompt(style: JsonRecord, input: Record<string, unknown>): string {
  return [
    `风格来源：AI爆款风格`,
    `目标平台：${readString(input.platform)}`,
    `目标国家/市场：${readString(input.market ?? input.target_market)}`,
    `tone-tag：${Array.isArray(style.tone_tag) ? style.tone_tag.join('、') : ''}`,
    `视觉重点：${String(style.visual_focus ?? '')}`,
    `文案语气：${String(style.copy_tone ?? '')}`,
    `版式逻辑：${String(style.layout_direction ?? '')}`,
    `色彩方向：${String(style.color_direction ?? '')}`,
    `光影方向：${String(style.lighting_direction ?? '')}`,
    `硬约束：${String(style.prompt_snippet ?? '')}`,
  ].filter(item => !item.endsWith('：')).join(' ');
}

function applyHumanStrategyVariables(variables: WorkflowVariable[], value: unknown): void {
  const record = firstRecord(extractJsonPayload(value));
  upsertInPlace(variables, 'variable:scalar:use_person_reference', String(record.use_person_reference ?? record.usePersonReference ?? 'no'));
  upsertInPlace(variables, 'variable:scalar:scene_person_policy', String(record.scene_person_policy ?? record.scenePersonPolicy ?? ''));
  upsertInPlace(variables, 'variable:scalar:human_presence_policy', String(record.human_presence_policy ?? record.humanPresencePolicy ?? ''));
  upsertInPlace(variables, 'variable:scalar:person_anchor', String(record.person_anchor ?? record.personAnchor ?? ''));
  upsertInPlace(variables, 'variable:scalar:reference_model_seed', String(record.model_seed_description ?? record.reference_model_seed ?? getVariable(variables, 'variable:scalar:reference_model_seed') ?? ''));
  upsertInPlace(variables, 'variable:scalar:reference_image_prompt', String(record.reference_image_prompt ?? ''));
}

function applyReferenceVariables(variables: WorkflowVariable[], value: JsonRecord): void {
  if (typeof value.reference_image_url === 'string') upsertInPlace(variables, 'variable:scalar:reference_image_url', value.reference_image_url);
  if (typeof value.effective_model_seed === 'string') upsertInPlace(variables, 'variable:scalar:reference_model_seed', value.effective_model_seed);
  if (typeof value.person_anchor === 'string' && value.person_anchor) upsertInPlace(variables, 'variable:scalar:person_anchor', value.person_anchor);
  if (typeof value.human_presence_policy === 'string' && value.human_presence_policy) upsertInPlace(variables, 'variable:scalar:human_presence_policy', value.human_presence_policy);
}

function upsertVariable(variables: WorkflowVariable[], name: string, defaultValue: unknown): WorkflowVariable[] {
  return dedupeVariablesKeepLast([...variables, { name, default_value: defaultValue }]);
}

function upsertInPlace(variables: WorkflowVariable[], name: string, defaultValue: unknown): void {
  const index = variables.findIndex(item => item.name === name);
  if (index >= 0) variables[index] = { name, default_value: defaultValue };
  else variables.push({ name, default_value: defaultValue });
}

function dedupeVariablesKeepLast(variables: WorkflowVariable[]): WorkflowVariable[] {
  return [...new Map(variables.map(item => [item.name, item])).values()];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstRecord(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}
