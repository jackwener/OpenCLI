import { cli, Strategy } from '../../src/registry.js';
import { ArgumentError } from '../../src/errors.js';
import { browserFetch } from './_shared/browser-fetch.js';
import { toUnixSeconds, validateTiming } from './_shared/timing.js';
import type { IPage } from '../../src/types.js';

cli({
  site: 'douyin',
  name: 'update',
  description: '更新视频信息',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'aweme_id', required: true, positional: true },
    { name: 'reschedule', default: '', help: '新的发布时间（ISO8601 或 Unix 秒）' },
    { name: 'caption', default: '', help: '新的正文内容' },
  ],
  columns: ['status'],
  func: async (page: IPage, kwargs) => {
    if (!kwargs.reschedule && !kwargs.caption) {
      throw new ArgumentError('必须提供 --reschedule 或 --caption');
    }
    if (kwargs.reschedule) {
      const newTime = toUnixSeconds(kwargs.reschedule as string | number);
      validateTiming(newTime);
      await browserFetch(
        page,
        'POST',
        'https://creator.douyin.com/web/api/media/update/timer/?aid=1128',
        { body: { aweme_id: kwargs.aweme_id, publish_time: newTime } },
      );
    }
    if (kwargs.caption) {
      await browserFetch(
        page,
        'POST',
        'https://creator.douyin.com/web/api/media/update/desc/?aid=1128',
        { body: { aweme_id: kwargs.aweme_id, desc: kwargs.caption } },
      );
    }
    return [{ status: '✅ 更新成功' }];
  },
});
