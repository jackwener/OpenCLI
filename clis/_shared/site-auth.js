import { AuthRequiredError, TimeoutError, getErrorMessage } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const DEFAULT_TIMEOUT_SECONDS = 300;
const POLL_INTERVAL_MS = 2000;

function normalizeIdentity(site, identity) {
  const row = identity && typeof identity === 'object' && !Array.isArray(identity)
    ? identity
    : {};
  return { logged_in: true, site, ...row };
}

function isAuthRequired(error) {
  return error instanceof AuthRequiredError;
}

async function tryProbe(config, page, phase) {
  const probe = phase === 'poll' && config.poll ? config.poll : config.verify;
  return normalizeIdentity(config.site, await probe(page, { phase }));
}

function authHint(config) {
  return `Run \`opencli ${config.site} login\` to open the login page, then retry.`;
}

function commandColumns(config) {
  const identityColumns = config.columns ?? ['id', 'username', 'name'];
  return ['logged_in', 'site', ...identityColumns];
}

function normalizeQuickCheck(result) {
  if (typeof result === 'boolean') return { logged_in: result };
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { logged_in: !!result.logged_in, ...result };
  }
  return { logged_in: false };
}

function normalizeRefreshResult(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  return { touched: true };
}

export function registerSiteAuthCommands(config) {
  if (!config?.site || !config?.domain || !config?.loginUrl || typeof config.verify !== 'function') {
    throw new Error('registerSiteAuthCommands requires site, domain, loginUrl, and verify(page)');
  }

  cli({
    site: config.site,
    name: 'whoami',
    access: 'read',
    description: config.whoamiDescription ?? `Show the current logged-in ${config.site} account`,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: commandColumns(config),
    authStatus: {
      ...(typeof config.quickCheck === 'function'
        ? { quickCheck: async (page) => normalizeQuickCheck(await config.quickCheck(page)) }
        : {}),
      ...(typeof config.refresh === 'function'
        ? { refresh: async (page, kwargs) => normalizeRefreshResult(await config.refresh(page, kwargs)) }
        : {}),
    },
    func: async (page) => tryProbe(config, page, 'identity'),
  });

  cli({
    site: config.site,
    name: 'login',
    access: 'write',
    description: config.loginDescription ?? `Open ${config.site} login and wait until the browser session is authenticated`,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    siteSession: 'persistent',
    args: [
      { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT_SECONDS, help: 'Maximum seconds to wait for the user to finish login' },
    ],
    columns: ['status', ...commandColumns(config)],
    func: async (page, kwargs) => {
      try {
        return { status: 'already_logged_in', ...await tryProbe(config, page, 'identity') };
      } catch (error) {
        if (!isAuthRequired(error)) throw error;
      }

      await page.goto(config.loginUrl);
      const timeoutSeconds = Number(kwargs.timeout ?? DEFAULT_TIMEOUT_SECONDS);
      const deadline = Date.now() + timeoutSeconds * 1000;
      let lastAuthMessage = '';

      while (Date.now() < deadline) {
        await page.wait(Math.min(POLL_INTERVAL_MS / 1000, Math.max(0.2, (deadline - Date.now()) / 1000)));
        try {
          const identity = await tryProbe(config, page, 'poll');
          return { status: 'login_complete', ...identity };
        } catch (error) {
          if (!isAuthRequired(error)) throw error;
          lastAuthMessage = getErrorMessage(error);
        }
      }

      throw new TimeoutError(
        `${config.site} login`,
        timeoutSeconds,
        lastAuthMessage ? `${authHint(config)} Last auth check: ${lastAuthMessage}` : authHint(config),
      );
    },
  });
}
