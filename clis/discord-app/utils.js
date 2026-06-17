import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const DISCORD_HOSTS = new Set(['discord.com', 'canary.discord.com', 'ptb.discord.com']);
const DISCORD_ORIGIN = 'https://discord.com';
const CHANNEL_ID_RE = /^\d{3,}$/;

function stringArg(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function requireObjectEvaluateResult(payload, context) {
    const value = unwrapEvaluateResult(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`${context} returned malformed browser output.`);
    }
    return value;
}

function requireArrayEvaluateResult(payload, context) {
    const value = unwrapEvaluateResult(payload);
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${context} returned malformed browser output.`);
    }
    return value;
}

function requireNonEmptyRowField(row, field, context, index) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new CommandExecutionError(`${context} returned malformed row ${index + 1}.`);
    }
    const value = String(row[field] || '').trim();
    if (!value) {
        throw new CommandExecutionError(`${context} row ${index + 1} is missing ${field}.`);
    }
    return value;
}

function requireRowsWithFields(rows, fields, context) {
    rows.forEach((row, index) => {
        fields.forEach((field) => requireNonEmptyRowField(row, field, context, index));
    });
    return rows;
}

export function isDiscordSnowflake(value) {
    return CHANNEL_ID_RE.test(String(value || '').trim());
}

export function normalizeDiscordName(value) {
    return String(value || '')
        .trim()
        .replace(/^#/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function parseDiscordChannelUrl(raw) {
    const value = stringArg(raw);
    if (!value) return null;

    let url;
    try {
        url = new URL(value, DISCORD_ORIGIN);
    } catch {
        return null;
    }

    if (!DISCORD_HOSTS.has(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'channels' || parts.length < 3) return null;

    const guildId = decodeURIComponent(parts[1] || '');
    const channelId = decodeURIComponent(parts[2] || '');
    const threadId = parts[3] ? decodeURIComponent(parts[3]) : undefined;
    if (!guildId || !channelId) return null;

    return {
        guild_id: guildId,
        channel_id: channelId,
        ...(threadId ? { thread_id: threadId } : {}),
        url: buildDiscordChannelUrl({ guildId, channelId, threadId }),
    };
}

export function buildDiscordChannelUrl({ guildId, channelId, threadId }) {
    if (!guildId || !channelId) {
        throw new ArgumentError('Discord channel navigation requires both guild_id and channel_id.');
    }
    const base = `${DISCORD_ORIGIN}/channels/${encodeURIComponent(String(guildId))}/${encodeURIComponent(String(channelId))}`;
    return threadId ? `${base}/${encodeURIComponent(String(threadId))}` : base;
}

export function parsePositiveInt(value, fallback, label) {
    if (value === undefined || value === null || value === '') return fallback;
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) {
        throw new ArgumentError(`--${label} must be a positive integer.`);
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ArgumentError(`--${label} must be a positive integer.`);
    }
    return parsed;
}

export function hasDiscordChannelTarget(kwargs = {}) {
    return Boolean(stringArg(kwargs.url) || stringArg(kwargs.guild) || stringArg(kwargs.channel));
}

export function buildListChannelsScript() {
    return `
      (function __opencliDiscordListChannels() {
        function parseRoute(raw) {
          try {
            var url = new URL(raw, 'https://discord.com');
            var parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'channels' || parts.length < 3) return null;
            return { guild_id: parts[1], channel_id: parts[2], thread_id: parts[3] || '' };
          } catch (_) {
            return null;
          }
        }

        function absUrl(path) {
          try { return new URL(path, 'https://discord.com').href; } catch (_) { return ''; }
        }

        function cleanChannelLabel(label) {
          var cleaned = String(label || '').trim();
          var commaIdx = cleaned.search(/[,，]/);
          if (commaIdx !== -1) cleaned = cleaned.slice(commaIdx + 1).trimStart();
          return cleaned;
        }

        function inferType(label, el) {
          var raw = String(label || '').toLowerCase();
          var id = String(el.getAttribute('data-list-item-id') || '').toLowerCase();
          if (raw.indexOf('voice') !== -1 || id.indexOf('voice') !== -1) return 'Voice';
          if (raw.indexOf('forum') !== -1 || id.indexOf('forum') !== -1) return 'Forum';
          if (raw.indexOf('announcement') !== -1 || raw.indexOf('news') !== -1 || id.indexOf('announcement') !== -1) return 'Announcement';
          if (raw.indexOf('stage') !== -1 || id.indexOf('stage') !== -1) return 'Stage';
          return 'Text';
        }

        function channelName(label, el) {
          var cleaned = cleanChannelLabel(label);
          var m = cleaned.match(/^(.+?)\\s*[（(](.+?)[）)]\\s*$/);
          if (m) return m[1].trim();
          var ariaName = el.getAttribute('aria-label') || '';
          if (ariaName && ariaName !== label) return cleanChannelLabel(ariaName).replace(/\\s*[（(].*?[）)]\\s*$/, '').trim();
          var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          return text.replace(/\\s*[（(].*?[）)]\\s*$/, '').trim();
        }

        var links = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
        var seen = new Set();
        var rows = [];
        links.forEach(function(el) {
          var href = el.getAttribute('href') || '';
          var route = parseRoute(href);
          if (!route || route.thread_id || !route.channel_id || route.channel_id === '@me') return;
          var key = route.guild_id + '/' + route.channel_id;
          if (seen.has(key)) return;

          var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          var cleaned = cleanChannelLabel(label);
          if (/[（(]\\s*category\\s*[）)]/i.test(cleaned)) return;

          var name = channelName(cleaned, el);
          if (!name) return;

          var type = inferType(cleaned, el);
          rows.push({
            Index: rows.length + 1,
            Channel: name,
            Type: type,
            guild_id: route.guild_id,
            channel_id: route.channel_id,
            url: absUrl('/channels/' + route.guild_id + '/' + route.channel_id)
          });
          seen.add(key);
        });

        return rows;
      })()
    `;
}

export function buildListServersScript() {
    return `
      (function __opencliDiscordListServers() {
        function parseGuildId(raw) {
          try {
            var url = new URL(raw, 'https://discord.com');
            var parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'channels' || parts.length !== 2 || !parts[1] || parts[1] === '@me') return '';
            return parts[1];
          } catch (_) {
            return '';
          }
        }

        var rows = [];
        var seen = new Set();
        var items = Array.from(document.querySelectorAll('a[href^="/channels/"], [data-list-item-id*="guildsnav___"], [class*="listItem_"]'));
        items.forEach(function(item) {
          var link = item.matches && item.matches('a[href^="/channels/"]') ? item : item.querySelector && item.querySelector('a[href^="/channels/"]');
          var href = link ? link.getAttribute('href') || '' : '';
          var guildId = parseGuildId(href);
          if (!guildId || seen.has(guildId)) return;

          var named = item.querySelector && item.querySelector('[data-dnd-name]');
          var name = named ? named.getAttribute('data-dnd-name') : '';
          if (!name) name = item.getAttribute && item.getAttribute('aria-label') || '';
          if (!name && link) name = link.getAttribute('aria-label') || link.getAttribute('title') || '';
          name = String(name || '').replace(/\\s+/g, ' ').trim();
          if (!name || /^direct messages$/i.test(name)) return;

          rows.push({
            Index: rows.length + 1,
            Server: name.slice(0, 80),
            guild_id: guildId,
            url: 'https://discord.com/channels/' + guildId
          });
          seen.add(guildId);
        });

        return rows;
      })()
    `;
}

export function buildReadMessagesScript(count) {
    const limit = Math.max(1, parseInt(String(count), 10) || 20);
    return `
      (function __opencliDiscordReadMessages(limit) {
        function textOf(el) { return el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
        function routeOfMessage(node) {
          var id = node && node.getAttribute ? node.getAttribute('id') || '' : '';
          var match = id.match(/^chat-messages-(\\d+)-(\\d+)/);
          return match ? { channel_id: match[1], message_id: match[2] } : {};
        }

        var results = [];
        var nodes = Array.from(document.querySelectorAll('[id^="chat-messages-"], [class*="messageListItem"]'));
        var seen = new Set();

        nodes.forEach(function(node) {
          var route = routeOfMessage(node);
          var contentEl = node.querySelector('[id^="message-content-"], [class*="messageContent"]');
          if (!contentEl) return;

          var key = route.message_id || textOf(contentEl);
          if (!key || seen.has(key)) return;
          seen.add(key);

          var authorEl = node.querySelector('[class*="username"], [class*="headerText"] span, h3 span');
          var timeEl = node.querySelector('time');
          results.push({
            Author: textOf(authorEl) || '—',
            Time: timeEl ? (timeEl.getAttribute('datetime') || textOf(timeEl)) : '',
            Message: textOf(contentEl).slice(0, 300),
            ...(route.channel_id ? { channel_id: route.channel_id } : {}),
            ...(route.message_id ? { message_id: route.message_id } : {})
          });
        });

        return results.slice(-limit);
      })(${limit})
    `;
}

export function buildListThreadsScript(limit) {
    const max = Math.max(1, parseInt(String(limit), 10) || 30);
    return `
      (function __opencliDiscordListThreads(limit) {
        function parseRoute(raw) {
          try {
            var url = new URL(raw, 'https://discord.com');
            var parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'channels' || parts.length < 4) return null;
            return { guild_id: parts[1], channel_id: parts[2], thread_id: parts[3], url: 'https://discord.com/channels/' + parts[1] + '/' + parts[2] + '/' + parts[3] };
          } catch (_) {
            return null;
          }
        }

        function clean(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }

        function firstUsefulLine(text) {
          var lines = String(text || '').split(/\\n+/).map(clean).filter(Boolean);
          return lines.find(function(line) {
            return !/^(new|unread|locked|pinned|thread|post)$/i.test(line);
          }) || '';
        }

        var rows = [];
        var seen = new Set();
        var links = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
        links.forEach(function(link) {
          if (link.closest('[id^="chat-messages-"], [class*="messageListItem"]')) return;
          var route = parseRoute(link.getAttribute('href') || '');
          if (!route || seen.has(route.thread_id)) return;
          var card = link.closest('[role="listitem"], li, article, [class*="container_"], [class*="card_"], [class*="mainCard_"]') || link;
          var label = clean(link.getAttribute('aria-label') || link.getAttribute('title') || '');
          var titleEl = card.querySelector('[class*="title"], [class*="name"], h3, h2, strong');
          var title = clean(titleEl && titleEl.textContent) || label || firstUsefulLine(card.textContent);
          if (!title) return;
          var authorEl = card.querySelector('[class*="username"], [class*="author"], [class*="user"]');
          var timeEl = card.querySelector('time');
          rows.push({
            Index: rows.length + 1,
            Thread: title.slice(0, 140),
            Author: clean(authorEl && authorEl.textContent),
            Updated: timeEl ? (timeEl.getAttribute('datetime') || clean(timeEl.textContent)) : '',
            Preview: firstUsefulLine(card.textContent).slice(0, 240),
            guild_id: route.guild_id,
            channel_id: route.channel_id,
            thread_id: route.thread_id,
            url: route.url
          });
          seen.add(route.thread_id);
        });

        return rows.slice(0, limit);
      })(${max})
    `;
}

export function buildRouteStateScript() {
    return `
      (function __opencliDiscordRouteState() {
        function parseRoute(raw) {
          try {
            var url = new URL(raw, 'https://discord.com');
            var parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'channels' || parts.length < 3) return null;
            return { guild_id: parts[1], channel_id: parts[2], thread_id: parts[3] || '' };
          } catch (_) {
            return null;
          }
        }
        return {
          url: window.location.href,
          title: document.title,
          route: parseRoute(window.location.href),
          has_messages: !!document.querySelector('[id^="chat-messages-"], [class*="messageListItem"]'),
          has_threads: !!document.querySelector('a[href*="/channels/"][href*="/"]'),
          has_header: !!document.querySelector('[class*="title"], [aria-label*="Channel"], [aria-label*="频道"]')
        };
      })()
    `;
}

async function getCurrentDiscordRoute(page) {
    const state = requireObjectEvaluateResult(await page.evaluate(buildRouteStateScript()), 'Discord route state');
    if (state && state.route) return state.route;
    const url = typeof state?.url === 'string' ? state.url : '';
    return parseDiscordChannelUrl(url);
}

export async function listDiscordChannels(page) {
    return requireRowsWithFields(
        requireArrayEvaluateResult(await page.evaluate(buildListChannelsScript()), 'Discord channel list'),
        ['Channel', 'guild_id', 'channel_id', 'url'],
        'Discord channel list',
    );
}

export async function listDiscordServers(page) {
    return requireRowsWithFields(
        requireArrayEvaluateResult(await page.evaluate(buildListServersScript()), 'Discord server list'),
        ['Server', 'guild_id', 'url'],
        'Discord server list',
    );
}

function rowMatchesChannel(row, channel) {
    if (!channel) return false;
    if (String(row.channel_id || '') === channel) return true;
    return normalizeDiscordName(row.Channel) === normalizeDiscordName(channel);
}

function rowMatchesGuild(row, guild) {
    if (!guild) return true;
    return String(row.guild_id || '') === guild || normalizeDiscordName(row.Server) === normalizeDiscordName(guild);
}

export async function resolveDiscordChannelTarget(page, kwargs = {}, options = {}) {
    const urlArg = stringArg(kwargs.url);
    if (urlArg) {
        const parsed = parseDiscordChannelUrl(urlArg);
        if (!parsed || parsed.thread_id) {
            throw new ArgumentError('--url must be a Discord channel URL like https://discord.com/channels/<guild_id>/<channel_id>.');
        }
        return parsed;
    }

    const guildArg = stringArg(kwargs.guild);
    const channelArg = stringArg(kwargs.channel);
    if (!guildArg && !channelArg) {
        if (options.required) {
            throw new ArgumentError('Pass --url or --guild/--channel to choose a Discord channel.');
        }
        return null;
    }
    if (!channelArg) {
        throw new ArgumentError('Pass --channel with --guild, or use --url.');
    }

    let guildId = guildArg;
    if (guildArg && !isDiscordSnowflake(guildArg) && guildArg !== '@me') {
        const server = (await listDiscordServers(page)).find((row) => rowMatchesGuild(row, guildArg));
        if (server?.guild_id) guildId = String(server.guild_id);
    }

    if (guildId && isDiscordSnowflake(guildId) && isDiscordSnowflake(channelArg)) {
        return {
            guild_id: guildId,
            channel_id: channelArg,
            url: buildDiscordChannelUrl({ guildId, channelId: channelArg }),
        };
    }

    const channels = await listDiscordChannels(page);
    const match = channels.find((row) => rowMatchesGuild(row, guildId) && rowMatchesChannel(row, channelArg));
    if (match) {
        return {
            guild_id: String(match.guild_id),
            channel_id: String(match.channel_id),
            url: String(match.url || buildDiscordChannelUrl({ guildId: match.guild_id, channelId: match.channel_id })),
        };
    }

    if (!guildId && isDiscordSnowflake(channelArg)) {
        const route = await getCurrentDiscordRoute(page);
        if (route?.guild_id) {
            return {
                guild_id: route.guild_id,
                channel_id: channelArg,
                url: buildDiscordChannelUrl({ guildId: route.guild_id, channelId: channelArg }),
            };
        }
    }

    throw new ArgumentError(
        `Could not resolve Discord channel "${channelArg}".`,
        'Use "opencli discord-app channels -f json" and retry with --url or numeric --guild/--channel ids.',
    );
}

export async function waitForDiscordRoute(page, target, options = {}) {
    const timeoutMs = options.timeoutMs ?? 8000;
    const intervalSeconds = options.intervalSeconds ?? 0.5;
    const started = Date.now();
    let lastState = null;

    while (Date.now() - started <= timeoutMs) {
        lastState = requireObjectEvaluateResult(await page.evaluate(buildRouteStateScript()), 'Discord route state');
        const route = lastState?.route;
        if (route && String(route.guild_id) === String(target.guild_id) && String(route.channel_id) === String(target.channel_id)) {
            if (!target.thread_id || String(route.thread_id || '') === String(target.thread_id)) {
                return lastState;
            }
        }
        await page.wait(intervalSeconds);
    }

    throw new CommandExecutionError(
        'Discord did not finish navigating to the requested channel.',
        `Last observed URL: ${lastState?.url || 'unknown'}`,
    );
}

export async function waitForDiscordContent(page, kind = 'messages', options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const intervalSeconds = options.intervalSeconds ?? 0.5;
    const started = Date.now();
    let lastState = null;

    while (Date.now() - started <= timeoutMs) {
        lastState = requireObjectEvaluateResult(await page.evaluate(buildRouteStateScript()), 'Discord route state');
        if (kind === 'messages' && lastState?.has_messages) return lastState;
        if (kind === 'threads' && lastState?.has_threads) return lastState;
        await page.wait(intervalSeconds);
    }

    return lastState;
}

export async function navigateToDiscordTarget(page, target, options = {}) {
    await page.goto(target.url, { waitUntil: 'none', settleMs: options.settleMs ?? 1000 });
    const state = await waitForDiscordRoute(page, target, options);
    if (options.waitForContent === 'messages' || options.waitForContent === 'threads') {
        return waitForDiscordContent(page, options.waitForContent, {
            timeoutMs: options.contentTimeoutMs ?? 5000,
            intervalSeconds: options.intervalSeconds ?? 0.5,
        });
    }
    return state;
}

export async function maybeNavigateToDiscordChannel(page, kwargs = {}, options = {}) {
    if (!hasDiscordChannelTarget(kwargs)) return null;
    const target = await resolveDiscordChannelTarget(page, kwargs, { required: true });
    await navigateToDiscordTarget(page, target, options);
    return target;
}

export async function readDiscordMessages(page, count) {
    return requireArrayEvaluateResult(await page.evaluate(buildReadMessagesScript(count)), 'Discord message list');
}

export async function listDiscordThreads(page, limit) {
    return requireRowsWithFields(
        requireArrayEvaluateResult(await page.evaluate(buildListThreadsScript(limit)), 'Discord thread list'),
        ['Thread', 'guild_id', 'channel_id', 'thread_id', 'url'],
        'Discord thread list',
    );
}

export function assertDiscordMessageRowsBelongToTarget(rows, target, context = 'Discord read') {
    if (!target) return rows;
    const expectedChannelId = String(target.thread_id || target.channel_id || '');
    if (!expectedChannelId) {
        throw new CommandExecutionError(`${context} target is missing a stable channel/thread id.`);
    }
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new CommandExecutionError(`${context} returned malformed message rows.`);
        }
        const actualChannelId = row.channel_id == null || row.channel_id === '' ? '' : String(row.channel_id);
        if (!actualChannelId) {
            throw new CommandExecutionError(
                `${context} could not verify returned message target.`,
                `Expected channel/thread id ${expectedChannelId}, but the message row did not include channel_id.`,
            );
        }
        if (actualChannelId && actualChannelId !== expectedChannelId) {
            throw new CommandExecutionError(
                `${context} returned messages from the wrong Discord target.`,
                `Expected channel/thread id ${expectedChannelId}, saw ${actualChannelId}.`,
            );
        }
    }
    return rows;
}

export async function resolveDiscordThreadTarget(page, kwargs = {}) {
    const urlArg = stringArg(kwargs.url);
    if (urlArg) {
        const parsed = parseDiscordChannelUrl(urlArg);
        if (!parsed || !parsed.thread_id) {
            throw new ArgumentError('--url must be a Discord thread/post URL like https://discord.com/channels/<guild_id>/<channel_id>/<thread_id>.');
        }
        return parsed;
    }

    const threadArg = stringArg(kwargs.thread);
    if (!threadArg) {
        throw new ArgumentError('Pass --thread <thread_id> or --url <thread_url>.');
    }

    const parsedThreadUrl = parseDiscordChannelUrl(threadArg);
    if (parsedThreadUrl?.thread_id) return parsedThreadUrl;

    const channelTarget = hasDiscordChannelTarget(kwargs)
        ? await resolveDiscordChannelTarget(page, kwargs, { required: true })
        : null;
    if (channelTarget) {
        return {
            guild_id: channelTarget.guild_id,
            channel_id: channelTarget.channel_id,
            thread_id: threadArg,
            url: buildDiscordChannelUrl({
                guildId: channelTarget.guild_id,
                channelId: channelTarget.channel_id,
                threadId: threadArg,
            }),
        };
    }

    const current = await getCurrentDiscordRoute(page);
    if (current?.guild_id && current?.channel_id) {
        return {
            guild_id: current.guild_id,
            channel_id: current.channel_id,
            thread_id: threadArg,
            url: buildDiscordChannelUrl({
                guildId: current.guild_id,
                channelId: current.channel_id,
                threadId: threadArg,
            }),
        };
    }

    throw new ArgumentError(
        `Could not resolve Discord thread "${threadArg}".`,
        'Open the parent forum/channel first, or pass --guild and --channel ids with --thread.',
    );
}
