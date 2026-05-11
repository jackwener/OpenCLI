/**
 * Maimai talent search - Browser cookie API.
 * Reuses Chrome login session to search for candidates on maimai.cn
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'maimai',
  name: 'search-talents',
    access: 'read',
  description: 'Search for candidates on Maimai with multi-dimensional filters',
  domain: 'maimai.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword (e.g., "Java", "产品经理")' },
    { name: 'page', type: 'int', default: 0, help: 'Page number (0-based)' },
    { name: 'size', type: 'int', default: 20, help: 'Results per page' },
    { name: 'positions', help: 'Positions (e.g., "运营", "Java 开发工程师")' },
    { name: 'companies', help: 'Companies, comma-separated (e.g., "百度", "字节跳动，阿里巴巴")' },
    { name: 'schools', help: 'Schools, comma-separated (e.g., "北京大学", "清华大学，复旦大学")' },
    { name: 'provinces', help: 'Provinces (e.g., "北京", "上海")' },
    { name: 'cities', help: 'Cities (e.g., "北京市", "上海市")' },
    { name: 'worktimes', help: 'Work years: 1=1-3y, 2=3-5y, 3=5-10y, 4=10+y' },
    { name: 'degrees', help: 'Education: 1=大专，2=本科，3=硕士，4=博士，5=MBA' },
    { name: 'professions', help: 'Industries: 01=互联网，02=金融，03=电子，04=通信' },
    { name: 'is_211', type: 'int', help: '211 university: 0=any, 1=211' },
    { name: 'is_985', type: 'int', help: '985 university: 0=any, 1=985' },
    { name: 'sortby', type: 'int', default: 0, help: 'Sort: 0=relevance, 1=activity, 2=work_years, 3=education' },
    { name: 'is_direct_chat', type: 'int', default: 0, help: 'Direct chat: 0=any, 1=available' },
  ],
  columns: ['name', 'job_title', 'company', 'historical_companies', 'location', 'work_year', 'school', 'degree', 'active_status', 'age', 'tags', 'mutual_friends'],
  func: async (page, kwargs) => {
    const {
      query,
      page: pageNum = 0,
      size = 20,
      positions = '',
      companies = '',
      schools = '',
      provinces = '',
      cities = '',
      worktimes = '',
      degrees = '',
      professions = '',
      is_211 = 0,
      is_985 = 0,
      sortby = 0,
      is_direct_chat = 0,
    } = kwargs;

    // Navigate to the search page
    await page.goto('https://maimai.cn/ent/talents/discover/search_v2', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    // Generate random session IDs
    const sessionid = 'b92d0fb5-f3fd-1f4b-fcdc-' + Math.random().toString(16).slice(2, 14);
    const deletesessionid = 'ae907d75-315c-8db7-2cc7-' + Math.random().toString(16).slice(2, 14);

    const requestBody = {
      search: {
        page: pageNum,
        size: size,
        sessionid: sessionid,
        deletesessionid: deletesessionid,
        worktimes: worktimes,
        degrees: degrees,
        professions: professions,
        schools: schools,
        positions: positions,
        companyscope: 0,
        sortby: sortby,
        is_direct_chat: is_direct_chat,
        query: query,
        cities: cities,
        provinces: provinces,
        is_211: is_211,
        is_985: is_985,
        allcompanies: companies,
      },
    };

    // Read csrftoken directly from the cookie store via CDP — zero page.evaluate round-trip
    const cookies = await page.getCookies({ url: 'https://maimai.cn' });
    const csrftokenFromCookie = cookies.find((c) => c.name === 'csrftoken')?.value || '';

    // Execute the search API call in browser context
    const data = await page.evaluate(`async () => {
      // Prefer cookie-derived csrftoken (hoisted from CDP); fall back to meta tag
      let csrftoken = ${JSON.stringify(csrftokenFromCookie)};

      if (!csrftoken) {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) csrftoken = meta.getAttribute('content') || '';
      }

      const body = ${JSON.stringify(requestBody)};

      const res = await fetch('https://maimai.cn/api/ent/discover/search?channel=www&data_version=3.0&version=1.0.0', {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'content-type': 'text/plain;charset=UTF-8',
          'origin': 'https://maimai.cn',
          'referer': 'https://maimai.cn/ent/talents/discover/search_v2',
          'x-csrf-token': csrftoken,
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const result = await res.json();

      // Check login status
      if (res.status === 401 || res.status === 403 || result.error_code === 20002) {
        throw new Error('需要登录！请先在浏览器中访问 maimai.cn 并登录');
      }

      if (result.code !== 200 && result.code !== 0) {
        throw new Error(result.message || result.error || 'API 请求失败');
      }

      return result;
    }`);

    // Extract talent list from response
    const talentList = data.data?.list || data.data?.talent_list || data.list || data.talent_list || [];

    if (!talentList || talentList.length === 0) {
      return [{ error: '未找到匹配的候选人', query: query }];
    }

    // Map to output format
    return talentList.map(item => {
      // Extract school info (first one)
      const schoolInfo = item.edu && item.edu.length > 0 ? item.edu[0] : {};

      // Work years: use work_time field directly (e.g., "11 年", "10 年")
      const workYear = item.work_time || item.worktime || '';

      // Extract all companies from work experience (deduplicated, excluding current company)
      const currentCompany = item.company || '';
      const historicalCompanies = (item.exp || [])
        .map(e => e.company)
        .filter(c => c && c.trim() !== '' && c !== currentCompany)
        .filter((c, i, arr) => arr.indexOf(c) === i)
        .join(' / ');

      // Extract tags/skills from tag_list array
      const tags = (item.tag_list || item.tags || [])
        .filter(t => t && t.trim() !== '')
        .join(', ');

      // Extract mutual friends count and list
      const mutualFriendsCount = item.friends_cnt || item.common_friends_count || 0;
      const mutualFriendsList = (item.friends || item.common_friends || [])
        .map(f => f.name || f.user_name || f)
        .slice(0, 3)
        .join(', ');

      return {
        name: item.name || '',
        job_title: item.position || item.job_title || '',
        company: currentCompany,
        historical_companies: historicalCompanies,
        location: (item.province || '') + (item.city ? '·' + item.city : ''),
        work_year: workYear,
        school: schoolInfo.school || schoolInfo.hover?.name || '',
        degree: schoolInfo.sdegree || schoolInfo.hover?.school_level || '',
        active_status: item.active_state_v2 || item.active_state_v1 || item.active_state || '',
        age: item.age || '',
        tags: tags,
        mutual_friends: mutualFriendsCount > 0 ? `${mutualFriendsCount}人${mutualFriendsList ? ' (' + mutualFriendsList + ')' : ''}` : '',
      };
    });
  },
});
