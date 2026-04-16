import * as fs from 'node:fs';
import { ArgumentError } from '@jackwener/opencli/errors';

export function readJsonObjectInput(filePath: string | undefined, rawJson: string | undefined, options: { required?: boolean } = {}): Record<string, unknown> {
  const required = options.required ?? true;

  if (filePath && rawJson) {
    throw new ArgumentError('Use either --file or --json, not both');
  }
  if (!filePath && !rawJson) {
    if (!required) return {};
    throw new ArgumentError('Missing payload input', 'Pass --json \'{"product":"..."}\' or --file payload.json');
  }

  const source = filePath
    ? fs.readFileSync(filePath, 'utf8')
    : rawJson!;

  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Payload must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new ArgumentError(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function mergeDefinedCliValues(input: Record<string, unknown>, kwargs: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const merged = { ...input };
  for (const key of keys) {
    const value = kwargs[key];
    if (value !== undefined && value !== null && value !== '') {
      merged[key] = value;
    }
  }
  return merged;
}
