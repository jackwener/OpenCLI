/**
 * 猎聘 h.liepin.com — 搜索候选人简历 (HR/猎头端)
 *
 * Calls POST api-h.liepin.com/api/com.liepin.searchfront4r.h.search-resumes
 * from the browser page context (credentials: include) with form-encoded body.
 * Requires the X-Fscp-* headers that liepin's gateway expects.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

/** City name → liepin dqCode mapping (from frontend React state) */
const CITY_CODES: Record<string, string> = {
  '北京': '010', '上海': '020', '天津': '030', '广州': '050020',
  '深圳': '050090', '苏州': '060080', '杭州': '070020', '南京': '060020',
  '成都': '280020', '武汉': '170020', '西安': '270020', '重庆': '040',
  '长沙': '180020', '郑州': '160020', '青岛': '250070', '大连': '210040',
  '东莞': '050030', '佛山': '050060', '宁波': '070030', '合肥': '130020',
  '福州': '110020', '厦门': '110040', '昆明': '290020', '珠海': '050050',
  '无锡': '060030', '济南': '250020', '哈尔滨': '220020', '沈阳': '210020',
  '石家庄': '240020', '南昌': '150020', '贵阳': '300020', '南宁': '310020',
  '太原': '260020', '海口': '330020', '兰州': '320020', '长春': '200020',
  '乌鲁木齐': '340020', '常州': '060050', '温州': '070060', '嘉兴': '070050',
  '徐州': '060070',
};

const EXP_MAP: Record<string, string> = {
  '应届': '0', '1-3': '03', '1-3年': '03', '3-5': '05', '3-5年': '05',
  '5-10': '10', '5-10年': '10', '10以上': '99', '10年以上': '99',
};

const DEGREE_MAP: Record<string, string> = {
  '大专': '30', '本科': '40', '硕士': '50', 'MBA': '55', '博士': '60',
};

const ACTIVE_MAP: Record<string, string> = {
  '不限': '0', '当天': '1', '3天': '3', '7天': '7', '30天': '30', '90天': '90',
  '1': '1', '3': '3', '7': '7', '30': '30', '90': '90',
};

function resolveCity(input: string): string {
  if (!input) return '';
  if (/^\d+$/.test(input)) return input;
  if (CITY_CODES[input]) return CITY_CODES[input];
  for (const [name, code] of Object.entries(CITY_CODES)) {
    if (name.includes(input) || input.includes(name)) return code;
  }
  return input;
}

function resolveMap(input: string | undefined, map: Record<string, string>): string {
  if (!input) return '';
  if (map[input] !== undefined) return map[input];
  for (const [key, val] of Object.entries(map)) {
    if (key.includes(input) || input.includes(key)) return val;
  }
  return input;
}

cli({
  site: 'liepin',
  name: 'search',
  description: '猎聘搜索候选人简历',
  domain: 'h.liepin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'keyword', required: true, positional: true, help: '搜索关键词 (职位/技能/公司名)' },
    { name: 'city', default: '', help: '期望城市 (如 北京、上海、深圳)' },
    { name: 'experience', default: '', help: '工作年限: 1-3/3-5/5-10/10以上' },
    { name: 'degree', default: '', help: '学历: 大专/本科/硕士/博士' },
    { name: 'active', default: '', help: '活跃度: 当天/3天/7天/30天/90天' },
    { name: 'page', type: 'int', default: 0, help: '起始页码 (从0开始)' },
    { name: 'pages', type: 'int', default: 1, help: '抓取页数 (默认1页，每页约15条)' },
    { name: 'limit', type: 'int', default: 0, help: '返回数量上限 (0=不限)' },
    { name: 'delay', type: 'int', default: 2, help: '翻页间隔秒数 (默认2秒)' },
  ],
  columns: ['summary', 'id'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const keyword = kwargs.keyword;
    const limit = kwargs.limit || 0;
    const startPage = kwargs.page || 0;
    const totalPages = kwargs.pages || 1;
    const delay = (kwargs.delay ?? 2) * 1000;
    const debug = !!(process.env.OPENCLI_VERBOSE || process.env.DEBUG?.includes('opencli'));

    // Navigate to the search page to establish session context
    await page.goto('https://h.liepin.com/search/getConditionItem/');
    await page.wait({ time: 2 });

    // Build base searchParams
    const baseParams: Record<string, any> = {
      keyword,
      curPage: 0,
      searchType: 0,
      sortType: '0',
      anyKeyword: '0',
      jobPeriod: '0',
      compPeriod: '0',
      resumetype: '0',
    };

    if (kwargs.city) {
      const cityCode = resolveCity(kwargs.city);
      baseParams.wantDqsOut = [{ dqCode: cityCode, dqName: kwargs.city }];
    }
    const expVal = resolveMap(kwargs.experience, EXP_MAP);
    if (expVal) baseParams.workYearsLow = expVal;
    const degreeVal = resolveMap(kwargs.degree, DEGREE_MAP);
    if (degreeVal) baseParams.eduLevels = [degreeVal];
    if (kwargs.active) {
      const activeVal = resolveMap(kwargs.active, ACTIVE_MAP);
      if (activeVal && activeVal !== '0') baseParams.jobPeriod = activeVal;
    }

    // Fetch one page via browser context
    async function fetchPage(pg: number): Promise<any> {
      const searchParams = { ...baseParams, curPage: pg };
      if (debug) console.error(`[opencli:liepin] Fetching page ${pg}...`);

      const data = await page!.evaluate(`
        (() => {
          const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
          const xsrfToken = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : '';
          const body = new URLSearchParams();
          body.append('searchParamsInputVo', ${JSON.stringify(JSON.stringify(searchParams))});
          body.append('logForm', '{}');
          return fetch('https://api-h.liepin.com/api/com.liepin.searchfront4r.h.search-resumes', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json, text/plain, */*',
              'X-XSRF-TOKEN': xsrfToken,
              'X-Requested-With': 'XMLHttpRequest',
              'X-Client-Type': 'web',
              'X-Fscp-Version': '1.1',
              'X-Fscp-Bi-Stat': JSON.stringify({location: window.location.href}),
              'X-Fscp-Std-Info': JSON.stringify({client_id: '11156'}),
              'X-Fscp-Trace-Id': crypto.randomUUID(),
            },
            body: body.toString(),
          })
          .then(r => r.json())
          .catch(e => ({ flag: 0, msg: e.message }));
        })()
      `);
      return data;
    }

    // Loop through pages
    const allResults: any[] = [];
    for (let pg = startPage; pg < startPage + totalPages; pg++) {
      if (pg > startPage && delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      const data = await fetchPage(pg);

      if (!data || data.flag !== 1) {
        if (pg === startPage) throw new Error(`猎聘 API 错误: ${data?.msg || JSON.stringify(data)}`);
        break; // subsequent page fails → stop
      }

      if (debug) {
        console.error(`[opencli:liepin] Page ${pg}: ${data.data?.resList?.length || 0} results (total: ${data.data?.totalCnt})`);
      }

      const resList = data.data?.resList || [];
      if (resList.length === 0) break; // no more results

      for (const r of resList) {
        const simple = r.simpleResumeForm || {};
        const id = simple.resIdEncode || r.usercIdEncode || '';

        const name = simple.resName || '?';
        const sex = simple.resSexName || '';
        const age = simple.resBirthYearAge != null ? simple.resBirthYearAge : null;
        const city = simple.wantDq || r.wantDq || simple.resDqName || '';
        const degree = simple.resEdulevelName || '';
        const experience = simple.resWorkyearAgeShow || '';
        const active = r.activeStatus?.name || '';
        const updated = (simple.updateTime || '').slice(0, 10);
        const currentTitle = simple.resTitle || '';
        const currentCompany = simple.resCompany || '';
        const wantJob = r.wantJobTitle || simple.wantJobTitle || '';
        const skills = simple.skillTags || [];
        const workHistory = (simple.workExpFormList || []).map((w: any) => ({
          start: w.rwStart || '',
          end: w.rwEnd || '',
          company: w.rwCompname || '',
          title: w.rwTitle || '',
          duration: w.rwPeriod || '',
        }));
        const education = (simple.eduExpForms || []).map((e: any) => ({
          school: e.red_school || '',
          major: e.red_special || '',
          degree: e.red_degree_name || '',
        }));

        const lines = [
          `${name} | ${sex}${age != null ? ' ' + age + '岁' : ''} | ${city} | ${degree} | ${experience} | ${active} | 更新${updated}`,
          `现任: ${currentTitle} @ ${currentCompany}`,
        ];
        if (wantJob) lines.push(`期望: ${wantJob}`);
        if (workHistory.length) lines.push(`经历: ${workHistory.map((w: {start:string;end:string;company:string;title:string;duration:string}) => `${w.start}~${w.end} ${w.company}/${w.title}(${w.duration})`).join(' → ')}`);
        if (education.length) lines.push(`学历: ${education.map((e: {school:string;major:string;degree:string}) => `${e.school}/${e.major}(${e.degree})`).join('; ')}`);
        if (skills.length) lines.push(`技能: ${skills.join(', ')}`);

        allResults.push({
          summary: lines.join('\n'),
          id,
          name, sex, age, city, degree, experience, active, updated,
          currentTitle, currentCompany, wantJob, skills,
          workHistory, education,
        });
        if (limit > 0 && allResults.length >= limit) break;
      }

      if (limit > 0 && allResults.length >= limit) break;
    }

    return limit > 0 ? allResults.slice(0, limit) : allResults;
  },
});
