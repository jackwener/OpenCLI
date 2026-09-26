/**
 * Runtime policy for enabling and disabling adapter sites.
 *
 * The policy applies to both website and Electron app adapters because both
 * share the same `site` namespace in the registry. Core commands such as
 * `browser`, `plugin`, and `adapter` are intentionally outside this policy.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { ConfigError } from './errors.js';

export type SitePolicyDefault = 'allow' | 'deny';

export interface SitePolicy {
  default: SitePolicyDefault;
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
  path: string;
  configured: boolean;
}

interface SitePolicyConfig {
  default?: unknown;
  allow?: unknown;
  deny?: unknown;
}

type PolicyDocument = Record<string, unknown> & {
  sites?: SitePolicyConfig;
};

const SITE_NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

function defaultPolicy(policyPath: string): SitePolicy {
  return {
    default: 'allow',
    allow: new Set<string>(),
    deny: new Set<string>(),
    path: policyPath,
    configured: false,
  };
}

let activePolicy = defaultPolicy(defaultSitePolicyPath());

export function defaultSitePolicyPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const override = env.OPENCLI_POLICY_FILE?.trim();
  return override || path.join(homeDir, '.opencli', 'policy.yaml');
}

function asPolicyDocument(value: unknown, source: string): PolicyDocument {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`Site policy in ${source} must be a YAML object.`);
  }
  return value as PolicyDocument;
}

function parseSiteList(value: unknown, key: 'allow' | 'deny', source: string): Set<string> {
  if (value === undefined || value === null) return new Set<string>();
  if (!Array.isArray(value)) {
    throw new ConfigError(`sites.${key} in ${source} must be an array of site names.`);
  }

  const sites = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !SITE_NAME_RE.test(item.trim())) {
      throw new ConfigError(`sites.${key} in ${source} contains an invalid site name: ${JSON.stringify(item)}.`);
    }
    sites.add(item.trim());
  }
  return sites;
}

export function parseSitePolicy(
  value: unknown,
  options: { source?: string; path?: string; configured?: boolean } = {},
): SitePolicy {
  const source = options.source ?? 'site policy';
  const policyPath = options.path ?? defaultSitePolicyPath();
  const document = asPolicyDocument(value, source);
  const sites = document.sites;

  if (sites === undefined || sites === null) {
    return { ...defaultPolicy(policyPath), configured: options.configured ?? false };
  }
  if (typeof sites !== 'object' || Array.isArray(sites)) {
    throw new ConfigError(`sites in ${source} must be a YAML object.`);
  }

  const defaultValue = sites.default ?? 'allow';
  if (defaultValue !== 'allow' && defaultValue !== 'deny') {
    throw new ConfigError(`sites.default in ${source} must be "allow" or "deny".`);
  }

  return {
    default: defaultValue,
    allow: parseSiteList(sites.allow, 'allow', source),
    deny: parseSiteList(sites.deny, 'deny', source),
    path: policyPath,
    configured: options.configured ?? true,
  };
}

function readPolicyDocument(policyPath: string): { document: PolicyDocument; configured: boolean } {
  try {
    const raw = fs.readFileSync(policyPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ConfigError(`Could not parse site policy ${policyPath}: ${detail}`);
    }
    return { document: asPolicyDocument(parsed, policyPath), configured: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { document: {}, configured: false };
    }
    throw error;
  }
}

export function loadSitePolicy(policyPath: string = defaultSitePolicyPath()): SitePolicy {
  const { document, configured } = readPolicyDocument(policyPath);
  return parseSitePolicy(document, { source: policyPath, path: policyPath, configured });
}

export function configureSitePolicy(policy: SitePolicy): void {
  activePolicy = policy;
}

export function getSitePolicy(): SitePolicy {
  return activePolicy;
}

export function hasSitePolicyRestrictions(policy: SitePolicy = activePolicy): boolean {
  return policy.default === 'deny' || policy.allow.size > 0 || policy.deny.size > 0;
}

export function isSiteEnabled(site: string, policy: SitePolicy = activePolicy): boolean {
  if (policy.deny.has(site)) return false;
  if (policy.allow.has(site)) return true;
  return policy.default === 'allow';
}

export function assertSiteEnabled(site: string, policy: SitePolicy = activePolicy): void {
  if (isSiteEnabled(site, policy)) return;
  throw new ConfigError(
    `Adapter site "${site}" is disabled by ${policy.path}.`,
    `Run "opencli adapter enable ${site}" or update the site policy.`,
  );
}

export function setSiteEnabled(
  site: string,
  enabled: boolean,
  policyPath: string = defaultSitePolicyPath(),
): SitePolicy {
  const normalizedSite = site.trim();
  if (!SITE_NAME_RE.test(normalizedSite)) {
    throw new ConfigError(`Invalid site name: ${JSON.stringify(site)}.`);
  }

  const { document, configured } = readPolicyDocument(policyPath);
  const current = parseSitePolicy(document, {
    source: policyPath,
    path: policyPath,
    configured,
  });
  const allow = new Set(current.allow);
  const deny = new Set(current.deny);

  if (enabled) {
    deny.delete(normalizedSite);
    if (current.default === 'deny') allow.add(normalizedSite);
    else allow.delete(normalizedSite);
  } else {
    allow.delete(normalizedSite);
    deny.add(normalizedSite);
  }

  const existingSites = document.sites && typeof document.sites === 'object' && !Array.isArray(document.sites)
    ? document.sites
    : {};
  document.sites = {
    ...existingSites,
    default: current.default,
    allow: [...allow].sort((a, b) => a.localeCompare(b)),
    deny: [...deny].sort((a, b) => a.localeCompare(b)),
  };

  fs.mkdirSync(path.dirname(policyPath), { recursive: true, mode: 0o700 });
  const serialized = yaml.dump(document, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  });
  const tempPath = `${policyPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, policyPath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }

  const updated = parseSitePolicy(document, {
    source: policyPath,
    path: policyPath,
    configured: true,
  });
  configureSitePolicy(updated);
  return updated;
}
