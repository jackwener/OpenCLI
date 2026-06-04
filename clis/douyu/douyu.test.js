import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './watch.js';
import './search.js';
import './follow.js';
import './unfollow.js';
import './danmaku.js';
import './daily-task.js';
import './video-task.js';
import { normalizeSearchLimit, normalizeSearchQuery, buildSearchUrl, extractSearchResultsFromHtml } from './search.js';
import { normalizeRoom, requireText, classifyDouyuLiveStatus } from './utils.js';

describe('douyu adapter', () => {
  it('registers search as a read-only public command', () => {
    const search = getRegistry().get('douyu/search');
    expect(search).toBeDefined();
    expect(search?.access).toBe('read');
    expect(search?.browser).toBe(false);
    expect(search?.columns).toContain('room');
    expect(search?.columns).toContain('live_status');
  });

  it('registers daily-task as the only bundled daily workflow', () => {
    const dailyTask = getRegistry().get('douyu/daily-task');
    expect(dailyTask).toBeDefined();
    expect(getRegistry().get('douyu/video-task')).toBeUndefined();
    expect(dailyTask?.args.map((arg) => arg.name)).toContain('video-watch-minutes');
    expect(dailyTask?.columns).toContain('video_watch');
    expect(dailyTask?.columns).toContain('videos');
  });

  it('normalizes room ids from ids and urls', () => {
    expect(normalizeRoom('6979222')).toBe('6979222');
    expect(normalizeRoom('https://www.douyu.com/6979222?dyshid=1')).toBe('6979222');
    expect(normalizeRoom('https://www.douyu.com/room/6979222')).toBe('6979222');
  });

  it('rejects missing rooms and overlong danmaku text', () => {
    expect(() => normalizeRoom('')).toThrow(ArgumentError);
    expect(() => requireText('x'.repeat(51), 'text', 50)).toThrow(ArgumentError);
  });

  it('does not treat offline room chrome as a live stream', () => {
    expect(classifyDouyuLiveStatus({
      hasVideo: true,
      videoPaused: true,
      videoEnded: false,
      videoReadyState: 0,
      videoCurrentTime: 0,
      bodyText: '小众宝藏结晶直播间 6657 上次开播时间 3小时前 发送弹幕 粉丝牌',
    })).toEqual({ live_status: 'offline', live_status_reason: 'offline-text' });

    expect(classifyDouyuLiveStatus({
      hasVideo: true,
      videoPaused: false,
      videoEnded: false,
      videoReadyState: 2,
      videoCurrentTime: 1,
      bodyText: '',
    })).toEqual({ live_status: 'live', live_status_reason: 'video-playing' });
  });

  it('normalizes search query and limit', () => {
    expect(normalizeSearchQuery('  英雄   联盟  ')).toBe('英雄 联盟');
    expect(normalizeSearchLimit('10')).toBe(10);
    expect(buildSearchUrl('英雄联盟')).toContain('kw=%E8%8B%B1%E9%9B%84%E8%81%94%E7%9B%9F');
    expect(() => normalizeSearchQuery('')).toThrow(ArgumentError);
    expect(() => normalizeSearchLimit(0)).toThrow(ArgumentError);
    expect(() => normalizeSearchLimit(51)).toThrow(ArgumentError);
  });

  it('extracts live room search cards from Douyu SSR HTML', () => {
    const html = `
      <div><h3 class="title__N1P57">直播间</h3></div>
      <ul>
        <li>
          <div class="livingName__YV44V">金咕咕金咕咕doinb</div>
          <div class="watching__lpb2k">383.9万</div>
          <a class="cardTitleLink__EhjW-" target="_blank" title="随便播播 希望你们天天开心!!!" href="/252140"><h3>随便播播 希望你们天天开心!!!</h3></a>
          <a href="https://www.douyu.com/g_LOL"><h6 class="cardTagContainer__WAkG6">英雄联盟</h6></a>
        </li>
      </ul>
      <div><h3>动态</h3></div>
    `;
    expect(extractSearchResultsFromHtml(html, 10)).toEqual([{
      rank: 1,
      room: '252140',
      streamer: '金咕咕金咕咕doinb',
      title: '随便播播 希望你们天天开心!!!',
      category: '英雄联盟',
      hot: '383.9万',
      live_status: 'live',
      url: 'https://www.douyu.com/252140',
    }]);
  });
});
