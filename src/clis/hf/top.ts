import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

interface PaperAuthor {
  name: string;
}

interface DailyPaper {
  paper: {
    id: string;
    upvotes: number;
    authors: PaperAuthor[];
  };
  title: string;
  numComments: number;
}

interface PeriodPaper {
  id: string;
  title: string;
  upvotes: number;
  publishedAt: string;
  authors: PaperAuthor[];
}

function truncate(str: string, max = 60): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function formatAuthors(authors: PaperAuthor[], max = 3): string {
  const names = authors.map((a) => a.name);
  if (names.length <= max) return names.join(', ');
  return names.slice(0, max).join(', ') + ' et al.';
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getMonthRange(): string {
  const now = new Date();
  return `${MONTH_ABBR[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
}

function getWeekRange(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const daysToSat = day === 6 ? 0 : 6 - day;
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() + daysToSat);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);

  const sm = MONTH_ABBR[start.getUTCMonth()];
  const em = MONTH_ABBR[end.getUTCMonth()];
  const sd = start.getUTCDate();
  const ed = end.getUTCDate();
  return sm === em ? `${sm} ${sd}-${ed}` : `${sm} ${sd}-${em} ${ed}`;
}

cli({
  site: 'hf',
  name: 'top',
  description: 'Top upvoted Hugging Face papers',
  domain: 'huggingface.co',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of papers' },
    { name: 'all', type: 'bool', default: false, help: 'Return all papers (ignore limit)' },
    { name: 'date', type: 'str', required: false, help: 'Date (YYYY-MM-DD), defaults to most recent' },
    { name: 'period', type: 'str', default: 'daily', choices: ['daily', 'weekly', 'monthly'], help: 'Time period: daily, weekly, or monthly' },
  ],
  footerExtra: (kwargs) => {
    if (kwargs._footerDate) return kwargs._footerDate;
    if (kwargs.period === 'monthly') return getMonthRange();
    if (kwargs.period === 'weekly') return getWeekRange();
    return kwargs.date ?? new Date().toISOString().slice(0, 10);
  },
  func: async (_page, kwargs) => {
    const period = String(kwargs.period ?? 'daily');
    const all = Boolean(kwargs.all);
    const endpoint = process.env.HF_ENDPOINT?.replace(/\/+$/, '') || 'https://huggingface.co';

    if (period === 'weekly' || period === 'monthly') {
      if (kwargs.date) {
        throw new CliError('INVALID_ARG', `--date is not supported for ${period} period`, `Omit --date when using --period ${period}`);
      }
      const url = `${endpoint}/api/papers?period=${period}`;
      const res = await fetch(url);
      if (!res.ok) throw new CliError('FETCH_ERROR', `HF API error: ${res.status} ${res.statusText}`, 'Check HF_ENDPOINT or try again later');
      const body = await res.json();
      if (!Array.isArray(body)) throw new CliError('FETCH_ERROR', 'Unexpected HF API response', 'Check endpoint');
      const data: PeriodPaper[] = body;
      const dates = data.map((d) => d.publishedAt).filter(Boolean).sort();
      if (dates.length > 0) {
        if (period === 'monthly') {
          const d = new Date(dates[0]);
          kwargs._footerDate = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        } else {
          const start = new Date(dates[0]);
          const end = new Date(dates[dates.length - 1]);
          const sm = MONTH_ABBR[start.getUTCMonth()];
          const em = MONTH_ABBR[end.getUTCMonth()];
          const sd = start.getUTCDate();
          const ed = end.getUTCDate();
          kwargs._footerDate = sm === em ? `${sm} ${sd}-${ed}` : `${sm} ${sd}-${em} ${ed}`;
        }
      }
      const sorted = [...data].sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0));
      const items = all ? sorted : sorted.slice(0, Number(kwargs.limit));
      return items.map((item, i) => ({
        rank: i + 1,
        id: item.id ?? '',
        title: truncate(item.title ?? ''),
        upvotes: item.upvotes ?? 0,
        authors: formatAuthors(item.authors ?? []),
      }));
    }

    // daily
    if (kwargs.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(kwargs.date))) {
      throw new CliError('INVALID_ARG', `Invalid date format: ${kwargs.date}`, 'Use YYYY-MM-DD');
    }
    const url = kwargs.date
      ? `${endpoint}/api/daily_papers?date=${kwargs.date}`
      : `${endpoint}/api/daily_papers`;
    const res = await fetch(url);
    if (!res.ok) throw new CliError('FETCH_ERROR', `HF API error: ${res.status} ${res.statusText}`, 'Check HF_ENDPOINT or try again later');
    const body = await res.json();
    if (!Array.isArray(body)) throw new CliError('FETCH_ERROR', 'Unexpected HF API response', 'Check date format or endpoint');
    const data: DailyPaper[] = body;
    const sorted = [...data].sort((a, b) => (b.paper?.upvotes ?? 0) - (a.paper?.upvotes ?? 0));
    const items = all ? sorted : sorted.slice(0, Number(kwargs.limit));
    return items.map((item, i) => ({
      rank: i + 1,
      id: item.paper?.id ?? '',
      title: truncate(item.title ?? ''),
      upvotes: item.paper?.upvotes ?? 0,
      authors: formatAuthors(item.paper?.authors ?? []),
    }));
  },
});
