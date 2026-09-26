import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import {
  configureSitePolicy,
  defaultSitePolicyPath,
  isSiteEnabled,
  loadSitePolicy,
  parseSitePolicy,
  setSiteEnabled,
} from './site-policy.js';

describe('site policy', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    configureSitePolicy(parseSitePolicy({}, { path: '/tmp/opencli-policy.yaml', configured: false }));
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  function tempPolicyPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-site-policy-'));
    tempDirs.push(dir);
    return path.join(dir, 'policy.yaml');
  }

  it('defaults to allowing every site when the policy file is absent', () => {
    const policyPath = tempPolicyPath();
    const policy = loadSitePolicy(policyPath);

    expect(policy.configured).toBe(false);
    expect(isSiteEnabled('twitter', policy)).toBe(true);
  });

  it('supports allow-by-default with an explicit deny list', () => {
    const policy = parseSitePolicy({
      sites: { default: 'allow', deny: ['douyin'] },
    });

    expect(isSiteEnabled('douyin', policy)).toBe(false);
    expect(isSiteEnabled('miuta-douyin', policy)).toBe(true);
  });

  it('supports deny-by-default with an explicit allow list', () => {
    const policy = parseSitePolicy({
      sites: { default: 'deny', allow: ['miuta-douyin'] },
    });

    expect(isSiteEnabled('miuta-douyin', policy)).toBe(true);
    expect(isSiteEnabled('douyin', policy)).toBe(false);
  });

  it('gives the deny list precedence when a site appears in both lists', () => {
    const policy = parseSitePolicy({
      sites: { default: 'allow', allow: ['douyin'], deny: ['douyin'] },
    });

    expect(isSiteEnabled('douyin', policy)).toBe(false);
  });

  it('rejects malformed policy fields', () => {
    expect(() => parseSitePolicy({ sites: { default: 'sometimes' } }))
      .toThrow('sites.default');
    expect(() => parseSitePolicy({ sites: { deny: 'douyin' } }))
      .toThrow('sites.deny');
    expect(() => parseSitePolicy({ sites: { allow: ['bad/site'] } }))
      .toThrow('invalid site name');
    expect(() => parseSitePolicy({ sites: { allow: ['Douyin'] } }))
      .toThrow('invalid site name');
  });

  it('uses OPENCLI_POLICY_FILE when provided', () => {
    expect(defaultSitePolicyPath({ OPENCLI_POLICY_FILE: '/managed/opencli-policy.yaml' }, '/home/test'))
      .toBe('/managed/opencli-policy.yaml');
    expect(defaultSitePolicyPath({}, '/home/test'))
      .toBe('/home/test/.opencli/policy.yaml');
  });

  it('disables and re-enables a site while preserving unrelated policy sections', () => {
    const policyPath = tempPolicyPath();
    fs.writeFileSync(policyPath, 'writes:\n  default: confirm\n', 'utf8');

    let policy = setSiteEnabled('douyin', false, policyPath);
    expect(isSiteEnabled('douyin', policy)).toBe(false);

    type TestPolicyDocument = {
      writes?: { default?: string };
      sites?: { deny?: string[] };
    };
    let document = yaml.load(fs.readFileSync(policyPath, 'utf8')) as TestPolicyDocument;
    expect(document.writes).toEqual({ default: 'confirm' });
    expect(document.sites?.deny).toEqual(['douyin']);

    policy = setSiteEnabled('douyin', true, policyPath);
    expect(isSiteEnabled('douyin', policy)).toBe(true);
    document = yaml.load(fs.readFileSync(policyPath, 'utf8')) as TestPolicyDocument;
    expect(document.sites?.deny).toEqual([]);
  });

  it('adds an enabled site to the allow list when the default is deny', () => {
    const policyPath = tempPolicyPath();
    fs.writeFileSync(policyPath, 'sites:\n  default: deny\n', 'utf8');

    const policy = setSiteEnabled('miuta-douyin', true, policyPath);

    expect(isSiteEnabled('miuta-douyin', policy)).toBe(true);
    expect(isSiteEnabled('douyin', policy)).toBe(false);
  });
});
