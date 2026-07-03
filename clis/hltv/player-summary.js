import { cli, Strategy } from '@jackwener/opencli/registry';
import { BASE, assertRequiredFields, buildPlayerUrl, gotoAndWait, parseMoneyUsd, parseNumber, parsePlayerRef } from './utils.js';

cli({
  site: 'hltv',
  name: 'player-summary',
  description: 'Read an HLTV player summary page',
  access: 'read',
  example: 'opencli hltv player-summary --player 3741/niko -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'player', type: 'string', default: '3741/niko', help: 'Player ref: 3741/niko or https://www.hltv.org/player/3741/niko' },
  ],
  columns: ['playerId', 'slug', 'nickname', 'fullName', 'age', 'teamName', 'prizeMoneyUsd', 'maps', 'rating', 'roles', 'completeStatsUrl', 'url'],
  func: async (page, args) => {
    const { playerId, slug } = parsePlayerRef(args.player);
    const url = buildPlayerUrl(args.player);

    await gotoAndWait(page, url, '.playerProfile', 'hltv player summary page');

    const rows = await page.evaluate((payload) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const lines = document.body.innerText.split('\n').map(clean).filter(Boolean);
      const numberFrom = (value) => {
        const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      };
      const nextAfter = (label) => {
        const idx = lines.findIndex((line) => line === label);
        return idx >= 0 ? lines[idx + 1] ?? null : null;
      };
      const statAfter = (label) => {
        const idx = lines.findIndex((line) => line === label);
        if (idx < 0) return null;
        for (let i = idx + 1; i < Math.min(lines.length, idx + 5); i += 1) {
          const n = numberFrom(lines[i]);
          if (n !== null) return n;
        }
        return null;
      };

      const nickname = clean(document.querySelector('.playerNickname')?.textContent) || payload.slug;
      const fullName = clean(document.querySelector('.playerRealname')?.textContent).replace(/^[-\s]+/, '') || null;
      const age = numberFrom(nextAfter('Age'));
      const teamName = nextAfter('Current team');
      const prizeMoneyUsd = numberFrom(nextAfter('Prize money (?)'));
      const completeLink = [...document.querySelectorAll('a[href]')].find((a) => /\/stats\/players\/\d+\//.test(a.getAttribute('href') || ''));
      const statsHeadingIdx = lines.findIndex((line) => line === `${nickname} statistics`);
      const statsPeriodLine = statsHeadingIdx >= 0 ? lines[statsHeadingIdx + 1] : null;
      const statsPeriod = statsPeriodLine ? statsPeriodLine.replace(/^\(|\)$/g, '') : null;
      const mapsMatch = statsPeriod ? statsPeriod.match(/([\d,]+)\s+maps/i) : null;

      return [{
        playerId: payload.playerId,
        slug: payload.slug,
        nickname,
        fullName,
        age,
        teamName,
        prizeMoneyUsd,
        statsPeriod,
        maps: mapsMatch ? numberFrom(mapsMatch[1]) : null,
        rating: statAfter('Rating 3.0'),
        firepower: statAfter('Firepower'),
        entrying: statAfter('Entrying'),
        trading: statAfter('Trading'),
        opening: statAfter('Opening'),
        clutching: statAfter('Clutching'),
        sniping: statAfter('Sniping'),
        utility: statAfter('Utility'),
        completeStatsUrl: completeLink ? new URL(completeLink.getAttribute('href'), payload.base).toString() : null,
        url: payload.url,
      }];
    }, { base: BASE, playerId, slug, url: url.toString() });

    return assertRequiredFields(rows.map((row) => ({
      playerId: row.playerId,
      slug: row.slug,
      nickname: row.nickname,
      fullName: row.fullName,
      age: parseNumber(row.age),
      teamName: row.teamName,
      prizeMoneyUsd: parseMoneyUsd(row.prizeMoneyUsd),
      maps: parseNumber(row.maps),
      rating: parseNumber(row.rating),
      roles: {
        statsPeriod: row.statsPeriod,
        firepower: parseNumber(row.firepower),
        entrying: parseNumber(row.entrying),
        trading: parseNumber(row.trading),
        opening: parseNumber(row.opening),
        clutching: parseNumber(row.clutching),
        sniping: parseNumber(row.sniping),
        utility: parseNumber(row.utility),
      },
      completeStatsUrl: row.completeStatsUrl,
      url: row.url,
    })), 'hltv player-summary', ['playerId', 'slug', 'nickname', 'completeStatsUrl', 'url']);
  },
});
