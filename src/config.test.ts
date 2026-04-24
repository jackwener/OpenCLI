import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect HOME to a tmp dir for the whole file so reads/writes don't escape
// the sandbox. Must be set before importing ../config.js because CONFIG_PATH
// is captured at module load.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-config-test-'));
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const { readConfig, writeConfig, getDefaultProfile, setDefaultProfile, CONFIG_PATH } = await import('./config.js');

describe('config.ts', () => {
  beforeEach(() => {
    delete process.env.OPENCLI_PROFILE;
    fs.rmSync(path.join(TMP_HOME, '.opencli'), { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.OPENCLI_PROFILE;
  });

  it('returns empty config when file does not exist', () => {
    expect(readConfig()).toEqual({});
    expect(getDefaultProfile()).toBeNull();
  });

  it('returns empty config on malformed JSON rather than throwing', () => {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, '{ not json');
    expect(readConfig()).toEqual({});
  });

  it('writes a config and reads it back', () => {
    writeConfig({ defaultProfile: 'work' });
    expect(readConfig()).toEqual({ defaultProfile: 'work' });
  });

  it('setDefaultProfile persists and clears', () => {
    setDefaultProfile('work');
    expect(getDefaultProfile()).toBe('work');
    setDefaultProfile(null);
    expect(getDefaultProfile()).toBeNull();
  });

  it('setDefaultProfile treats empty string as clear', () => {
    setDefaultProfile('work');
    setDefaultProfile('');
    expect(getDefaultProfile()).toBeNull();
  });

  it('OPENCLI_PROFILE env var wins over config file', () => {
    setDefaultProfile('from-config');
    process.env.OPENCLI_PROFILE = 'from-env';
    expect(getDefaultProfile()).toBe('from-env');
  });

  it('empty OPENCLI_PROFILE falls back to config file', () => {
    setDefaultProfile('from-config');
    process.env.OPENCLI_PROFILE = '   ';
    expect(getDefaultProfile()).toBe('from-config');
  });
});

// Restore HOME for any downstream tests that run in the same process.
process.env.HOME = ORIG_HOME;
