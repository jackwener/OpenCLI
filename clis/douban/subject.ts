import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'douban',
  name: 'subject',
  description: '获取电影详情',
  domain: 'movie.douban.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', required: true, positional: true, help: '电影 ID' },
  ],
  columns: [
    'id',
    'title',
    'originalTitle',
    'year',
    'rating',
    'ratingCount',
    'genres',
    'directors',
    'casts',
    'country',
    'duration',
    'summary',
    'url',
  ],
  pipeline: [
    { navigate: 'https://movie.douban.com/subject/${{ args.id }}' },
    { evaluate: `(async () => {
  const id = '\${{ args.id }}';

  // Wait for page to load
  await new Promise(r => setTimeout(r, 2000));

  // Extract title - v:itemreviewed contains "中文名 OriginalName"
  const titleEl = document.querySelector('span[property="v:itemreviewed"]');
  const fullTitle = titleEl?.textContent?.trim() || '';

  // Split title and originalTitle
  // Douban format: "中文名 OriginalName" - split by first space that separates CJK from non-CJK
  let title = fullTitle;
  let originalTitle = '';
  const titleMatch = fullTitle.match(/^([\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]+(?:\\s*[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef·：:！？]+)*)\\s+(.+)$/);
  if (titleMatch) {
    title = titleMatch[1].trim();
    originalTitle = titleMatch[2].trim();
  }

  // Extract year
  const yearEl = document.querySelector('.year');
  const year = yearEl?.textContent?.trim().replace(/[()（）]/g, '') || '';

  // Extract rating
  const ratingEl = document.querySelector('strong[property="v:average"]');
  const rating = parseFloat(ratingEl?.textContent || '0');

  // Extract rating count
  const ratingCountEl = document.querySelector('span[property="v:votes"]');
  const ratingCount = parseInt(ratingCountEl?.textContent || '0', 10);

  // Extract genres
  const genreEls = document.querySelectorAll('span[property="v:genre"]');
  const genres = Array.from(genreEls).map(el => el.textContent?.trim()).filter(Boolean).join(',');

  // Extract directors
  const directorEls = document.querySelectorAll('a[rel="v:directedBy"]');
  const directors = Array.from(directorEls).map(el => el.textContent?.trim()).filter(Boolean).join(',');

  // Extract casts
  const castEls = document.querySelectorAll('a[rel="v:starring"]');
  const casts = Array.from(castEls).slice(0, 5).map(el => el.textContent?.trim()).filter(Boolean);

  // Extract info section for country and duration
  const infoEl = document.querySelector('#info');
  const infoText = infoEl?.textContent || '';

  // Extract country/region from #info as list
  let country = [];
  const countryMatch = infoText.match(/制片国家\\/地区:\\s*([^\\n]+)/);
  if (countryMatch) {
    country = countryMatch[1].trim().split(/\\s*\\/\\s*/).filter(Boolean);
  }

  // Extract duration from #info as pure number in min
  const durationEl = document.querySelector('span[property="v:runtime"]');
  let durationRaw = durationEl?.textContent?.trim() || '';
  if (!durationRaw) {
    const durationMatch = infoText.match(/片长:\\s*([^\\n]+)/);
    if (durationMatch) {
      durationRaw = durationMatch[1].trim();
    }
  }
  const durationNumMatch = durationRaw.match(/(\\d+)/);
  const duration = durationNumMatch ? parseInt(durationNumMatch[1], 10) : null;

  // Extract summary
  const summaryEl = document.querySelector('span[property="v:summary"]');
  const summary = summaryEl?.textContent?.trim() || '';

  return [{
    id,
    title,
    originalTitle,
    year,
    rating,
    ratingCount,
    genres,
    directors,
    casts,
    country,
    duration,
    summary: summary.substring(0, 200),
    url: \`https://movie.douban.com/subject/\${id}\`
  }];
})()
` },
  ],
});
