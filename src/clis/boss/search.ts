/**
 * BOSS直聘 job search — browser cookie API.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

/** City name → BOSS Zhipin city code mapping */
const CITY_CODES: Record<string, string> = {
  '全国': '100010000', '北京': '101010100', '上海': '101020100',
  '广州': '101280100', '深圳': '101280600', '杭州': '101210100',
  '成都': '101270100', '南京': '101190100', '武汉': '101200100',
  '西安': '101110100', '苏州': '101190400', '长沙': '101250100',
  '天津': '101030100', '重庆': '101040100', '郑州': '101180100',
  '东莞': '101281600', '青岛': '101120200', '合肥': '101220100',
  '佛山': '101280800', '宁波': '101210400', '厦门': '101230200',
  '大连': '101070200', '珠海': '101280700', '无锡': '101190200',
  '济南': '101120100', '福州': '101230100', '昆明': '101290100',
  '哈尔滨': '101050100', '沈阳': '101070100', '石家庄': '101090100',
  '贵阳': '101260100', '南宁': '101300100', '太原': '101100100',
  '海口': '101310100', '兰州': '101160100', '乌鲁木齐': '101130100',
  '长春': '101060100', '南昌': '101240100', '常州': '101191100',
  '温州': '101210700', '嘉兴': '101210300', '徐州': '101190800',
  '香港': '101320100',
};

const EXP_MAP: Record<string, string> = {
  '不限': '0', '在校/应届': '108', '应届': '108', '1年以内': '101',
  '1-3年': '102', '3-5年': '103', '5-10年': '104', '10年以上': '105',
};

const DEGREE_MAP: Record<string, string> = {
  '不限': '0', '初中及以下': '209', '中专/中技': '208', '高中': '206',
  '大专': '202', '本科': '203', '硕士': '204', '博士': '205',
};

const SALARY_MAP: Record<string, string> = {
  '不限': '0', '3K以下': '401', '3-5K': '402', '5-10K': '403',
  '10-15K': '404', '15-20K': '405', '20-30K': '406', '30-50K': '407', '50K以上': '408',
};

const INDUSTRY_MAP: Record<string, string> = {
  '不限': '0', '互联网': '100020', '电子商务': '100021', '游戏': '100024',
  '人工智能': '100901', '大数据': '100902', '金融': '100101',
  '教育培训': '100200', '医疗健康': '100300',
};

function resolveCity(input: string): string {
  if (!input) return '101010100';
  if (/^\d+$/.test(input)) return input;
  if (CITY_CODES[input]) return CITY_CODES[input];
  for (const [name, code] of Object.entries(CITY_CODES)) {
    if (name.includes(input)) return code;
  }
  return '101010100';
}

function resolveMap(input: string | undefined, map: Record<string, string>): string {
  if (!input) return '';
  if (map[input] !== undefined) return map[input];
  for (const [key, val] of Object.entries(map)) {
    if (key.includes(input)) return val;
  }
  return input;
}

cli({
  site: 'boss',
  name: 'search',
  description: 'BOSS直聘搜索职位',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,

  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. AI agent, 前端)' },
    { name: 'city', default: '北京', help: 'City name or code (e.g. 杭州, 上海, 101010100)' },
    { name: 'experience', default: '', help: 'Experience: 应届/1年以内/1-3年/3-5年/5-10年/10年以上' },
    { name: 'degree', default: '', help: 'Degree: 大专/本科/硕士/博士' },
    { name: 'salary', default: '', help: 'Salary: 3K以下/3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上' },
    { name: 'industry', default: '', help: 'Industry code or name (e.g. 100020, 互联网)' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['name', 'salary', 'company', 'area', 'experience', 'degree', 'skills', 'boss', 'security_id', 'url'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const cityCode = resolveCity(kwargs.city);
    
    if (process.env.OPENCLI_VERBOSE || process.env.DEBUG?.includes('opencli')) {
      console.error(`[opencli:boss] Navigating to set referrer context...`);
    }
    // Navigate to the Web search view first to establish proper referrer context
    // This is a lesson learned from boss-cli: referrer is important
    await page.goto(`https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(kwargs.query)}&city=${cityCode}`);
    
    // Give the page a tiny bit of time to settle to avoid immediate 403s
    await new Promise(r => setTimeout(r, 1000));

    const expVal = resolveMap(kwargs.experience, EXP_MAP);
    const degreeVal = resolveMap(kwargs.degree, DEGREE_MAP);
    const salaryVal = resolveMap(kwargs.salary, SALARY_MAP);
    const industryVal = resolveMap(kwargs.industry, INDUSTRY_MAP);

    const limit = kwargs.limit || 15;
    let currentPage = kwargs.page || 1;
    let allJobs: any[] = [];
    const seenIds = new Set<string>();

    while (allJobs.length < limit) {
      if (allJobs.length > 0) {
        // Human-like pause between page fetches (1-3 seconds)
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }

      const qs = new URLSearchParams({
        scene: '1',
        query: kwargs.query,
        city: cityCode,
        page: String(currentPage),
        pageSize: '15',
      });
      if (expVal) qs.set('experience', expVal);
      if (degreeVal) qs.set('degree', degreeVal);
      if (salaryVal) qs.set('salary', salaryVal);
      if (industryVal) qs.set('industry', industryVal);

      const targetUrl = `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?${qs.toString()}`;

      if (process.env.OPENCLI_VERBOSE || process.env.DEBUG?.includes('opencli')) {
        console.error(`[opencli:boss] Fetching page ${currentPage}... (current jobs: ${allJobs.length})`);
      }

      const evaluateScript = `
        async () => {
          return new Promise((resolve, reject) => {
            const xhr = new window.XMLHttpRequest();
            xhr.open('GET', '${targetUrl}', true);
            xhr.withCredentials = true;
            xhr.timeout = 15000; // 15s timeout
            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                  reject(new Error('Failed to parse JSON. Raw (200 chars): ' + xhr.responseText.substring(0, 200)));
                }
              } else {
                reject(new Error('XHR HTTP Status: ' + xhr.status));
              }
            };
            xhr.onerror = () => reject(new Error('XHR Network Error'));
            xhr.ontimeout = () => reject(new Error('XHR Timeout'));
            xhr.send();
          });
        }
      `;

      let data: any;
      try {
        data = await page.evaluate(evaluateScript);
      } catch (e: any) {
        throw new Error('API evaluate failed: ' + e.message);
      }

      if (data.code !== 0) {
        if (data.code === 37) {
           throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
        }
        throw new Error(`BOSS API error: ${data.message || 'Unknown'} (code=${data.code})\nRaw data: ${JSON.stringify(data)}`);
      }

      const zpData = data.zpData || {};
      const batch = zpData.jobList || [];
      if (batch.length === 0) {
        break; // No more results
      }

      let addedInBatch = 0;
      for (const j of batch) {
        if (!j.encryptJobId || seenIds.has(j.encryptJobId)) continue;
        seenIds.add(j.encryptJobId);
        
        allJobs.push({
          name: j.jobName,
          salary: j.salaryDesc,
          company: j.brandName,
          area: [j.cityName, j.areaDistrict, j.businessDistrict].filter(Boolean).join('·'),
          experience: j.jobExperience,
          degree: j.jobDegree,
          skills: (j.skills || []).join(','),
          boss: j.bossName + ' · ' + j.bossTitle,
          security_id: j.securityId || '',
          url: 'https://www.zhipin.com/job_detail/' + j.encryptJobId + '.html',
        });
        addedInBatch++;
        if (allJobs.length >= limit) break;
      }

      if (addedInBatch === 0) {
        // Boss API is repeating identical pages, we've hit the pagination limit
        if (process.env.OPENCLI_VERBOSE) console.error(`[opencli:boss] API returned duplicate page, stopping pagination at ${allJobs.length} items`);
        break;
      }

      if (!zpData.hasMore) {
        break; // API says no more pages
      }
      currentPage++;
    }

    return allJobs;
  },
});
