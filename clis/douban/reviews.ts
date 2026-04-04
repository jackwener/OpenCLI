import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { getSelfUid, DoubanReview } from './utils.js';

cli({
  site: 'douban',
  name: 'reviews',
  description: '导出个人影评',
  domain: 'movie.douban.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '导出数量' },
    { name: 'uid', help: '用户ID，不填则使用当前登录账号' },
    { name: 'full', type: 'bool', default: false, help: '获取完整影评内容' },
  ],
  columns: ['movieTitle', 'title', 'myRating', 'votes', 'content', 'url'],
  func: async (page: IPage, kwargs: { limit?: number; uid?: string; full?: boolean }) => {
    const { limit = 20, uid: providedUid, full = false } = kwargs;
    
    const uid = providedUid || await getSelfUid(page);
    const reviews = await fetchReviews(page, uid, limit, full);
    
    return reviews;
  },
});

async function fetchReviews(
  page: IPage,
  uid: string,
  limit: number,
  full: boolean,
): Promise<DoubanReview[]> {
  const reviews: DoubanReview[] = [];
  let start = 0;
  const pageSize = 20;
  
  while (true) {
    const url = `https://movie.douban.com/people/${uid}/reviews?start=${start}&sort=time`;
    
    await page.goto(url);
    
    await page.wait({ time: 1 });
    
    const data = await page.evaluate(`
      () => {
        const reviews = [];
        
        document.querySelectorAll('.tlst').forEach(el => {
          const movieLinkEl = el.querySelector('.ilst a');
          const reviewTitleEl = el.querySelector('.nlst a[title]');
          const ratingEl = el.querySelector('.clst span[class*="allstar"]');
          const contentEl = el.querySelector('.review-short span');
          const votesEl = el.querySelector('.review-short .pl span');
          
          const movieHref = movieLinkEl?.href || '';
          const movieId = movieHref.match(/subject\\/(\\d+)/)?.[1] || '';
          const movieTitle = movieLinkEl?.getAttribute('title') || movieLinkEl?.textContent?.trim() || '';
          
          const reviewHref = reviewTitleEl?.href || '';
          const reviewId = reviewHref.match(/reviews\\/(\\d+)/)?.[1] || '';
          const title = reviewTitleEl?.textContent?.trim() || '';
          
          let myRating = 0;
          if (ratingEl) {
            const cls = ratingEl.className || '';
            const ratingMatch = cls.match(/allstar(\\d)0/);
            if (ratingMatch) {
              myRating = parseInt(ratingMatch[1], 10) * 2;
            }
          }
          
          const votesText = votesEl?.textContent || '';
          const votesMatch = votesText.match(/(\\d+)/);
          const votes = votesMatch ? parseInt(votesMatch[1], 10) : 0;
          
          reviews.push({
            reviewId,
            movieId,
            movieTitle,
            title,
            content: contentEl?.textContent?.trim() || '',
            myRating,
            createdAt: '',
            votes,
            url: reviewHref,
          });
        });
        
        return reviews;
      }
    `) as DoubanReview[];
    
    reviews.push(...data);
    
    if (data.length < pageSize) break;
    if (limit > 0 && reviews.length >= limit) break;
    
    start += pageSize;
  }
  
  const result = reviews.slice(0, limit > 0 ? limit : undefined);
  
  if (full && result.length > 0) {
    for (const review of result) {
      if (review.url) {
        const fullContent = await fetchFullReview(page, review.url);
        review.content = fullContent;
      }
    }
  }
  
  return result;
}

async function fetchFullReview(page: IPage, reviewUrl: string): Promise<string> {
  await page.goto(reviewUrl);
  await page.wait({ time: 1 });
  
  const content = await page.evaluate(`
    () => {
      const contentEl = document.querySelector('.review-content');
      return contentEl?.textContent?.trim() || '';
    }
  `) as string;
  
  return content;
}
