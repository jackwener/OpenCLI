import { CliError } from '@jackwener/opencli/errors';
import {
  AppFactoryMcpClient,
  extractImageUrl,
  extractJsonPayload,
  extractText,
  type JsonRecord,
} from './app-factory-mcp.js';
import { readString, readStringArray } from './interaction.js';

type ReferenceImageRole = 'product' | 'model' | 'scene' | 'color' | 'layout' | 'style' | 'unknown';
type ReferenceSingleImageIntent = 'replace_model' | 'replace_product' | 'replace_scene' | 'replace_color' | 'mixed' | 'unknown';

interface ReferenceSingleImageAsset {
  url: string;
  description: string;
  role: ReferenceImageRole;
}

interface ReferenceSingleImageIntentPlan {
  intent: ReferenceSingleImageIntent;
  intent_reason: string;
  image_roles: Array<{
    image_index: number;
    role: ReferenceImageRole;
    source_label: string;
    role_reason: string;
  }>;
  product_truth_images: number[];
  model_identity_images: number[];
  scene_reference_images: number[];
  color_reference_images: number[];
  action_reference_images: number[];
  change_instructions: string[];
  preserve_instructions: string[];
  conflict_instructions: string[];
}

const IMAGE_TOOL_ID = 'maybe_image_generation__generate_image_from_images';
const LLM_TOOL_ID = 'fastest_llm__llm_multimodal_invoke';
const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
const DEFAULT_LLM_MODEL = 'gemini-3-flash';
const DEFAULT_ASPECT_RATIO = 'auto';
const DEFAULT_RESOLUTION = '2K';

const APP_PROMPT =
  '参考生单图：根据商品图和参考图生成一张高质量电商图片。必须先识别所有图片角色和用户更换意图，再判断是换模特、换商品、换场景还是换颜色；按用户要求执行，没有明确要求时根据入参和图片角色推断。商品图是商品真实来源，必须保持同一 SKU 的结构、材质、版型、图案、Logo、包装、边界和真实颜色一致。参考模特图只提供人物身份、姿态或动作参考；如果动作与商品结构冲突，必须按商品物理结构调整动作。参考场景图只提供背景、构图、光线和空间氛围。参考颜色图只提供非商品层配色或用户明确要求可改色的区域，不能污染商品本体真实颜色。最终只输出一张图。';

const PROMPT_PLANNER_SYSTEM_PROMPT = [
  '你是电商图像生成任务的提示词规划器。',
  '根据 app 的任务说明、用户补充要求、图片角色和视觉内容，生成真正用于图像生成的最终 prompt。',
  '最终 prompt 必须明确哪些图片是商品真值，哪些图片提供模特、场景、颜色、排版或风格参考；只改变用户要求改变的部分。',
  '参考生单图中商品一致性优先级最高：必须保留同一 SKU 的结构、版型、缝线、边界、五金、Logo 位置、材质层级和真实颜色。',
  '动作一致性必须服从商品物理结构；如果商品没有口袋、把手、支撑点、开合点或其他可接触结构，就不能生成依赖这些结构的动作。',
  '如果用户要求换场景，只改背景、环境、空间气质和布光；如果用户要求换颜色，只改允许变更的配色区域，不要覆盖商品本体、印刷、Logo 或结构色。',
  '只输出最终 prompt 文本，不要 Markdown、JSON、标题、解释或分析过程。最终 prompt 控制在 1000 字以内。',
].join('\n');

const MERGE_ORDER: Array<{ imageType: string; description: string; role: ReferenceImageRole }> = [
  { imageType: 'front_image', description: '商品图-产品细节图1', role: 'product' },
  { imageType: 'back_image', description: '商品图-产品细节图2', role: 'product' },
  { imageType: 'side_image', description: '商品图-产品细节图3', role: 'product' },
  { imageType: 'detailed_image', description: '商品图-产品细节图4', role: 'product' },
  { imageType: 'reference_color_image', description: '参考颜色', role: 'color' },
  { imageType: 'reference_modle_image', description: '参考模特', role: 'model' },
  { imageType: 'reference_scene_image', description: '参考场景或排版', role: 'scene' },
];

export async function runGenReference(input: Record<string, unknown>, kwargs: Record<string, unknown>) {
  const assets = buildMergedAssets(input);
  if (assets.filter(asset => asset.role === 'product').length === 0) {
    throw new CliError('ARGUMENT', 'Missing product_images', 'Pass --product-images or product_images in --input JSON.');
  }
  if (assets.filter(asset => asset.role !== 'product').length === 0) {
    throw new CliError('ARGUMENT', 'Missing reference_images', 'Pass --reference-images or reference_images in --input JSON.');
  }

  const client = new AppFactoryMcpClient(kwargs, 'gen-reference-v3');
  const userPrompt = readString(input.prompt ?? input.user_description);
  const intentPlan = await analyzeIntent(client, assets, userPrompt);
  const promptSeed = buildPromptSeed(intentPlan, userPrompt);
  const finalPrompt = appendSafetyPrompt(await generateFinalPrompt(client, assets, promptSeed));

  const result = await client.callTool(IMAGE_TOOL_ID, {
    image_urls: assets.map(item => item.url),
    prompt: finalPrompt,
    model: readString(input.engine) || DEFAULT_IMAGE_MODEL,
    aspect_ratio: readString(input.ratio ?? input.aspect_ratio) || DEFAULT_ASPECT_RATIO,
    resolution: readString(input.resolution) || DEFAULT_RESOLUTION,
  });
  const url = extractImageUrl(result);
  if (!url) throw new CliError('WORKFLOW_RUN', '已调用生图工具，但未解析到 image url', JSON.stringify(result).slice(0, 1000));

  return {
    status: 'success',
    app: 'gen-reference',
    title: '参考生单图',
    images: [{ type: 'image', url, title: '参考生单图' }],
    resolvedInput: input,
    prompt: finalPrompt,
    intentPlan,
    warnings: [],
  };
}

async function analyzeIntent(client: AppFactoryMcpClient, images: ReferenceSingleImageAsset[], userPrompt: string): Promise<ReferenceSingleImageIntentPlan> {
  const result = await client.callTool(LLM_TOOL_ID, {
    model: DEFAULT_LLM_MODEL,
    prompt: '你是参考生单图的意图路由与图片角色分析器。请输出结构化 JSON。',
    message: buildIntentMessage(images, userPrompt),
    images: images.map(image => image.url),
  });
  const plan = normalizePlan(extractJsonPayload(result));
  if (plan.image_roles.length > 0) return plan;
  return {
    ...plan,
    image_roles: images.map((image, index) => ({
      image_index: index,
      role: image.role,
      source_label: image.description,
      role_reason: 'fallback from structured input',
    })),
  };
}

async function generateFinalPrompt(client: AppFactoryMcpClient, images: ReferenceSingleImageAsset[], promptSeed: string): Promise<string> {
  const result = await client.callTool(LLM_TOOL_ID, {
    model: DEFAULT_LLM_MODEL,
    prompt: PROMPT_PLANNER_SYSTEM_PROMPT,
    message: [
      '<app_prompt>',
      APP_PROMPT,
      '</app_prompt>',
      '<prompt_seed>',
      promptSeed,
      '</prompt_seed>',
      '<images>',
      ...images.map((image, index) => `图片${index + 1}: ${image.description}; role=${image.role}; url=${image.url}`),
      '</images>',
    ].join('\n'),
    images: images.map(image => image.url),
  });
  const prompt = extractPromptText(result);
  if (!prompt) throw new CliError('WORKFLOW_RUN', 'prompt 优化失败', JSON.stringify(result).slice(0, 1000));
  return prompt;
}

function buildMergedAssets(input: Record<string, unknown>): ReferenceSingleImageAsset[] {
  const productRows = readStructuredRows(input.product_images ?? input.products, 'product');
  const referenceRows = readStructuredRows(input.reference_images ?? input.references, 'reference');
  const allRows = [...productRows, ...referenceRows];
  const urlByType = new Map<string, string>();
  for (const row of allRows) {
    if (!urlByType.has(row.image_type)) urlByType.set(row.image_type, row.url);
  }
  return MERGE_ORDER.flatMap(config => {
    const url = urlByType.get(config.imageType);
    return url ? [{ url, description: config.description, role: config.role }] : [];
  });
}

function readStructuredRows(value: unknown, kind: 'product' | 'reference'): Array<{ image_type: string; url: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (typeof item === 'string' && item.trim()) return [{ image_type: imageTypeFor(kind, index), url: item.trim() }];
      if (item && typeof item === 'object' && typeof (item as JsonRecord).url === 'string') {
        return [{
          image_type: String((item as JsonRecord).image_type ?? imageTypeFor(kind, index)),
          url: String((item as JsonRecord).url).trim(),
        }];
      }
      return [];
    }).filter(item => /^https?:\/\//i.test(item.url));
  }
  return readStringArray(value)
    .map((url, index) => ({ image_type: imageTypeFor(kind, index), url }))
    .filter(item => /^https?:\/\//i.test(item.url));
}

function imageTypeFor(kind: 'product' | 'reference', index: number): string {
  const productTypes = ['front_image', 'back_image', 'side_image', 'detailed_image'];
  const referenceTypes = ['reference_color_image', 'reference_modle_image', 'reference_scene_image'];
  const types = kind === 'product' ? productTypes : referenceTypes;
  return types[Math.min(index, types.length - 1)];
}

function buildIntentMessage(images: ReferenceSingleImageAsset[], userPrompt: string): string {
  return [
    '请分析这些图片与用户要求，判断参考生单图的更换意图，并给出图片角色和冲突约束。',
    '<app_prompt>',
    APP_PROMPT,
    '</app_prompt>',
    '<user_prompt>',
    userPrompt.trim() || '无',
    '</user_prompt>',
    '<images>',
    ...images.map((image, index) => `image_index: ${index}；source_label: ${image.description}；role_hint: ${image.role}；url: ${image.url}`),
    '</images>',
    '必须识别所有图片，并严格区分商品图、模特图、场景图、颜色图、排版图或风格图。',
    '商品图永远是商品真值来源，必须优先保持同一 SKU 的结构、版型、缝线、边界、五金、Logo 位置、材质层级和真实颜色一致。',
    '模特图只提供人物身份、姿态、动作、服装关系与一致性锚点；如果动作与商品结构冲突，必须按商品物理结构修正动作。',
    '场景图只提供背景、空间气质、构图和光线，不得覆盖商品真值。颜色图只影响非商品层配色或用户明确允许改色的区域，不得污染商品本体真实颜色。',
    '只输出 JSON，不要 Markdown，不要解释。JSON 必须包含 intent、intent_reason、image_roles、product_truth_images、model_identity_images、scene_reference_images、color_reference_images、action_reference_images、change_instructions、preserve_instructions、conflict_instructions。',
  ].join('\n');
}

function buildPromptSeed(plan: ReferenceSingleImageIntentPlan, userPrompt: string): string {
  return [
    '请根据以下分析结果生成最终参考生单图 prompt。',
    '<用户要求>',
    userPrompt.trim() || '无',
    '</用户要求>',
    `<更换意图>${plan.intent}</更换意图>`,
    `<意图说明>${plan.intent_reason || '无'}</意图说明>`,
    `<商品真值图片>${formatIndexList(plan.product_truth_images)}</商品真值图片>`,
    `<模特一致性图片>${formatIndexList(plan.model_identity_images)}</模特一致性图片>`,
    `<场景参考图片>${formatIndexList(plan.scene_reference_images)}</场景参考图片>`,
    `<颜色参考图片>${formatIndexList(plan.color_reference_images)}</颜色参考图片>`,
    `<动作参考图片>${formatIndexList(plan.action_reference_images)}</动作参考图片>`,
    '生成最终 prompt 时必须遵守：商品一致性 > 模特一致性 > 场景一致性 > 颜色参考。只更换用户要求更换的部分，所有动作必须服从商品物理结构。',
    '<保留约束>',
    ...(plan.preserve_instructions.length ? plan.preserve_instructions : ['保持商品真值、人物锚点、参考结构与商业可用性。']).map(item => `- ${item}`),
    '</保留约束>',
    '<更换约束>',
    ...(plan.change_instructions.length ? plan.change_instructions : ['根据用户意图只更换被要求更换的部分。']).map(item => `- ${item}`),
    '</更换约束>',
    '<冲突处理>',
    ...(plan.conflict_instructions.length ? plan.conflict_instructions : ['如果参考动作与商品结构冲突，按商品结构修正动作。']).map(item => `- ${item}`),
    '</冲突处理>',
  ].join('\n');
}

function appendSafetyPrompt(prompt: string): string {
  return `${prompt.trim()}\n\n最终动作安全校验优先级最高：如果画面涉及手插兜或手部贴近裤装，手只能对齐真实侧袋或真实后袋的可见口袋开口，并且必须与该侧手同侧、同高度、开口方向匹配；手掌和手指只能落在口袋开口与袋布覆盖范围内。禁止把手放入或指向拉链、前中缝、裆部、裤腰下方、下摆缝、假门襟、装饰缝、图案缝或不存在的口袋位置。如果无法满足这些条件，必须放弃插兜，改成自然放松但不僵硬的非插兜动作。`;
}

function extractPromptText(value: unknown): string {
  const payload = extractJsonPayload(value);
  const direct = findStringField(payload, ['prompt', 'generated_prompt', 'final_prompt']);
  if (direct) return direct;
  return extractText(value);
}

function findStringField(value: unknown, fields: string[]): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as JsonRecord;
  for (const field of fields) {
    if (typeof record[field] === 'string' && String(record[field]).trim()) return String(record[field]).trim();
  }
  return '';
}

function normalizePlan(value: unknown): ReferenceSingleImageIntentPlan {
  const payload = asRecord(value);
  return {
    intent: normalizeIntent(payload.intent),
    intent_reason: readString(payload.intent_reason),
    image_roles: Array.isArray(payload.image_roles) ? payload.image_roles.flatMap(normalizeImageRole) : [],
    product_truth_images: normalizeIndexList(payload.product_truth_images),
    model_identity_images: normalizeIndexList(payload.model_identity_images),
    scene_reference_images: normalizeIndexList(payload.scene_reference_images),
    color_reference_images: normalizeIndexList(payload.color_reference_images),
    action_reference_images: normalizeIndexList(payload.action_reference_images),
    change_instructions: normalizeStringList(payload.change_instructions),
    preserve_instructions: normalizeStringList(payload.preserve_instructions),
    conflict_instructions: normalizeStringList(payload.conflict_instructions),
  };
}

function normalizeImageRole(value: unknown): ReferenceSingleImageIntentPlan['image_roles'] {
  const record = asRecord(value);
  if (!record) return [];
  return [{
    image_index: typeof record.image_index === 'number' ? record.image_index : 0,
    role: normalizeRole(record.role),
    source_label: readString(record.source_label),
    role_reason: readString(record.role_reason),
  }];
}

function normalizeIntent(value: unknown): ReferenceSingleImageIntent {
  return ['replace_model', 'replace_product', 'replace_scene', 'replace_color', 'mixed', 'unknown'].includes(String(value))
    ? value as ReferenceSingleImageIntent
    : 'unknown';
}

function normalizeRole(value: unknown): ReferenceImageRole {
  return ['product', 'model', 'scene', 'color', 'layout', 'style', 'unknown'].includes(String(value))
    ? value as ReferenceImageRole
    : 'unknown';
}

function normalizeIndexList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)) : [];
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : [];
}

function formatIndexList(indices: number[]): string {
  return indices.length ? indices.map(index => `图片${index + 1}`).join('、') : '无';
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
