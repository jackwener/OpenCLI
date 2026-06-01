import { CliError } from '@jackwener/opencli/errors';
import {
  AppFactoryMcpClient,
  extractImageUrl,
  extractJsonPayload,
  mapWithConcurrency,
  type JsonRecord,
} from './app-factory-mcp.js';
import { readString, readStringArray } from './interaction.js';

const IMAGE_TOOL_ID = 'maybe_image_generation__generate_image_from_images';
const LLM_TOOL_ID = 'fastest_llm__llm_multimodal_invoke';
const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
const DEFAULT_LLM_MODEL = 'gemini-3-flash';
const DEFAULT_RESOLUTION = '2K';
const IMAGE_GENERATION_CONCURRENCY = 3;

const PRODUCT_ANALYSIS_PROMPT = `你是电商视觉商品分析师。根据用户上传的商品图片和商品信息，提炼后续生图必须遵守的商品事实。只输出 JSON，不要输出 Markdown。商品颜色、材质、结构、图案、Logo、包装、形状、尺寸感等必须来自商品图和商品信息，不允许被参考图风格色影响。`;
const REFERENCE_ANALYSIS_PROMPT = `你是电商参考图分析师。批量分析用户上传的参考图如何被复刻为新的商品图。只输出 JSON，不要输出 Markdown。按输入图片顺序逐张分析，输出 references 数组，每个元素必须包含 reference_index、reference_format、modules、generation_guidance。只有长边/短边 > 2:1 的图片，才允许判断为 collage_set 或 long_detail_page。`;
const MODEL_DNA_ANALYSIS_PROMPT = `你是电商图像生成中的人物一致性分析师。根据用户上传的模特图，提取用于后续多张图片保持同一模特的视觉锚点。只输出 JSON，不要输出 Markdown。`;

interface ReferenceImage {
  index: number;
  url: string;
  aspectRatio: string;
  dimensions: { width: number; height: number };
}

interface GenerationTask {
  taskLabel: string;
  reference: ReferenceImage;
  referenceAnalysis: unknown;
  module: JsonRecord | null;
  aspectRatio: string;
}

export async function runReplicaListingImage(input: Record<string, unknown>, kwargs: Record<string, unknown>) {
  const productImages = readProductImages(input);
  const referenceImages = readStringArray(input.reference_images ?? input.references);
  const modelImages = readStringArray(input.model_images ?? input.models);
  const productInfo = readString(input.product_description ?? input.prompt);
  const targetMarket = readString(input.market ?? input.target_market);
  const referenceType = readString(input.reference_type) || 'layout_reference';
  const model = readString(input.engine) || DEFAULT_IMAGE_MODEL;

  if (productImages.length === 0) throw new CliError('ARGUMENT', 'Missing product_images', 'Pass --product-images or product_images in --input JSON.');
  if (referenceImages.length === 0) throw new CliError('ARGUMENT', 'Missing reference_images', 'Pass --reference-images or reference_images in --input JSON.');

  const client = new AppFactoryMcpClient(kwargs, 'replica-listing-image');
  const productImageUrls = productImages.map(item => item.url);

  let modelDna: unknown = null;
  if (modelImages.length > 0) {
    modelDna = extractJsonPayload(await client.callTool(LLM_TOOL_ID, {
      model: DEFAULT_LLM_MODEL,
      prompt: MODEL_DNA_ANALYSIS_PROMPT,
      message: `请分析 ${modelImages.length} 张模特图，提取用于后续多张电商图保持同一模特的视觉锚点。`,
      images: modelImages,
    }));
  }

  const productAnalysis = extractJsonPayload(await client.callTool(LLM_TOOL_ID, {
    model: DEFAULT_LLM_MODEL,
    prompt: PRODUCT_ANALYSIS_PROMPT,
    message: buildProductAnalysisMessage(productInfo, targetMarket),
    images: productImageUrls,
  }));

  const references = referenceImages.map((url, index) => ({
    index,
    url,
    dimensions: { width: 1, height: 1 },
    aspectRatio: readString(input.ratio ?? input.aspect_ratio) || 'auto',
  }));

  const referenceAnalysisResult = await client.callTool(LLM_TOOL_ID, {
    model: DEFAULT_LLM_MODEL,
    prompt: REFERENCE_ANALYSIS_PROMPT,
    message: buildReferenceBatchAnalysisMessage(references),
    images: referenceImages,
  });
  const batchReferenceAnalyses = extractReferenceAnalyses(referenceAnalysisResult, references);
  const tasks = references.flatMap((reference, index) => buildReferenceGenerationTasks(reference, batchReferenceAnalyses[index]));
  if (tasks.length === 0) throw new CliError('WORKFLOW_RUN', '未解析到参考生套图生成任务');

  const images = await mapWithConcurrency(tasks, IMAGE_GENERATION_CONCURRENCY, async task => {
    const prompt = buildFinalPrompt({
      referenceType,
      productAnalysis,
      referenceAnalysis: task.referenceAnalysis,
      productInfo,
      modelDna,
      targetMarket,
      reference: task.reference,
      module: task.module,
    });
    const result = await client.callTool(IMAGE_TOOL_ID, {
      model,
      image_urls: [...productImageUrls, ...modelImages, task.reference.url],
      prompt,
      aspect_ratio: task.aspectRatio,
      resolution: readString(input.resolution) || DEFAULT_RESOLUTION,
    });
    return {
      type: 'image',
      url: extractImageUrl(result),
      title: task.taskLabel,
      module: task.module ? `module_${String(task.module.index ?? '')}` : 'reference',
    };
  });

  return {
    status: 'success',
    app: 'replica-listing-image',
    title: '参考生套图',
    images,
    resolvedInput: input,
    warnings: [],
  };
}

function readProductImages(input: Record<string, unknown>): Array<{ image_type: string; url: string; description?: string }> {
  const raw = input.product_images ?? input.products;
  if (Array.isArray(raw)) {
    return raw.flatMap((item, index) => {
      if (typeof item === 'string') return [{ image_type: productImageType(index), url: item }];
      if (item && typeof item === 'object' && typeof (item as JsonRecord).url === 'string') {
        return [{
          image_type: String((item as JsonRecord).image_type ?? productImageType(index)),
          url: String((item as JsonRecord).url),
          description: typeof (item as JsonRecord).description === 'string' ? String((item as JsonRecord).description) : undefined,
        }];
      }
      return [];
    });
  }
  return readStringArray(raw).map((url, index) => ({ image_type: productImageType(index), url }));
}

function productImageType(index: number): string {
  return ['white_bg', 'front', 'back', 'side', 'scene'][index] ?? 'more';
}

function buildProductAnalysisMessage(productInfo: string, targetMarket: string): string {
  return [
    '请分析这些商品图和商品信息。',
    '<商品信息>',
    productInfo,
    `目标市场：${targetMarket}`,
    '</商品信息>',
    '输出只用于后续电商图片生成，请把商品本身的颜色和可见细节作为硬约束。',
  ].join('\n');
}

function buildReferenceBatchAnalysisMessage(references: ReferenceImage[]): string {
  return [
    `请按输入顺序一次性分析 ${references.length} 张参考图。`,
    '<参考图列表>',
    ...references.map((reference, index) => `reference_index: ${index}；画幅比例：${reference.aspectRatio}；长边/短边：1.00`),
    '</参考图列表>',
    '重要规则：CLI 未读取图片真实尺寸时，默认按 single_image 输出；如果画面明显为套图或长详情页，可在 modules 中拆解。',
  ].join('\n');
}

function extractReferenceAnalyses(result: unknown, references: ReferenceImage[]): unknown[] {
  const parsed = extractJsonPayload(result);
  const record = asRecord(parsed);
  const rawReferences = Array.isArray(record.references) ? record.references : null;
  if (!rawReferences) return references.map(reference => buildSingleReferenceAnalysis(reference, '未解析到批量参考图分析结果，按单图兜底。'));
  return references.map((reference, index) => rawReferences[index] ?? buildSingleReferenceAnalysis(reference, '当前参考图缺少批量分析结果，按单图兜底。'));
}

function buildReferenceGenerationTasks(reference: ReferenceImage, analysis: unknown): GenerationTask[] {
  const record = asRecord(analysis);
  const format = asRecord(record.reference_format);
  const formatType = String(format.type ?? 'single_image');
  const modules = Array.isArray(record.modules) ? record.modules.filter((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
  if ((formatType === 'collage_set' || formatType === 'long_detail_page') && modules.length > 1) {
    return modules.map((module, index) => ({
      taskLabel: `参考图 ${reference.index + 1} - 模块 ${index + 1}`,
      reference,
      referenceAnalysis: analysis,
      module,
      aspectRatio: normalizeRatio(module.target_aspect_ratio) || (formatType === 'long_detail_page' ? '4:5' : '1:1'),
    }));
  }
  return [{
    taskLabel: `参考图 ${reference.index + 1}`,
    reference,
    referenceAnalysis: analysis,
    module: null,
    aspectRatio: normalizeRatio(record.aspect_ratio) || reference.aspectRatio || 'auto',
  }];
}

function buildSingleReferenceAnalysis(reference: ReferenceImage, reason: string): JsonRecord {
  return {
    reference_index: reference.index,
    aspect_ratio: reference.aspectRatio,
    reference_format: { type: 'single_image', reason, module_count: 1, confidence: 1 },
    modules: [{ index: 1, region: 'full_canvas', target_aspect_ratio: reference.aspectRatio }],
  };
}

function buildFinalPrompt(params: {
  referenceType: string;
  productAnalysis: unknown;
  referenceAnalysis: unknown;
  productInfo: string;
  modelDna: unknown;
  targetMarket: string;
  reference: ReferenceImage;
  module?: unknown;
}): string {
  const modeInstruction = params.referenceType === 'product_replace'
    ? '参考类型：商品替换。保留参考图的整体风格、排版、构图、光线、背景气质、文字位置和视觉节奏，将参考图中的旧商品替换为当前用户商品。'
    : '参考类型：参考排版。只参考参考图的空间分区、图文排版、视觉层级、留白逻辑、字体气质、图片类型组合。';
  const moduleInstruction = params.module
    ? `当前只生成参考图中自动拆出的一个独立模块，不要生成整张长图或整张拼接套图。\n<当前生成模块>\n${JSON.stringify(params.module, null, 2)}\n</当前生成模块>`
    : '按参考图整体生成一张完整电商图。';
  return [
    '生成一张高质量电商套图效果图。',
    modeInstruction,
    moduleInstruction,
    `目标市场：${params.targetMarket}。所有新生成的可读文案都必须使用目标市场对应的主流电商营销语言。`,
    '硬约束：当前商品的颜色、材质、结构、包装、图案、Logo、形状和可见细节必须严格来自商品图与商品分析，不能被参考图配色或风格染色。',
    `输出画幅比例：${params.reference.aspectRatio}。`,
    params.modelDna ? `人物一致性硬约束：${JSON.stringify(params.modelDna)}` : '用户未提供额外模特图；参考图有人物时可参考姿势和构图，没有人物时不要凭空新增人物。',
    '<商品信息>',
    params.productInfo,
    '</商品信息>',
    '<商品分析>',
    JSON.stringify(params.productAnalysis, null, 2),
    '</商品分析>',
    '<参考图分析>',
    JSON.stringify(params.referenceAnalysis, null, 2),
    '</参考图分析>',
    '质量要求：商业摄影质感，主体清晰，细节准确，文字不乱码，排版完整，边缘干净，不要多余水印。',
  ].join('\n\n');
}

function normalizeRatio(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace('：', ':');
  return /^(auto|\d+\s*:\s*\d+)$/.test(normalized) ? normalized.replace(/\s+/g, '') : '';
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
