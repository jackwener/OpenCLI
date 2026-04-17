import { CliError } from '@jackwener/opencli/errors';
import { validateOption } from './profiles.js';

export interface FieldDefinition {
  key: string;
  backendVariable: string;
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

const DEFAULT_IMAGE_OUTPUT = {
  type: 'image',
  multiple: true,
  backendFields: ['url', 'results.url', 'generated_url', 'collage_url', 'output_url'],
};

function field(key: string, backendVariable: string, type: string, description: string, required = false, multiple = false): FieldDefinition {
  return { key, backendVariable, type, description, required, multiple };
}

export const APPS: AppDefinition[] = [
  {
    id: 'try-on',
    title: '单件模特穿搭',
    group: 'model-image',
    summary: '商品图 + 模特图，生成单件商品上身图。',
    sourceRef: 'maybeai-shell-app:try-on',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('person', 'variable:scalar:reference_image_url', 'image', '参考模特图'),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '额外生成要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'change-model',
    title: '换模特',
    group: 'model-image',
    summary: '商品图 + 参考模特图，生成不同模特版本。',
    sourceRef: 'maybeai-shell-app:change-model',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('person', 'variable:scalar:reference_image_url', 'image', '参考模特图'),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '额外生成要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'mix-match',
    title: '多件融合模特穿搭',
    group: 'model-image',
    summary: '多商品图 + 模特图，融合生成一张模特穿搭图。',
    sourceRef: 'maybeai-shell-app:mix-match',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('person', 'variable:scalar:reference_image_url', 'image', '参考模特图'),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '额外生成要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'change-action',
    title: '换动作',
    group: 'model-image',
    summary: '原图 + 动作参考图，裂变生成不同动作图。',
    sourceRef: 'maybeai-shell-app:change-action',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '原图', true),
      field('actions', 'variable:series:reference_image_url', 'image', '动作参考图', false, true),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '额外生成要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'change-product',
    title: '商品替换',
    group: 'product-image',
    summary: '商品图 + 场景参考图，把原场景中的商品替换为目标商品。',
    sourceRef: 'maybeai-shell-app:change-product',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('scene', 'variable:scalar:reference_image_url', 'image', '场景参考图'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '替换要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'change-background',
    title: '换场景',
    group: 'product-image',
    summary: '商品图 + 场景参考图，生成新背景场景。',
    sourceRef: 'maybeai-shell-app:change-background',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('scene', 'variable:scalar:reference_image_url', 'image', '场景参考图'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '场景要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'gen-main',
    title: '商品主图',
    group: 'product-image',
    summary: '商品图 + 模板图，生成电商主图。',
    sourceRef: 'maybeai-shell-app:gen-main',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('template', 'variable:scalar:reference_image_url', 'image', '主图参考模板'),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('platform', 'variable:scalar:platform', 'string', '目标平台'),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '主图要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'gen-scene',
    title: '场景图',
    group: 'product-image',
    summary: '商品图生成场景化商品图。',
    sourceRef: 'maybeai-shell-app:gen-scene',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('platform', 'variable:scalar:platform', 'string', '目标平台'),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '场景要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'gen-details',
    title: '细节特写图',
    group: 'product-image',
    summary: '商品图 + 属性图，生成特写细节图。',
    sourceRef: 'maybeai-shell-app:gen-details',
    fields: [
      field('product_and_attrs', 'variable:dataframe:product_image_url', 'image', '商品图与属性图组合', true, true),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('platform', 'variable:scalar:platform', 'string', '目标平台'),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('prompt', 'variable:scalar:user_description', 'text', '细节要求'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'details-selling-points',
    title: '商品卖点图',
    group: 'product-image',
    summary: '商品图 + 属性图，生成卖点说明图。',
    sourceRef: 'maybeai-shell-app:details-selling-points',
    fields: [
      field('product_and_attrs', 'variable:dataframe:product_image_url', 'image', '商品图与属性图组合', true, true),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('count', 'variable:scalar:image_count', 'number', '生成图片数量'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '卖点要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'add-selling-points',
    title: '加卖点标注',
    group: 'product-image',
    summary: '商品图 + 属性图，给结果图加卖点标注。',
    sourceRef: 'maybeai-shell-app:add-selling-points',
    fields: [
      field('product_and_attrs', 'variable:dataframe:product_image_url', 'image', '商品图与属性图组合', true, true),
      field('prompt', 'variable:scalar:user_description', 'text', '卖点标注要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'gen-multi-angles',
    title: '角度图',
    group: 'product-image',
    summary: '商品图，按多个角度生成展示图。',
    sourceRef: 'maybeai-shell-app:gen-multi-angles',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('person', 'variable:scalar:reference_image_url', 'image', '参考模特图'),
      field('market', 'variable:scalar:target_market', 'string', '目标市场'),
      field('platform', 'variable:scalar:platform', 'string', '目标平台'),
      field('category', 'variable:scalar:category', 'string', '商品类目'),
      field('angles', 'variable:series:angle', 'string[]', '角度列表', true, true),
      field('prompt', 'variable:scalar:user_description', 'text', '展示要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'gen-size-compare',
    title: '尺码对比图',
    group: 'product-image',
    summary: '商品图 + 尺码图，生成尺码对比展示图。',
    sourceRef: 'maybeai-shell-app:gen-size-compare',
    fields: [
      field('product_and_size_chart', 'variable:dataframe:product_image_url', 'image', '商品图与尺码图组合', true, true),
      field('prompt', 'variable:scalar:user_description', 'text', '尺码对比要求'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'creative-image-generation',
    title: '创意素材',
    group: 'product-image',
    summary: '风格参考图 + 文案，生成创意素材图。',
    sourceRef: 'maybeai-shell-app:creative-image-generation',
    fields: [
      field('style', 'variable:scalar:reference_style', 'image', '风格参考图'),
      field('prompt', 'variable:scalar:user_description', 'text', '创意生成要求'),
      field('count', 'variable:scalar:number_of_images', 'number', '生成图片数量'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'pattern-extraction',
    title: '图案提取',
    group: 'image-edit',
    summary: '提取商品图中的图案或印花。',
    sourceRef: 'maybeai-shell-app:pattern-extraction',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('prompt', 'variable:scalar:user_description', 'text', '图案提取要求'),
      field('background', 'variable:scalar:background', 'string', '输出背景'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'pattern-fission',
    title: '图案裂变',
    group: 'image-edit',
    summary: '基于已有图案生成多种新图案。',
    sourceRef: 'maybeai-shell-app:pattern-fission',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '图案原图', true),
      field('similarity', 'variable:scalar:similarity', 'float', '相似度'),
      field('prompt', 'variable:scalar:user_description', 'text', '裂变要求'),
      field('count', 'variable:scalar:number_of_images', 'number', '生成图片数量'),
      field('background', 'variable:scalar:background', 'string', '输出背景'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'scene-fission',
    title: '场景裂变',
    group: 'image-edit',
    summary: '基于单张商品场景图生成多个新场景。',
    sourceRef: 'maybeai-shell-app:scene-fission',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('similarity', 'variable:scalar:similarity', 'float', '相似度'),
      field('prompt', 'variable:scalar:user_description', 'text', '场景裂变要求'),
      field('count', 'variable:scalar:number_of_images', 'number', '生成图片数量'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: '3d-from-2d',
    title: '服装 3D 图',
    group: 'image-edit',
    summary: '单张服装图转 3D 效果图。',
    sourceRef: 'maybeai-shell-app:3d-from-2d',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('prompt', 'variable:scalar:user_description', 'text', '3D 生成要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'product-modification',
    title: '款式裂变',
    group: 'image-edit',
    summary: '商品图生成不同款式变体。',
    sourceRef: 'maybeai-shell-app:product-modification',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('similarity', 'variable:scalar:similarity', 'float', '相似度'),
      field('prompt', 'variable:scalar:user_description', 'text', '款式修改要求'),
      field('count', 'variable:scalar:number_of_images', 'number', '生成图片数量'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'change-color',
    title: '换颜色',
    group: 'image-edit',
    summary: '商品图 + 颜色参考图，生成新颜色版本。',
    sourceRef: 'maybeai-shell-app:change-color',
    fields: [
      field('product', 'variable:scalar:product_image_url', 'image', '商品图', true),
      field('color_ref', 'variable:scalar:reference_image_url', 'image', '颜色参考图'),
      field('prompt', 'variable:scalar:user_description', 'text', '换色要求'),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'remove-background',
    title: '白底/透明图',
    group: 'image-edit',
    summary: '商品图去背景，生成白底或透明图。',
    sourceRef: 'maybeai-shell-app:remove-background',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('prompt', 'variable:scalar:user_description', 'text', '背景处理要求'),
      field('background', 'variable:scalar:background', 'string', '输出背景'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'remove-watermark',
    title: '去水印',
    group: 'image-edit',
    summary: '商品图去水印。',
    sourceRef: 'maybeai-shell-app:remove-watermark',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('ratio', 'variable:scalar:aspect_ratio', 'string', '宽高比'),
      field('resolution', 'variable:scalar:resolution', 'string', '分辨率'),
      field('prompt', 'variable:scalar:user_description', 'text', '去水印要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
  {
    id: 'remove-face',
    title: '模糊人脸/去人脸',
    group: 'image-edit',
    summary: '对商品图中的人脸进行模糊或去除。',
    sourceRef: 'maybeai-shell-app:remove-face',
    fields: [
      field('products', 'variable:series:product_image_url', 'image', '商品图', true, true),
      field('prompt', 'variable:scalar:user_description', 'text', '人脸处理要求'),
      field('engine', 'variable:scalar:llm_model', 'string', '底层图像模型'),
    ],
    output: DEFAULT_IMAGE_OUTPUT,
  },
];

export function listApps() {
  return APPS;
}

export function getApp(appId: string): AppDefinition {
  const app = APPS.find(item => item.id === appId);
  if (!app) throw new CliError('ARGUMENT', `Unknown maybeai-image-app app: ${appId}`, `Supported apps: ${APPS.map(item => item.id).join(', ')}`);
  return app;
}

export function toWorkflowVariables(app: AppDefinition, inputData: Record<string, unknown>) {
  const variables: Array<{ name: string; default_value: unknown }> = [];
  const remaining = new Set(Object.keys(inputData));

  for (const fieldDef of app.fields) {
    const key = fieldDef.key;
    const value = inputData[key];
    remaining.delete(key);
    if (value === undefined || value === null || value === '') {
      if (fieldDef.required) {
        throw new CliError('ARGUMENT', `Missing required field: ${key}`, `Check schema with: opencli maybeai-image-app schema ${app.id}`);
      }
      continue;
    }
    validateCanonicalFieldValue(key, value);
    variables.push({ name: fieldDef.backendVariable, default_value: value });
  }

  if (remaining.size > 0) {
    throw new CliError('ARGUMENT', `Unknown input fields: ${[...remaining].sort().join(', ')}`, `Check schema with: opencli maybeai-image-app schema ${app.id}`);
  }
  return variables;
}

function validateCanonicalFieldValue(fieldKey: string, value: unknown): void {
  if (fieldKey === 'platform') validateOption('platform', value, fieldKey);
  else if (['market', 'country', 'region'].includes(fieldKey)) validateOption('country', value, fieldKey);
  else if (fieldKey === 'category') validateOption('category', value, fieldKey);
  else if (fieldKey === 'angles') validateOption('angle', value, fieldKey);
  else if (fieldKey === 'ratio') validateOption('ratio', value, fieldKey);
  else if (fieldKey === 'resolution') validateOption('resolution', value, fieldKey);
  else if (fieldKey === 'engine') validateOption('model', value, fieldKey);
}
