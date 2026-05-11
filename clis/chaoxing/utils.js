/**
 * Chaoxing (学习通) shared helpers.
 *
 * Flow: initSession → getCourses → enterCourse → getTabIframeUrl → navigate → parse DOM
 * Chaoxing has no flat "list all assignments" API; data is behind session-gated
 * course pages loaded as iframes.
 */
// ── Utilities ────────────────────────────────────────────────────────
/** Sleep for given milliseconds (anti-scraping delay). */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/** Execute a credentialed fetch in the browser context, returning JSON or text. */
export async function fetchChaoxing(page, url) {
    const urlJs = JSON.stringify(url);
    return page.evaluate(`
    async () => {
      const res = await fetch(${urlJs}, { credentials: "include" });
      const text = await res.text();
      try { return JSON.parse(text); } catch {}
      return text;
    }
  `);
}
/** Format a timestamp (seconds or milliseconds or date string) to YYYY-MM-DD HH:mm. */
export function formatTimestamp(ts) {
    if (ts == null || ts === '' || ts === 0)
        return '';
    if (typeof ts === 'string' && !/^\d+$/.test(ts.trim()))
        return ts.trim();
    const num = Number(ts);
    if (Number.isNaN(num) || num <= 0)
        return String(ts);
    const millis = num > 1e12 ? num : num * 1000;
    const d = new Date(millis);
    if (Number.isNaN(d.getTime()))
        return String(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
/** Map numeric work status to Chinese label. */
export function workStatusLabel(status) {
    if (status == null || status === '')
        return '未知';
    const s = Number(status);
    if (s === 0)
        return '未交';
    if (s === 1)
        return '已交';
    if (s === 2)
        return '已批阅';
    const str = String(status).trim();
    return str || '未知';
}
/** Fetch enrolled course list via backclazzdata JSON API. */
export async function getCourses(page) {
    const resp = await fetchChaoxing(page, 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1');
    if (!resp || typeof resp !== 'object')
        return [];
    const channelList = resp.channelList ?? [];
    const courses = [];
    for (const channel of channelList) {
        const content = channel?.content;
        if (!content)
            continue;
        const courseData = content.course?.data;
        if (!Array.isArray(courseData))
            continue;
        for (const c of courseData) {
            courses.push({
                courseId: String(c.id ?? ''),
                classId: String(content.id ?? ''),
                cpi: String(channel.cpi ?? ''),
                title: String(c.name ?? ''),
            });
        }
    }
    return courses;
}
// ── Session & course entry ───────────────────────────────────────────
/** Navigate to the interaction page to establish a Chaoxing session. */
export async function initSession(page) {
    await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction');
}
/**
 * Enter a course via stucoursemiddle redirect (establishes course session + enc).
 * After this call the browser is on the course page.
 */
export async function enterCourse(page, course) {
    const url = `https://mooc1.chaoxing.com/visit/stucoursemiddle` +
        `?courseid=${course.courseId}&clazzid=${course.classId}&cpi=${course.cpi}&ismooc2=1&v=2`;
    await page.goto(url);
}
/**
 * On the course page, click a tab (作业 / 考试) and return the iframe src
 * that gets loaded. Returns empty string if the tab is not found.
 */
export async function getTabIframeUrl(page, tabName) {
    const nameJs = JSON.stringify(tabName);
    const result = await page.evaluate(`
    async () => {
      const tabs = document.querySelectorAll('a[data-url]');
      let target = null;
      for (const tab of tabs) {
        if ((tab.innerText || '').trim() === ${nameJs}) { target = tab; break; }
      }
      if (!target) return '';
      target.click();
      await new Promise(r => setTimeout(r, 2000));
      const iframe = document.getElementById('frame_content-hd') || document.querySelector('iframe');
      return iframe?.src || '';
    }
  `);
    return typeof result === 'string' ? result : '';
}
/**
 * Parse assignments from the current page DOM (the 作业列表 page).
 * The page uses `.ulDiv li` items with status/deadline/score info.
 */
export async function parseAssignmentsFromDom(page, courseName) {
    const raw = await page.evaluate(`
    (() => {
      const items = [];
      // Each assignment is a li or div block; try multiple selectors
      const blocks = document.querySelectorAll('.ulDiv li, .work-list-item, .listContent > div, ul > li');
      for (const block of blocks) {
        const text = (block.innerText || '').trim();
        if (!text || text.length < 3) continue;
        // Skip filter buttons and headers
        if (/^(全部|已完成|未完成|筛选)$/.test(text)) continue;
        items.push(text);
      }
      // Fallback: split body text by common patterns
      if (items.length === 0) {
        const body = (document.body?.innerText || '').trim();
        return [body];
      }
      return items;
    })()
  `) ?? [];
    const rows = [];
    for (const text of raw) {
        if (typeof text !== 'string' || text.length < 3)
            continue;
        // Skip noise
        if (/^(全部|已完成|未完成|筛选|暂无|提交的作业将经过)/.test(text))
            continue;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length)
            continue;
        // First meaningful line is the title
        const title = lines[0].replace(/\s+/g, ' ').trim();
        if (!title || /^(全部|已完成|未完成|筛选)$/.test(title))
            continue;
        // Extract status: 未交 / 待批阅 / 已完成 / 已批阅
        const statusMatch = text.match(/(未交|待批阅|已完成|已批阅)/);
        const status = statusMatch?.[1] ?? '';
        // Extract deadline: "剩余XXX" or date pattern
        const remainMatch = text.match(/(剩余[\d天小时分钟秒]+)/);
        const dateMatch = text.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/);
        const deadline = remainMatch?.[1] ?? dateMatch?.[1] ?? '';
        // Extract score (exclude "分钟")
        const scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*分(?!钟)/);
        const score = scoreMatch?.[1] ?? '';
        rows.push({ course: courseName, title, deadline, status, score });
    }
    return rows;
}
/** Parse exams from the current page DOM (the 考试列表 page). */
export async function parseExamsFromDom(page, courseName) {
    const raw = await page.evaluate(`
    (() => {
      const items = [];
      const blocks = document.querySelectorAll('.ulDiv li, .exam-list-item, .listContent > div, ul > li');
      for (const block of blocks) {
        const text = (block.innerText || '').trim();
        if (!text || text.length < 3) continue;
        if (/^(全部|已完成|未完成|筛选|暂无)$/.test(text)) continue;
        items.push(text);
      }
      if (items.length === 0) {
        const body = (document.body?.innerText || '').trim();
        return [body];
      }
      return items;
    })()
  `) ?? [];
    // Check for "暂无考试"
    if (raw.length === 1 && typeof raw[0] === 'string' && raw[0].includes('暂无考试')) {
        return [];
    }
    const rows = [];
    for (const text of raw) {
        if (typeof text !== 'string' || text.length < 3)
            continue;
        if (/^(全部|已完成|未完成|筛选|暂无)/.test(text))
            continue;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length)
            continue;
        const title = lines[0].replace(/\s+/g, ' ').trim();
        if (!title || /^(全部|已完成|未完成|筛选)$/.test(title))
            continue;
        // Extract dates
        const dates = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}/g) ?? [];
        const start = dates[0] ?? '';
        const end = dates[1] ?? '';
        // Status
        const statusMatch = text.match(/(未开始|进行中|已结束|已完成|未交|待批阅)/);
        let status = statusMatch?.[1] ?? '';
        if (!status && text.includes('剩余'))
            status = '进行中';
        // Score (exclude "分钟")
        const scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*分(?!钟)/);
        const score = scoreMatch?.[1] ?? '';
        rows.push({ course: courseName, title, start, end, status, score });
    }
    return rows;
}
