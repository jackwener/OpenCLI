import { cli } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';

function positiveInteger(value, name) {
    const text = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(text)) {
        throw new ArgumentError(`nowcoder salary --${name} must be a positive integer`);
    }
    const number = Number(text);
    if (!Number.isSafeInteger(number)) {
        throw new ArgumentError(`nowcoder salary --${name} is too large`);
    }
    return number;
}

function validateArgs(args) {
    positiveInteger(args.page ?? 1, 'page');
    positiveInteger(args.limit ?? 15, 'limit');
}

cli({
    site: 'nowcoder',
    name: 'salary',
    access: 'read',
    description: 'Salary disclosure posts',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of items' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'school', 'company', 'job', 'salary', 'city', 'education', 'work_type', 'content', 'likes', 'comments', 'views'],
    validateArgs,
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const page = \${{ args.page }};
  const limit = \${{ args.limit }};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/home/tab/content?tabId=858&categoryType=1&pageNo=' + page + '&pageSize=' + limit, {credentials: 'include'});
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  const records = (d.data?.records || []).filter((item) => item && (
    item.momentData || item.longContentData || item.contentData
  ));
  return records.map((item, i) => {
    const moment = item.momentData || {};
    const longContent = item.longContentData || {};
    const content = item.contentData || {};
    const salaryCard = item.salaryCard && typeof item.salaryCard === 'object' ? item.salaryCard : {};
    const contentText = String(
      moment.content || longContent.content || content.content || ''
    ).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
    const salaryTitle = [
      salaryCard.company,
      salaryCard.job,
      salaryCard.salary,
    ].filter(Boolean).join(' / ');
    return {
      rank: i + 1,
      id: String(moment.uuid || longContent.uuid || content.uuid || item.contentId || ''),
      title: moment.title || longContent.title || content.title || salaryTitle || contentText.slice(0, 80) || '',
      content: contentText,
      author: item.userBrief?.nickname || '',
      school: item.userBrief?.educationInfo || '',
      company: salaryCard.company || '',
      job: salaryCard.job || '',
      salary: salaryCard.salary || '',
      city: salaryCard.city || '',
      education: salaryCard.eduLevel || '',
      work_type: salaryCard.workType || '',
      salaryCard,
      likes: item.frequencyData?.likeCnt || 0,
      comments: item.frequencyData?.commentCnt || 0,
      views: item.frequencyData?.viewCnt || 0,
    };
  });
})()
` },
        { limit: '${{ args.limit }}' },
    ],
});
