import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { mubuPost, nodesToMarkdown, nodesToText, htmlToText } from './utils.js';

// ── 日期工具 ──────────────────────────────────────────────

function localToday() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function validateYear(year, label = '年份') {
  if (!Number.isInteger(year) || year < 1) {
    throw new ArgumentError(`${label} 非法：${year}，应为正整数`);
  }
}

function validateMonth(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ArgumentError(`月份非法：${month}，应为 1-12`);
  }
}

function validateDay(year, month, day) {
  const maxDay = lastDayOfMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > maxDay) {
    throw new ArgumentError(`日期非法：${year}-${month}-${day}（${year} 年 ${month} 月共 ${maxDay} 天）`);
  }
}

function parseDate(s) {
  const parts = s.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new ArgumentError(`日期格式错误：${s}，应为 YYYY-MM-DD`);
  }
  const [year, month, day] = parts;
  validateYear(year);
  validateMonth(month);
  validateDay(year, month, day);
  return { year, month, day };
}

function parseMonth(s) {
  const parts = s.split('-').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) {
    throw new ArgumentError(`月份格式错误：${s}，应为 YYYY-MM`);
  }
  const [year, month] = parts;
  validateYear(year);
  validateMonth(month);
  return { year, month };
}

function dateToKey(d) {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** 将各种时间参数统一解析为 {start, end} */
function resolveRange(kwargs) {
  const dateStr = kwargs.date;
  const monthStr = kwargs.month;
  const yearArg = kwargs.year;
  const fromStr = kwargs.from;
  const toStr = kwargs.to;

  // --from / --to 优先级最高
  if (fromStr || toStr) {
    if (!fromStr) throw new ArgumentError('使用 --to 时必须同时指定 --from');
    const start = parseDate(fromStr);
    const end = toStr ? parseDate(toStr) : localToday();
    if (dateToKey(start) > dateToKey(end)) throw new ArgumentError('--from 不能晚于 --to');
    return { start, end };
  }

  if (yearArg !== undefined && yearArg !== null) {
    validateYear(yearArg, '--year');
    return {
      start: { year: yearArg, month: 1, day: 1 },
      end: { year: yearArg, month: 12, day: 31 },
    };
  }

  if (monthStr) {
    const { year, month } = parseMonth(monthStr);
    return {
      start: { year, month, day: 1 },
      end: { year, month, day: lastDayOfMonth(year, month) },
    };
  }

  if (dateStr) {
    const d = parseDate(dateStr);
    return { start: d, end: d };
  }

  // 默认：今天
  const today = localToday();
  return { start: today, end: today };
}

// ── API 工具 ──────────────────────────────────────────────

async function getYearDocId(page, year) {
  const raw = await page.evaluate(`localStorage.getItem('daily_notes_doc_list')`);
  if (!raw) return null;
  const list = JSON.parse(raw);
  return list.find((d) => d.name === `${year}年`)?.id ?? null;
}

async function getYearNodes(page, docId) {
  const data = await mubuPost(page, '/document/edit/get', { docId });
  const def = JSON.parse(data.definition);
  return def.nodes ?? [];
}

/** 加载某年的所有 day 节点，返回带 dateKey 的列表 */
async function loadYearEntries(page, year) {
  const docId = await getYearDocId(page, year);
  if (!docId) return [];

  const yearNodes = await getYearNodes(page, docId);
  const entries = [];

  for (const monthNode of yearNodes) {
    const monthNum = parseInt(htmlToText(monthNode.text), 10);
    if (!monthNode.children?.length) continue;

    for (const dayNode of monthNode.children) {
      const plain = htmlToText(dayNode.text).replace(/\s+/g, ' ').trim();
      const compact = plain.replace(/\s/g, '');
      const match = compact.match(/^(\d+)月(\d+)日/);
      if (!match) continue;
      const m = parseInt(match[1], 10);
      const d = parseInt(match[2], 10);
      if (m !== monthNum) continue;

      const dateKey = dateToKey({ year, month: m, day: d });
      entries.push({ dateKey, label: plain, node: dayNode });
    }
  }

  return entries;
}

/** 收集 [start, end] 范围内涉及的所有年份 */
function yearsInRange(start, end) {
  const years = [];
  for (let y = start.year; y <= end.year; y++) years.push(y);
  return years;
}

// ── 命令 ──────────────────────────────────────────────────

cli({
  site: 'mubu',
  name: 'notes',
  description: '读取幕布速记（默认今天）。支持 --date/--month/--year/--from/--to 指定时间范围，--list 为概览模式（日期+条数）。',
  domain: 'mubu.com',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'list',
      type: 'bool',
      default: false,
      help: '概览模式：只输出日期和条数，不含速记内容。可与任意时间范围参数组合。',
    },
    {
      name: 'date',
      help: '单日，格式 YYYY-MM-DD。不指定时间范围则默认今天（系统本地时间）。',
    },
    {
      name: 'month',
      help: '整月，格式 YYYY-MM。',
    },
    {
      name: 'year',
      type: 'int',
      help: '整年，格式 YYYY（整数）。',
    },
    {
      name: 'from',
      help: '范围起始日，格式 YYYY-MM-DD。须与 --to 同时使用。',
    },
    {
      name: 'to',
      help: '范围截止日，格式 YYYY-MM-DD。须与 --from 同时使用。',
    },
    {
      name: 'output',
      default: 'md',
      help: '输出格式：md（默认，Markdown）或 text（纯文本）',
    },
  ],
  columns: ['date', 'content'],
  func: async (page, kwargs) => {
    const isList = kwargs.list;
    const format = kwargs.output;
    if (format !== 'md' && format !== 'text') {
      throw new ArgumentError(`--output 只接受 md 或 text，收到：${format}`);
    }

    await page.goto('https://mubu.com/app');

    const { start, end } = resolveRange(kwargs);
    const startKey = dateToKey(start);
    const endKey = dateToKey(end);

    // 并行加载所有涉及年份的 day 节点，按范围过滤
    const yearResults = await Promise.all(
      yearsInRange(start, end).map((year) => loadYearEntries(page, year)),
    );
    const allEntries = yearResults
      .flat()
      .filter((e) => e.dateKey >= startKey && e.dateKey <= endKey);

    if (allEntries.length === 0) {
      const label = startKey === endKey ? startKey : `${startKey} ~ ${endKey}`;
      return [{ date: label, content: '该时间段暂无速记' }];
    }

    // 概览模式
    if (isList) {
      return allEntries.map((e) => ({
        date: e.label,
        content: `${e.node.children?.length ?? 0} 条记录`,
      }));
    }

    // 内容模式
    const render = (children) =>
      format === 'text' ? nodesToText(children) : nodesToMarkdown(children);

    return allEntries
      .filter((e) => e.node.children?.length)
      .map((e) => ({
        date: e.label,
        content: render(e.node.children ?? []) || '（空）',
      }));
  },
});
