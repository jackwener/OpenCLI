/**
 * 即刻适配器公共定义
 *
 * JikePost 接口和 getPostData 函数在 feed.ts / search.ts 中复用，
 * 统一维护于此文件避免重复。
 */

// 即刻帖子的通用字段
export interface JikePost {
  author: string;
  content: string;
  likes: number;
  comments: number;
  time: string;
  url: string;
}

/**
 * 注入浏览器 evaluate 的 JS 函数字符串。
 * 从 React fiber 树中向上最多走 10 层，找到含 id 字段的 props.data。
 */
export const getPostDataJs = `
function getPostData(element) {
  for (const key of Object.keys(element)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      let fiber = element[key];
      for (let i = 0; i < 10 && fiber; i++) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props && props.data && props.data.id) return props.data;
        fiber = fiber.return;
      }
    }
  }
  return null;
}
`.trim();
