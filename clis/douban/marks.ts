import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { DoubanMark, getSelfUid } from './utils.js';

cli({
  site: 'douban',
  name: 'marks',
  description: '导出个人观影标记',
  domain: 'movie.douban.com',
  strategy: Strategy.COOKIE,
  args: [
    { 
      name: 'status', 
      default: 'collect',
      choices: ['collect', 'wish', 'do', 'all'],
      help: '标记类型: collect(看过), wish(想看), do(在看), all(全部)' 
    },
    { name: 'limit', type: 'int', default: 50, help: '导出数量， 0 表示全部' },
    { name: 'uid', help: '用户ID，不填则使用当前登录账号' },
  ],
  columns: ['title', 'year', 'myRating', 'myStatus', 'myDate', 'myComment', 'url'],
  func: async (page: IPage, kwargs: { status?: string; limit?: number; uid?: string }) => {
    const { status = 'collect', limit = 50, uid: providedUid } = kwargs;
    
    const uid = providedUid || await getSelfUid(page);
    
    const statuses = status === 'all' 
      ? ['collect', 'wish', 'do'] 
      : [status];
    
    const allMarks: DoubanMark[] = [];
    
    for (const s of statuses) {
      const remaining = limit > 0 ? limit - allMarks.length : 0;
      if (limit > 0 && remaining <= 0) break;
      
      const marks = await fetchMarks(page, uid, s, remaining);
      allMarks.push(...marks);
    }
    
    return allMarks.slice(0, limit > 0 ? limit : undefined);
  },
});

async function fetchMarks(
  page: IPage, 
  uid: string, 
  status: string, 
  limit: number
): Promise<DoubanMark[]> {
  const marks: DoubanMark[] = [];
  let offset = 0;
  const pageSize = 15;
  
  while (true) {
    const url = `https://movie.douban.com/people/${uid}/${status}?start=${offset}&sort=time&rating=all&filter=all&mode=grid`;
    
    await page.goto(url);
    
    await page.wait({ time: 2 });
    
    const pageMarks = await page.evaluate(`
      () => {
        const results = [];
        
        const items = document.querySelectorAll('.item');
        
        items.forEach(item => {
          const titleLink = item.querySelector('.info a[href*="/subject/"]');
          if (!titleLink) return;
          
          const titleEl = titleLink.querySelector('em');
          const titleText = titleEl?.textContent?.trim() || titleLink.textContent?.trim() || '';
          const title = titleText.split('/')[0].trim();
          const href = titleLink.href || '';
          
          const idMatch = href.match(/subject\\/(\\d+)/);
          const movieId = idMatch ? idMatch[1] : '';
          
          if (!movieId || !title) return;
          
          const ratingSpan = item.querySelector('span[class*="rating"]');
          let myRating = null;
          if (ratingSpan) {
            const cls = ratingSpan.className || '';
            const ratingMatch = cls.match(/rating(\\d)-t/);
            if (ratingMatch) {
              myRating = parseInt(ratingMatch[1], 10) * 2;
            }
          }
          
          const dateSpan = item.querySelector('.date');
          const myDate = dateSpan?.textContent?.trim() || '';
          
          const commentSpan = item.querySelector('.comment');
          const myComment = commentSpan?.textContent?.trim() || '';
          
          const introSpan = item.querySelector('.intro');
          let year = '';
          if (introSpan) {
            const introText = introSpan.textContent || '';
            const yearMatch = introText.match(/(\\d{4})/);
            year = yearMatch ? yearMatch[1] : '';
          }
          
          results.push({
            movieId,
            title,
            year,
            myRating,
            myStatus: '${status}',
            myComment,
            myDate,
            url: href || 'https://movie.douban.com/subject/' + movieId
          });
        });
        
        return results;
      }
    `) as DoubanMark[];
    
    if (!pageMarks || pageMarks.length === 0) break;
    
    marks.push(...pageMarks);
    
    if (pageMarks.length < pageSize) break;
    if (limit > 0 && marks.length >= limit) break;
    
    offset += pageSize;
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return marks;
}
