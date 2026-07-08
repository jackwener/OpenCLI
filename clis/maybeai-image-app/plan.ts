import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { INPUT_ARGS } from './common.js';
import { buildImageAppPlan, RUN_EXTRA_ARGS } from './planner.js';
import {
  buildNeedsInputPlan,
  buildReadyPlan,
  getImageSetTotalCount,
  hasImageSetConfig,
  IMAGE_SET_PRESETS,
  normalizeImageSetConfig,
  readStringArray,
  type PlanQuestion,
} from './interaction.js';

cli({
  site: 'maybeai-image-app',
  name: 'plan',
  access: 'read',
  description: 'Plan MaybeAI image app execution and return OpenClaw-friendly missing-input questions',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'intent', positional: true, required: false, help: 'Natural language intent' },
    ...INPUT_ARGS,
    ...RUN_EXTRA_ARGS,
    { name: 'min-confidence', help: 'Minimum confidence required, default 0.3' },
  ],
	func: async (_page, kwargs) => {
	  try {
	    const plan = buildImageAppPlan([String(kwargs.intent ?? '')], kwargs);
	    if (plan.selectedApp === 'gen-reference') return planGenReference(plan.input);
	    if (plan.selectedApp === 'gen-image-set') return planGenImageSet(plan.input);
	    if (plan.selectedApp === 'replica-listing-image') return planReplicaListing(plan.input);
      if (plan.missingFields.length > 0) {
        return buildNeedsInputPlan({
          app: plan.selectedApp,
          title: plan.selectedTitle,
          normalizedInput: plan.input,
          missing: plan.missingFields,
          questions: plan.missingFields.map(field => ({ field, message: `请提供 ${field}` })),
        });
      }
      return buildReadyPlan({
        app: plan.selectedApp,
        title: plan.selectedTitle,
        normalizedInput: plan.input,
        warnings: [],
      });
    } catch (error) {
      if (error instanceof CliError) {
        return {
          status: 'error',
          app: String(kwargs.app ?? ''),
          title: '',
          normalizedInput: {},
          missing: [],
          questions: [],
          warnings: [],
          message: error.message,
          hint: error.hint,
        };
      }
      throw error;
    }
  },
	});
	
function planGenReference(input: Record<string, unknown>) {
  const missing: string[] = [];
  const questions: PlanQuestion[] = [];
  if (readStringArray(input.product_images ?? input.products).length === 0) {
    missing.push('product_images');
    questions.push({
      field: 'product_images',
      message: '请提供参考生单图要使用的商品图，建议包含正面图、背面图或能体现商品细节的图片。',
      example: '--product-images "https://example.com/product-front.jpg"',
    });
  }
  if (readStringArray(input.reference_images ?? input.reference).length === 0) {
    missing.push('reference_images');
    questions.push({
      field: 'reference_images',
      message: '请提供参考图，例如颜色、模特、场景、构图或风格参考图。',
      example: '--reference-images "https://example.com/reference.jpg"',
    });
  }
  if (missing.length > 0) {
    return buildNeedsInputPlan({
      app: 'gen-reference',
      title: '参考生单图',
      normalizedInput: input,
      missing,
      questions,
    });
  }
  return buildReadyPlan({ app: 'gen-reference', title: '参考生单图', normalizedInput: input });
}

function planGenImageSet(input: Record<string, unknown>) {
  normalizeImageSetConfig(input);
  const missing: string[] = [];
  const questions: PlanQuestion[] = [];
  if (readStringArray(input.products ?? input.product_images).length === 0) {
    missing.push('products');
    questions.push({
      field: 'products',
      message: '请提供至少一张商品图 URL。',
      example: '--products "https://example.com/product.jpg"',
    });
  }
  if (!hasImageSetConfig(input) || getImageSetTotalCount(input) <= 0) {
    missing.push('image_set_config');
    questions.push({
      field: 'image_set_config',
      message: '请说明商品套图要生成哪些类型和张数，例如：白底图1张、场景图2张、卖点图2张、细节图2张；也可以选择 preset：standard/full/detail-heavy/scene-heavy。',
      example: '--preset standard',
    });
  } else if (getImageSetTotalCount(input) < 3) {
    missing.push('image_set_config');
    questions.push({
      field: 'image_set_config',
      message: '商品套图总张数至少 3 张，请增加一个或多个模块张数。',
      example: '--white-bg-count 1 --scene-count 1 --detail-count 1',
    });
  }
  if (missing.length > 0) {
    return buildNeedsInputPlan({
      app: 'gen-image-set',
      title: '商品套图',
      normalizedInput: input,
      missing,
      questions,
      suggestedPresets: IMAGE_SET_PRESETS,
    });
  }
  return buildReadyPlan({ app: 'gen-image-set', title: '商品套图', normalizedInput: input });
}

function planReplicaListing(input: Record<string, unknown>) {
  const missing: string[] = [];
  const questions: PlanQuestion[] = [];
  if (readStringArray(input.product_images ?? input.products).length === 0) {
    missing.push('product_images');
    questions.push({
      field: 'product_images',
      message: '请提供商品图，建议包含白底图、正面图、背面图、侧面图或场景图。',
      example: '--product-images "https://example.com/front.jpg,https://example.com/side.jpg"',
    });
  }
  if (readStringArray(input.reference_images ?? input.references ?? input.template).length === 0) {
    missing.push('reference_images');
    questions.push({
      field: 'reference_images',
      message: '请提供参考图、参考套图或详情页长图。',
      example: '--reference-images "https://example.com/reference.jpg"',
    });
  }
  if (missing.length > 0) {
    return buildNeedsInputPlan({
      app: 'replica-listing-image',
      title: '参考生套图',
      normalizedInput: input,
      missing,
      questions,
    });
  }
  return buildReadyPlan({ app: 'replica-listing-image', title: '参考生套图', normalizedInput: input });
}
