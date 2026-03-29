import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import {
  browserJsonRequest,
  ensureZsxqAuth,
  ensureZsxqPage,
  fetchFirstJson,
  getCommentsFromResponse,
  getTopicFromResponse,
  getTopicUrl,
  summarizeComments,
  toTopicRow,
} from './utils.js';

cli({
  site: 'zsxq',
  name: 'topic',
  description: '获取单个话题详情和评论',
  domain: 'wx.zsxq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', required: true, positional: true, help: 'Topic ID' },
    { name: 'comment_limit', type: 'int', default: 20, help: 'Number of comments to fetch' },
  ],
  columns: ['topic_id', 'type', 'author', 'title', 'comments', 'likes', 'comment_preview', 'url'],
  func: async (page, kwargs) => {
    await ensureZsxqPage(page);
    await ensureZsxqAuth(page);

    const topicId = String(kwargs.id);
    const commentLimit = Math.max(1, Number(kwargs.comment_limit) || 20);

    const detailUrl = `https://api.zsxq.com/v2/topics/${topicId}`;
    const detailResp = await browserJsonRequest(page, detailUrl);

    if (detailResp.status === 404) {
      throw new CliError('NOT_FOUND', `Topic ${topicId} not found`);
    }
    if (!detailResp.ok) {
      throw new CliError(
        'FETCH_ERROR',
        detailResp.error || `Failed to fetch topic ${topicId}`,
        `Checked endpoint: ${detailUrl}`,
      );
    }

    const commentsResp = await fetchFirstJson(page, [
      `https://api.zsxq.com/v2/topics/${topicId}/comments?sort=asc&count=${commentLimit}`,
    ]);

    const topic = getTopicFromResponse(detailResp.data);
    if (!topic) throw new CliError('NOT_FOUND', `Topic ${topicId} not found`);

    const comments = getCommentsFromResponse(commentsResp.data);
    const row = toTopicRow({
      ...topic,
      comments,
      comments_count: topic.comments_count ?? comments.length,
    });

    return [{
      ...row,
      comment_preview: summarizeComments(comments, 5),
      url: getTopicUrl(topic.topic_id ?? topicId),
    }];
  },
});
