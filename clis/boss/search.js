/**
 * BOSS直聘 job search — browser cookie API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { requirePage, navigateTo, bossFetch, verbose } from './utils.js';
/** City name → BOSS Zhipin city code mapping */
const CITY_CODES = {
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
const EXP_MAP = {
    '不限': '0',
    '在校/应届': '108',
    '在校生': '108', '在校': '108',
    '应届生': '102', '应届': '102',
    '经验不限': '101',
    '1年以内': '103',
    '1-3年': '104',
    '3-5年': '105',
    '5-10年': '106',
    '10年以上': '107',
};
const DEGREE_MAP = {
    '不限': '0', '初中及以下': '209', '中专/中技': '208', '高中': '206',
    '大专': '202', '本科': '203', '硕士': '204', '博士': '205',
};
const SALARY_MAP = {
    '不限': '0', '3K以下': '401', '3-5K': '402', '5-10K': '403',
    '10-15K': '404', '15-20K': '405', '20-30K': '406', '30-50K': '407', '50K以上': '408',
};
const INDUSTRY_MAP = {
    '不限': '0', '互联网': '100020', '电子商务': '100021', '游戏': '100024',
    '人工智能': '100901', '大数据': '100902', '金融': '100101',
    '教育培训': '100200', '医疗健康': '100300',
};
const JOB_TYPE_MAP = {
    '不限': '0', '全职': '1901', '实习': '1902', '兼职': '1903',
};
const JOB_TYPE_CODES = new Set(Object.values(JOB_TYPE_MAP));
function resolveCity(input) {
    if (!input)
        return '101010100';
    if (/^\d+$/.test(input))
        return input;
    if (CITY_CODES[input])
        return CITY_CODES[input];
    for (const [name, code] of Object.entries(CITY_CODES)) {
        if (name.includes(input))
            return code;
    }
    return '101010100';
}
function resolveMap(input, map) {
    if (!input)
        return '';
    if (map[input] !== undefined)
        return map[input];
    for (const [key, val] of Object.entries(map)) {
        if (key.includes(input))
            return val;
    }
    return input;
}
function resolveJobType(input) {
    if (!input)
        return '';
    if (JOB_TYPE_MAP[input] !== undefined)
        return JOB_TYPE_MAP[input];
    if (JOB_TYPE_CODES.has(input))
        return input;
    throw new ArgumentError(`Invalid jobType: ${input}`, 'Use one of: 全职, 兼职, 实习, 不限');
}
function formatBossOnline(value) {
    if (value === true)
        return 'Y';
    if (value === false)
        return 'N';
    return '';
}
cli({
    site: 'boss',
    name: 'search',
    access: 'read',
    description: 'BOSS直聘搜索职位（不带关键词时返回为你推荐职位）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'query', positional: true, help: 'Search keyword (optional, empty = recommended jobs)' },
        { name: 'city', default: '北京', help: 'City name or code (e.g. 杭州, 上海, 101010100)' },
        { name: 'experience', default: '', help: 'Experience: 在校生(实习)/应届生(校招)/经验不限/1年以内/1-3年/3-5年/5-10年/10年以上' },
        { name: 'degree', default: '', help: 'Degree: 大专/本科/硕士/博士' },
        { name: 'salary', default: '', help: 'Salary: 3K以下/3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上' },
        { name: 'industry', default: '', help: 'Industry code or name (e.g. 100020, 互联网)' },
        { name: 'jobType', default: '', help: 'Job type: 全职/兼职/实习（不传=不限，混合校招与实习）' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
    ],
    columns: ['name', 'salary', 'company', 'area', 'experience', 'degree', 'skills', 'boss', 'bossOnline', 'security_id', 'url'],
    func: async (page, kwargs) => {
        requirePage(page);
        const query = String(kwargs.query ?? '').trim();
        const cityCode = resolveCity(kwargs.city);
        verbose('Navigating to set referrer context...');
        await navigateTo(page, `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(query)}&city=${cityCode}`);
        await new Promise(r => setTimeout(r, 1000));
        const expVal = resolveMap(kwargs.experience, EXP_MAP);
        const degreeVal = resolveMap(kwargs.degree, DEGREE_MAP);
        const salaryVal = resolveMap(kwargs.salary, SALARY_MAP);
        const industryVal = resolveMap(kwargs.industry, INDUSTRY_MAP);
        const jobTypeVal = resolveJobType(kwargs.jobType);
        const limit = kwargs.limit || 15;
        let currentPage = kwargs.page || 1;
        let allJobs = [];
        const seenIds = new Set();
        while (allJobs.length < limit) {
            if (allJobs.length > 0) {
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            }
            const qs = new URLSearchParams({
                scene: '1',
                query,
                city: cityCode,
                page: String(currentPage),
                pageSize: '15',
            });
            if (expVal)
                qs.set('experience', expVal);
            if (degreeVal)
                qs.set('degree', degreeVal);
            if (salaryVal)
                qs.set('salary', salaryVal);
            if (industryVal)
                qs.set('industry', industryVal);
            if (jobTypeVal)
                qs.set('jobType', jobTypeVal);
            const targetUrl = `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?${qs.toString()}`;
            verbose(`Fetching page ${currentPage}... (current jobs: ${allJobs.length})`);
            const data = await bossFetch(page, targetUrl);
            const zpData = data.zpData || {};
            const batch = zpData.jobList || [];
            if (batch.length === 0)
                break;
            let addedInBatch = 0;
            for (const j of batch) {
                if (!j.encryptJobId || seenIds.has(j.encryptJobId))
                    continue;
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
                    bossOnline: formatBossOnline(j.bossOnline),
                    security_id: j.securityId || '',
                    url: 'https://www.zhipin.com/job_detail/' + j.encryptJobId + '.html',
                });
                addedInBatch++;
                if (allJobs.length >= limit)
                    break;
            }
            if (addedInBatch === 0) {
                verbose(`API returned duplicate page, stopping pagination at ${allJobs.length} items`);
                break;
            }
            if (!zpData.hasMore)
                break;
            currentPage++;
        }
        return allJobs;
    },
});
export const __test__ = {
    EXP_MAP,
    resolveMap,
    resolveJobType,
    formatBossOnline,
};
