import { cli, Strategy } from '@jackwener/opencli/registry';
import { getHupuThreadUrl, readHupuNextData, stripHtml } from './utils.js';

// JSON数据结构（对应Next.js的__NEXT_DATA__）
interface NextData {
  props: Props;
}

interface Props {
  pageProps: PageProps;
}

interface PageProps {
  detail?: Detail;
  detail_error_info?: DetailError;
}

interface DetailError {
  code: number;
  message: string;
}

interface Detail {
  thread?: Thread;
  lights?: ReplyData[];
}

interface Thread {
  tid: string;
  title: string;
  content: string;
  lights?: number;
  replies?: number;
  author?: Author;
}

interface Author {
  puname?: string;
}

interface ReplyData {
  pid: string;
  author?: Author;
  content: string;
  allLightCount?: number;  // 修复：正确的字段名
  created_at_format?: string;
}

cli({
  site: 'hupu',
  name: 'detail',
  description: '获取虎扑帖子详情 (使用Next.js JSON数据)',
  domain: 'bbs.hupu.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'tid',
      required: true,
      positional: true,
      help: '帖子ID（9位数字）'
    },
    {
      name: 'replies',
      type: 'boolean',
      default: false,
      help: '是否包含热门回复'
    }
  ],
  columns: ['title', 'author', 'content', 'replies', 'lights', 'url'],
  func: async (page, kwargs) => {
    const { tid, replies: includeReplies = false } = kwargs;

    const url = getHupuThreadUrl(tid).replace(/-1\.html$/, '.html');
    const data = await readHupuNextData<NextData>(page, url, 'Read Hupu thread detail', {
      expectedTid: String(tid),
    });

    // 检查错误信息（只有当code不是200时才报错）
    const errorInfo = data.props.pageProps.detail_error_info;
    if (errorInfo && errorInfo.code !== 200) {
      throw new Error(`帖子访问失败: ${errorInfo.message} (code: ${errorInfo.code})`);
    }

    // 获取帖子信息
    const thread = data.props.pageProps.detail?.thread;
    if (!thread) {
      throw new Error('帖子不存在或已被删除');
    }

    const authorName = thread.author?.puname || '未知作者';
    const content = stripHtml(thread.content);
    const contentPreview = content.length > 300 ? content.substring(0, 300) + '...' : content;

    // 构建结果
    const result: any = {
      title: thread.title,
      author: authorName,
      content: contentPreview,
      replies: thread.replies || 0,
      lights: thread.lights || 0,
      url: `https://bbs.hupu.com/${tid}.html`
    };

    // 如果需要包含回复，添加回复信息到内容中
    if (includeReplies) {
      const replyList = data.props.pageProps.detail?.lights || [];
      const topReplies = replyList.slice(0, 3);

      if (topReplies.length > 0) {
        let replyText = '\n\n【热门回复】\n';
        topReplies.forEach((reply, index) => {
          const userName = reply.author?.puname || '未知用户';
          const replyContent = stripHtml(reply.content).substring(0, 100);
          const replyLights = reply.allLightCount || 0;  // 修复：使用正确的字段名
          const replyTime = reply.created_at_format || '未知时间';
          replyText += `${index + 1}. ${userName} (亮${replyLights} ${replyTime}):\n   ${replyContent}\n\n`;
        });
        result.content = contentPreview + replyText;
      }
    }

    return [result];
  },
});
