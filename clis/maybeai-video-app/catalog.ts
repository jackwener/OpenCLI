import { CliError } from '@jackwener/opencli/errors';

export interface FieldDefinition {
  key: string;
  type: string;
  description: string;
  required?: boolean;
  multiple?: boolean;
}

export interface AppDefinition {
  id: string;
  title: string;
  group: string;
  summary: string;
  sourceRef: string;
  fields: FieldDefinition[];
  output: {
    type: string;
    multiple: boolean;
    backendFields: string[];
  };
}

const DEFAULT_VIDEO_OUTPUT = {
  type: 'video',
  multiple: false,
  backendFields: ['url', 'video_url', 'final_video', 'generated_videos'],
};

function field(key: string, type: string, description: string, required = false, multiple = false): FieldDefinition {
  return { key, type, description, required, multiple };
}

export const APPS: AppDefinition[] = [
  {
    id: 'video-remake',
    title: '视频翻拍',
    group: 'reference-video',
    summary: '参考视频 + 商品图/模特图，复刻原视频节奏、镜头与构图并替换为新商品素材。',
    sourceRef: 'tool-api:/v1/tool/video/generate + /api/v1/tool/function_call',
    fields: [
      field('reference_video', 'video', '参考视频', true),
      field('product', 'image', '商品主图', true),
      field('person', 'image', '参考模特图'),
      field('market', 'string', '目标市场'),
      field('platform', 'string', '投放平台'),
      field('category', 'string', '商品类目'),
      field('duration', 'number', '总视频时长（秒）'),
      field('ratio', 'string', '视频宽高比'),
      field('prompt', 'text', '翻拍要求'),
      field('engine', 'string', '底层视频模型'),
    ],
    output: DEFAULT_VIDEO_OUTPUT,
  },
  {
    id: 'product-ad-video',
    title: '一键商品视频',
    group: 'product-video',
    summary: '商品图 + 模特图，先生成分镜脚本，再生成镜头视频并自动拼接。',
    sourceRef: 'key-workflow:2-video-prompt-gen + 4-generate-video-from-image + 5-concat-video',
    fields: [
      field('product', 'image', '商品主图', true),
      field('person', 'image', '参考模特图'),
      field('market', 'string', '目标市场'),
      field('platform', 'string', '投放平台'),
      field('category', 'string', '商品类目'),
      field('style', 'string', '视频风格 / 模板类型'),
      field('duration', 'number', '总视频时长（秒）'),
      field('ratio', 'string', '视频宽高比'),
      field('prompt', 'text', '额外视频要求'),
      field('engine', 'string', '底层视频模型'),
    ],
    output: DEFAULT_VIDEO_OUTPUT,
  },
  {
    id: 'listing-video',
    title: '商品详情视频',
    group: 'product-video',
    summary: '偏商品展示与卖点表达的视频版本，适合电商详情页 / listing 素材。',
    sourceRef: 'key-workflow:2-video-prompt-gen + 4-generate-video-from-image + 5-concat-video',
    fields: [
      field('product', 'image', '商品主图', true),
      field('person', 'image', '参考模特图'),
      field('market', 'string', '目标市场'),
      field('platform', 'string', '投放平台'),
      field('category', 'string', '商品类目'),
      field('style', 'string', '镜头风格'),
      field('duration', 'number', '总视频时长（秒）'),
      field('ratio', 'string', '视频宽高比'),
      field('prompt', 'text', '额外视频要求'),
      field('engine', 'string', '底层视频模型'),
    ],
    output: DEFAULT_VIDEO_OUTPUT,
  },
  {
    id: 'ugc-ad-video',
    title: 'UGC 种草视频',
    group: 'social-video',
    summary: '偏口播、种草、短视频内容风格的商品视频。',
    sourceRef: 'key-workflow:2-video-prompt-gen + 4-generate-video-from-image + 5-concat-video',
    fields: [
      field('product', 'image', '商品主图', true),
      field('person', 'image', '参考模特图'),
      field('market', 'string', '目标市场'),
      field('platform', 'string', '投放平台'),
      field('category', 'string', '商品类目'),
      field('style', 'string', 'UGC 风格'),
      field('duration', 'number', '总视频时长（秒）'),
      field('ratio', 'string', '视频宽高比'),
      field('prompt', 'text', '口播 / 卖点要求'),
      field('engine', 'string', '底层视频模型'),
    ],
    output: DEFAULT_VIDEO_OUTPUT,
  },
  {
    id: 'image-to-video',
    title: '图生视频',
    group: 'video-edit',
    summary: '给定单张图片和运动提示词，直接生成单段视频。',
    sourceRef: 'key-workflow:4-generate-video-from-image',
    fields: [
      field('image', 'image', '输入图片', true),
      field('prompt', 'text', '运动 / 镜头提示词', true),
      field('duration', 'number', '视频时长（秒）'),
      field('ratio', 'string', '视频宽高比'),
      field('engine', 'string', '底层视频模型'),
    ],
    output: DEFAULT_VIDEO_OUTPUT,
  },
];

export function listApps() {
  return APPS;
}

export function getApp(appId: string): AppDefinition {
  const app = APPS.find(item => item.id === appId);
  if (!app) throw new CliError('ARGUMENT', `Unknown maybeai-video-app app: ${appId}`, `Supported apps: ${APPS.map(item => item.id).join(', ')}`);
  return app;
}

export function assertKnownInputFields(appId: string, inputData: Record<string, unknown>) {
  const app = getApp(appId);
  const allowed = new Set(app.fields.map(field => field.key));
  const unknown = Object.keys(inputData).filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CliError('ARGUMENT', `Unknown input fields: ${unknown.sort().join(', ')}`, `Check schema with: opencli maybeai-video-app schema ${app.id}`);
  }
}
