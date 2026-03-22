/**
 * Douban movie adapter utilities.
 */

import type { IPage } from '../../types.js';

/**
 * Get current user's Douban ID from movie.douban.com/mine page
 */
export async function getSelfUid(page: IPage): Promise<string> {
  await page.goto('https://movie.douban.com/mine');
  await page.wait({ time: 2 });
  
  const uid = await page.evaluate(`
    (() => {
      // 方案1: 尝试从全局变量获取
      if (window.__DATA__ && window.__DATA__.uid) {
        return window.__DATA__.uid;
      }
      
      // 方案2: 从导航栏用户链接获取
      const navUserLink = document.querySelector('.nav-user-account a');
      if (navUserLink) {
        const href = navUserLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      // 方案3: 从页面中的个人主页链接获取
      const profileLink = document.querySelector('a[href*="/people/"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || profileLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      // 方案4: 从头部用户名区域获取
      const userLink = document.querySelector('.global-nav-items a[href*="/people/"]');
      if (userLink) {
        const href = userLink.getAttribute('href') || userLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      return '';
    })()
  `);
  if (!uid) {
    throw new Error('Not logged in to Douban. Please login in Chrome first.');
  }
  return uid;
}

/**
 * Douban mark (viewing record) interface
 */
export interface DoubanMark {
  movieId: string;
  title: string;
  year: string;
  myRating: number | null;
  myStatus: 'collect' | 'wish' | 'do';
  myComment: string;
  myDate: string;
  url: string;
}

/**
 * Douban review interface
 */
export interface DoubanReview {
  reviewId: string;
  movieId: string;
  movieTitle: string;
  title: string;
  content: string;
  myRating: number;
  createdAt: string;
  votes: number;
  url: string;
}
