import { CliError } from '@jackwener/opencli/errors';

export type PlanStatus = 'ready' | 'needs_input' | 'error';

export interface PlanQuestion {
  field: string;
  message: string;
  example?: string;
}

export interface ImageAppPlanResult {
  status: PlanStatus;
  app: string;
  title: string;
  normalizedInput: Record<string, unknown>;
  missing: string[];
  questions: PlanQuestion[];
  suggestedPresets?: ImageSetPreset[];
  runCommand?: string;
  warnings: string[];
}

export interface ImageSetPreset {
  id: string;
  label: string;
  counts: ImageSetCounts;
}

export interface ImageSetCounts {
  white_bg_count?: number;
  closeup_white_bg_count?: number;
  scene_count?: number;
  selling_point_count?: number;
  detail_count?: number;
  material_craft_count?: number;
  multi_angle_count?: number;
  size_chart_count?: number;
}

export const IMAGE_SET_COUNT_FIELDS = [
  'white_bg_count',
  'closeup_white_bg_count',
  'scene_count',
  'selling_point_count',
  'detail_count',
  'material_craft_count',
  'multi_angle_count',
  'size_chart_count',
] as const;

export const IMAGE_SET_PRESETS: ImageSetPreset[] = [
  {
    id: 'standard',
    label: '标准商品套图',
    counts: {
      white_bg_count: 1,
      scene_count: 2,
      selling_point_count: 2,
      detail_count: 2,
    },
  },
  {
    id: 'full',
    label: '完整商品套图',
    counts: {
      white_bg_count: 1,
      closeup_white_bg_count: 1,
      scene_count: 2,
      selling_point_count: 2,
      detail_count: 2,
      material_craft_count: 1,
      multi_angle_count: 1,
      size_chart_count: 1,
    },
  },
  {
    id: 'detail-heavy',
    label: '细节强化套图',
    counts: {
      white_bg_count: 1,
      selling_point_count: 2,
      detail_count: 3,
      material_craft_count: 2,
    },
  },
  {
    id: 'scene-heavy',
    label: '场景强化套图',
    counts: {
      white_bg_count: 1,
      scene_count: 4,
      selling_point_count: 1,
      detail_count: 1,
    },
  },
];

export function normalizeImageSetConfig(input: Record<string, unknown>): void {
  const preset = readString(input.preset);
  if (preset) {
    const match = IMAGE_SET_PRESETS.find(item => item.id === preset);
    if (!match) {
      throw new CliError('ARGUMENT', `Invalid gen-image-set preset: ${preset}`, `Allowed presets: ${IMAGE_SET_PRESETS.map(item => item.id).join(', ')}`);
    }
    for (const [key, value] of Object.entries(match.counts)) {
      if (!hasPositiveNumber(input[key])) input[key] = value;
    }
  }

  for (const key of IMAGE_SET_COUNT_FIELDS) {
    if (input[key] === undefined || input[key] === '') continue;
    const parsed = Number(input[key]);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CliError('ARGUMENT', `Invalid ${key}: ${String(input[key])}`, `${key} must be a non-negative number.`);
    }
    input[key] = Math.floor(parsed);
  }
}

export function getImageSetTotalCount(input: Record<string, unknown>): number {
  return IMAGE_SET_COUNT_FIELDS.reduce((sum, key) => sum + readNonNegativeInteger(input[key]), 0);
}

export function hasImageSetConfig(input: Record<string, unknown>): boolean {
  return IMAGE_SET_COUNT_FIELDS.some(key => input[key] !== undefined && input[key] !== '') || !!readString(input.preset);
}

export function buildNeedsInputPlan(params: {
  app: string;
  title: string;
  normalizedInput: Record<string, unknown>;
  missing: string[];
  questions: PlanQuestion[];
  warnings?: string[];
  suggestedPresets?: ImageSetPreset[];
}): ImageAppPlanResult {
  return {
    status: 'needs_input',
    app: params.app,
    title: params.title,
    normalizedInput: params.normalizedInput,
    missing: params.missing,
    questions: params.questions,
    suggestedPresets: params.suggestedPresets,
    warnings: params.warnings ?? [],
  };
}

export function buildReadyPlan(params: {
  app: string;
  title: string;
  normalizedInput: Record<string, unknown>;
  runCommand?: string;
  warnings?: string[];
}): ImageAppPlanResult {
  return {
    status: 'ready',
    app: params.app,
    title: params.title,
    normalizedInput: params.normalizedInput,
    missing: [],
    questions: [],
    runCommand: params.runCommand,
    warnings: params.warnings ?? [],
  };
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => readStringArray(item));
  }
  if (typeof value === 'string') {
    return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
  }
  if (value && typeof value === 'object' && 'url' in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === 'string' && url.trim() ? [url.trim()] : [];
  }
  return [];
}

function readNonNegativeInteger(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function hasPositiveNumber(value: unknown): boolean {
  return readNonNegativeInteger(value) > 0;
}
