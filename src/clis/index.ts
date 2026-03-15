/**
 * Import all TypeScript CLI adapters so they self-register.
 *
 * Each TS adapter calls cli() on import, which adds itself to the global registry.
 */

// bilibili
import './bilibili/search.js';
import './bilibili/me.js';
import './bilibili/favorite.js';
import './bilibili/history.js';
import './bilibili/feed.js';
import './bilibili/user-videos.js';

// github
import './github/search.js';

// zhihu
import './zhihu/question.js';

// xiaohongshu
import './xiaohongshu/search.js';

// bbc
import './bbc/news.js';

// weibo
import './weibo/hot.js';

// boss
import './boss/search.js';

// yahoo-finance
import './yahoo-finance/quote.js';

// reuters
import './reuters/search.js';

// smzdm
import './smzdm/search.js';

// ctrip
import './ctrip/search.js';

// youtube
import './youtube/search.js';
