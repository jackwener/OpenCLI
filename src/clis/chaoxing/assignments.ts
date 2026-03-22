import { cli, Strategy } from '../../registry.js';
import {
  getCourses, initSession, enterCourse, getTabIframeUrl,
  parseAssignmentsFromDom, sleep,
  type AssignmentRow,
} from './utils.js';

cli({
  site: 'chaoxing',
  name: 'assignments',
  description: '学习通作业列表',
  domain: 'mooc2-ans.chaoxing.com',
  strategy: Strategy.COOKIE,
  timeoutSeconds: 90,
  args: [
    { name: 'course', type: 'string', help: '按课程名过滤（模糊匹配）' },
    {
      name: 'status',
      type: 'string',
      default: 'all',
      choices: ['all', 'pending', 'submitted', 'graded'],
      help: '按状态过滤',
    },
    { name: 'limit', type: 'int', default: 20, help: '最大返回数量' },
  ],
  columns: ['rank', 'course', 'title', 'deadline', 'status', 'score'],

  func: async (page, kwargs) => {
    const { course: courseFilter, status: statusFilter = 'all', limit = 20 } = kwargs;

    // 1. Establish session
    await initSession(page);

    // 2. Get courses
    const courses = await getCourses(page);
    if (!courses.length) throw new Error('未获取到课程列表，请确认已登录学习通');

    const filtered = courseFilter
      ? courses.filter(c => c.title.includes(courseFilter))
      : courses;
    if (courseFilter && !filtered.length) {
      throw new Error(`未找到匹配「${courseFilter}」的课程`);
    }

    // 3. Per-course: enter → click 作业 tab → navigate to iframe → parse
    const allRows: AssignmentRow[] = [];

    for (const c of filtered) {
      try {
        await enterCourse(page, c);
        const iframeUrl = await getTabIframeUrl(page, '作业');
        if (!iframeUrl) continue;

        await page.goto(iframeUrl);
        await page.wait(2);

        const rows = await parseAssignmentsFromDom(page, c.title);
        allRows.push(...rows);
      } catch {
        // Single course failure: skip, continue
      }
      if (filtered.length > 1) await sleep(600);
    }

    // 4. Sort: pending first, then by deadline
    allRows.sort((a, b) => {
      const order = (s: string) =>
        s === '未交' ? 0 : s === '待批阅' ? 1 : s === '已完成' ? 2 : s === '已批阅' ? 3 : 4;
      return order(a.status) - order(b.status);
    });

    // 5. Filter by status
    const statusMap: Record<string, string[]> = {
      pending: ['未交'],
      submitted: ['待批阅', '已完成'],
      graded: ['已批阅'],
    };
    const finalRows =
      statusFilter === 'all'
        ? allRows
        : allRows.filter(r => statusMap[statusFilter]?.includes(r.status));

    return finalRows.slice(0, Number(limit)).map((item, i) => ({
      rank: i + 1,
      ...item,
    }));
  },
});
