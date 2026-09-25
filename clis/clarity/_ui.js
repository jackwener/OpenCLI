import { CommandExecutionError } from '@jackwener/opencli/errors';

export const CLARITY_ORIGIN = 'https://clarity.microsoft.com';

/**
 * Microsoft Clarity has no public API for project settings — the official
 * Data Export API and MCP server cover dashboard metrics only. The internal
 * GraphQL endpoint (POST /api/v2) rejects hand-built requests with a flat
 * `400 Bad Request` even for a valid named operation carrying the page's own
 * X-CSRF-Token, so these commands read the rendered Settings surface instead.
 */

const PROJECT_ID_PATTERN = /^[a-z0-9]{6,20}$/i;

export function normalizeProjectId(value, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TypeError('project-id is required.');
    return undefined;
  }
  const id = String(value).trim();
  if (!PROJECT_ID_PATTERN.test(id)) {
    throw new TypeError(`project-id must be a Clarity project id (alphanumeric), got: ${id}`);
  }
  return id;
}

function ensureObject(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  throw new CommandExecutionError(`${label} returned an unexpected payload shape from the Browser Bridge.`);
}

/**
 * Navigate to a Clarity settings sub-tab and fail loudly when the profile is
 * signed out. The `cb` cache-buster forces a real document load: Clarity is a
 * hash-routed SPA, so navigating to a URL that differs only by `#fragment`
 * changes nothing and would silently return the previous project's page.
 */
export async function gotoClaritySettings(page, projectId, hash, label) {
  if (!page || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') {
    throw new CommandExecutionError(`${label} requires an OpenCLI Browser Bridge page with navigation and visible-DOM access.`);
  }
  const cb = `cb${projectId}`;
  await page.goto(`${CLARITY_ORIGIN}/projects/view/${projectId}/settings?${cb}=1#${hash}`, { waitUntil: 'domcontentloaded' });

  // Wait inside the page, not around it. `page.wait` is not available on every
  // bridge page object, and when it is missing an out-of-page poll spins
  // through every attempt in milliseconds and reads an unpainted document —
  // which surfaces as "0 integration cards" rather than as "too early".
  // Anchor on the block that renders *after* the integration cards. A card
  // title is the wrong anchor twice over: a loose ' integration' matches a
  // half-painted panel (which produced confident WRONG statuses), and a
  // specific card title is not universal — many projects are never offered the
  // Google Tag Manager card at all, so waiting for it always burns the budget.
  const marker = hash === 'setup' ? 'Advanced settings' : '';
  const state = ensureObject(await page.evaluate(`(async () => {
    const marker = ${JSON.stringify(marker)};
    const deadline = Date.now() + 20000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let text = '';
    while (Date.now() < deadline) {
      text = document.body ? (document.body.innerText || '') : '';
      if (marker === '' ? text.trim().length > 0 : text.includes(marker)) break;
      if (/sign in|log in|welcome to clarity/i.test(document.title + ' ' + text)) break;
      await sleep(750);
    }
    return {
      title: document.title || '',
      href: location.href,
      text: text.replace(/\\s+/g, ' ').trim().slice(0, 600),
      waitedMs: 20000 - Math.max(0, deadline - Date.now()),
      textContentLen: document.body ? String(document.body.textContent || '').length : -1,
    };
  })()`), label);

  if (!state.text) {
    throw new CommandExecutionError(
      `${label}: page at ${state.href} rendered no text after ${state.waitedMs}ms (title="${state.title}", ` +
      `page.wait=${typeof page.wait}, page.goto=${typeof page.goto}, textContentLen=${state.textContentLen}).`,
    );
  }
  if (/sign in|log in|welcome to clarity/i.test(`${state.title} ${state.text}`)) {
    throw new CommandExecutionError(
      'Clarity is not signed in in the selected Browser Bridge profile. Sign in at https://clarity.microsoft.com in that Chrome profile, then retry.',
    );
  }
  // Clarity sends projects that have never received data to an onboarding
  // route. That is a real, actionable state — "not installed yet" — and must
  // not be reported as an unreadable page, nor as "no integrations".
  if (/\/gettingstarted|\/getting-started/i.test(state.href)) {
    throw new CommandExecutionError(
      `NOT_INSTALLED: Clarity redirected project ${projectId} to its Getting Started page (${state.href}) — ` +
      'the tracking code has never sent data, so the Setup tab has no integration cards yet.',
    );
  }
  if (!/\/settings/i.test(state.href)) {
    throw new CommandExecutionError(
      `${label}: expected the settings route for ${projectId} but landed on ${state.href}.`,
    );
  }
  if (!state.href.includes(`/projects/view/${projectId}/`)) {
    throw new CommandExecutionError(
      `Clarity redirected away from project ${projectId} (landed on ${state.href}). The project id may be wrong, or this account may not have access to it.`,
    );
  }
  return state;
}

/**
 * Read the integration cards off the Setup tab.
 *
 * Parsed from the panel's rendered line order rather than the DOM tree: the
 * status pill is always the line directly above "<Name> integration", while
 * the card's own element does not reliably contain its pill — walking up from
 * the title lands on a container holding several cards, which reads as
 * ambiguous and loses the status for exactly the connected ones.
 */
export async function readIntegrationCards(page) {
  const payload = await page.evaluate(`(async () => {
    const PILL = /^(Connected|Not Connected)$/i;
    const TITLE = /^(.+?)\\s+integration$/i;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const valueAfter = (body, label) => {
      // Clarity renders "Account:Foo" inline but "Connected to:" on its own line.
      for (let i = 0; i < body.length; i += 1) {
        const line = body[i];
        if (!line.toLowerCase().startsWith(label.toLowerCase())) continue;
        const inline = line.slice(label.length).trim();
        if (inline) return inline;
        return (body[i + 1] || '').trim();
      }
      return '';
    };

    const parse = () => {
      const lines = String(document.body ? document.body.innerText || '' : '')
        .split('\\n').map((l) => l.trim()).filter((l) => l.length > 0);
      const titleAt = [];
      lines.forEach((line, i) => { const m = line.match(TITLE); if (m) titleAt.push({ i, name: m[1].trim() }); });

      const cards = [];
      for (let t = 0; t < titleAt.length; t += 1) {
        const { i, name } = titleAt[t];
        const prev = lines[i - 1] || '';
        const status = PILL.test(prev) ? prev : 'Unknown';
        const nextTitle = titleAt[t + 1];
        const end = nextTitle ? Math.max(i + 1, nextTitle.i - 1) : lines.length;
        const body = lines.slice(i + 1, end);
        cards.push({
          name,
          status,
          account: valueAfter(body, 'Account:'),
          container: valueAfter(body, 'Container:'),
          connectedTo: valueAfter(body, 'Connected to:'),
        });
      }
      return { cards, lines, complete: lines.includes('Advanced settings') };
    };

    // Settle on the card count. The cards paint progressively and the
    // "Advanced settings" block can appear BEFORE the last card lands — so
    // end-marker-plus-one-card wrongly reported two present integrations as
    // "not offered". Require the count to hold steady before trusting it.
    let snap = parse();
    let prev = -1;
    let stable = 0;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      snap = parse();
      if (snap.complete && snap.cards.length > 0 && snap.cards.length === prev) {
        stable += 1;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
      prev = snap.cards.length;
      await sleep(1200);
    }

    return {
      cards: snap.cards,
      complete: snap.complete,
      settled: stable >= 2,
      href: location.href,
      lineCount: snap.lines.length,
      sample: snap.lines.slice(0, 26).join(' | ').slice(0, 400),
    };
  })()`);

  const obj = ensureObject(payload, 'Clarity integrations');
  if (!Array.isArray(obj.cards)) {
    throw new CommandExecutionError('Clarity integrations returned no card array from the Browser Bridge.');
  }
  // Refuse anything that did not settle. A partial panel does not degrade to
  // "unknown" on its own — it silently turns present integrations into absent
  // ones, which is a confident wrong answer.
  if (obj.cards.length === 0 || !obj.complete || !obj.settled) {
    throw new CommandExecutionError(
      `Clarity Setup panel did not settle at ${obj.href} — ` +
      `${obj.cards.length} card(s), ${obj.lineCount} lines, end-marker ${obj.complete ? 'present' : 'absent'}, ` +
      `settled=${obj.settled}. First lines: ${obj.sample}`,
    );
  }
  return obj.cards;
}

/**
 * Enumerate every project on the account from the /projects grid.
 *
 * The grid is heavy enough to blow OpenCLI's hardcoded 120s per-action ceiling
 * on a `load` wait, so commit early and poll the DOM until cards appear.
 */
export async function discoverProjects(page) {
  await page.goto(`${CLARITY_ORIGIN}/projects`, { waitUntil: 'commit' });

  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Wait inside the page — see gotoClaritySettings for why an out-of-page
    // poll is unreliable here. The grid also carries no <a href> per card, so
    // ids have to come from React's own props when the markup has none.
    const payload = await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const deadline = Date.now() + 30000;
      let lines = [];
      while (Date.now() < deadline) {
        lines = String(document.body ? document.body.innerText || '' : '')
          .split('\\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 12) break;
        await sleep(1000);
      }

      const SITE = /^(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:\\/\\S*)?$/i;
      const readLines = () => String(document.body ? document.body.innerText || '' : '')
        .split('\\n').map((l) => l.trim()).filter(Boolean);

      const ids = new Set();
      const harvest = () => {
        const html = document.documentElement.outerHTML;
        for (const m of html.matchAll(/projects\\/view\\/([a-z0-9]{6,20})/gi)) ids.add(m[1]);
        // Bounded fiber scan: the grid has no per-card href, and an unbounded
        // querySelectorAll('*') walk over it freezes the renderer.
        const nodes = [...document.querySelectorAll('[class*=card i],[class*=project i],li,article')].slice(0, 800);
        for (const el of nodes) {
          for (const k of Object.keys(el)) {
            if (k.charCodeAt(0) !== 95 || !k.startsWith('__react')) continue;
            let j = '';
            try { j = JSON.stringify(el[k]); } catch (e) { j = ''; }
            for (const m of String(j).matchAll(/"(?:id|projectId|pid)":"([a-z0-9]{8,14})"/gi)) ids.add(m[1]);
          }
        }
        return html.length;
      };

      // Settle before reporting. A grid still mounting yields a partial id set,
      // and a partial set is worse than none: the caller cannot tell 3-of-20
      // from 3-in-total, and reports the short list as the whole account.
      let htmlLen = 0, prev = -1, stable = 0;
      const settleBy = Date.now() + 60000;
      while (Date.now() < settleBy) {
        lines = readLines();
        htmlLen = harvest();
        const cardLines = lines.filter((l) => SITE.test(l)).length;
        if (ids.size > 0 && ids.size === prev && ids.size >= cardLines) {
          stable += 1;
          if (stable >= 2) break;
        } else {
          stable = 0;
        }
        prev = ids.size;
        await sleep(1500);
      }

      return {
        ids: [...ids],
        cardLines: lines.filter((l) => SITE.test(l)).length,
        lines: lines.slice(0, 400),
        href: location.href,
        title: document.title || '',
        htmlLen,
      };
    })()`);
    last = payload;

    // A short list must never be returned as the whole account. If fewer ids
    // than rendered cards came back, treat the sample as incomplete and retry.
    if (payload && Array.isArray(payload.ids) && payload.ids.length > 0
        && payload.ids.length >= (payload.cardLines || 0)) {
      // The grid renders each card as "<Name>" then "<site url>" on the next
      // line. Pair them in order; fall back to id-only when the text is short.
      const SITE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;
      const pairs = [];
      const lines = payload.lines || [];
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (SITE.test(lines[i + 1]) && !SITE.test(lines[i])) pairs.push({ name: lines[i], site: lines[i + 1] });
      }
      return payload.ids.map((id, index) => ({
        ProjectId: id,
        Name: pairs[index] ? pairs[index].name : '',
        Site: pairs[index] ? pairs[index].site : '',
      }));
    }
  }

  throw new CommandExecutionError(
    'Could not read any project id from the Clarity projects grid. ' +
    `Landed on ${last && last.href} (title="${last && last.title}", html=${last && last.htmlLen}B, ` +
    `${last && last.lines ? last.lines.length : 0} lines). First lines: ${last && last.lines ? last.lines.slice(0, 20).join(' | ').slice(0, 300) : ''}. ` +
    'Pass ids explicitly instead: opencli clarity audit --project-ids <a,b,c>',
  );
}

/**
 * Absent is not "not connected". A card the page never rendered is `Unknown`,
 * which must stay distinguishable from a card that rendered "Not Connected" —
 * a layout change that drops a card would otherwise read as a real finding and
 * send the user to reconnect something that was fine.
 */
export function detailFor(card) {
  if (card.account || card.container) {
    return [card.account && `account=${card.account}`, card.container && `container=${card.container}`]
      .filter(Boolean).join(' ');
  }
  if (card.connectedTo) return `url=${card.connectedTo}`;
  return '';
}
