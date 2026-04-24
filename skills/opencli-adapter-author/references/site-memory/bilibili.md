# bilibili（B 站）

## 域名

| 用途 | 域名 |
|------|------|
| 主 API | `api.bilibili.com` |
| 个人主页 / 空间 | `space.bilibili.com` |
| 登录 / 鉴权 | `passport.bilibili.com` |
| 动态 | `t.bilibili.com` / `api.vc.bilibili.com` |
| 直播 | `api.live.bilibili.com` |

## 默认鉴权

- `Strategy.COOKIE + browser: true`
- 核心 cookie：`SESSDATA`（登录态）、`bili_jct`（CSRF token，部分写接口要带到 header `Referer + csrf`）
- **未登录也能调多数读接口**，但有 wbi 签名要求

## 关键：wbi 签名

- 凡 URL 含 `/wbi/` 的接口都要 `w_rid + wts` 签名
- 签名算法依赖每日轮换的 `img_key / sub_key`，从 `api.bilibili.com/x/web-interface/nav` 的 `wbi_img` 字段拿
- **不要自己重新实现**：`clis/bilibili/utils.js` 里的 `apiGet(page, path, { signed: true, params })` 已经封装好
- 普通 cookie 接口用 `fetchJson(page, url)`（也在 utils.js）

## 已知 endpoint

- `GET api.bilibili.com/x/web-interface/nav` — 登录态 + 拿 wbi key
- `GET api.bilibili.com/x/space/wbi/arc/search?mid=<uid>` — 用户视频（需 wbi 签）
- `GET api.bilibili.com/x/space/acc/info?mid=<uid>` — 用户资料
- `GET api.bilibili.com/x/web-interface/view?bvid=BV...` — 视频详情
- `GET api.bilibili.com/x/web-interface/popular?ps=20&pn=1` — 热门
- `GET api.bilibili.com/x/web-interface/ranking/v2?rid=0` — 排行
- `GET api.bilibili.com/x/v2/reply/wbi/main?type=1&oid=<aid>&mode=3` — 评论（需 wbi）
- `GET api.bilibili.com/x/web-interface/search/all/v2?keyword=<q>` — 综合搜索
- `GET api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=<uid>` — 用户动态（新版走 `api.bilibili.com/x/polymer/web-dynamic/v1/feed/space`）
- `GET api.bilibili.com/x/v2/history/cursor` — 观看历史（需登录）
- `GET api.bilibili.com/x/v3/fav/folder/created/list-all` — 收藏夹列表（需登录）

## 字段

字段基本人类可读，见 `../field-conventions.md` 的 bilibili 节（`mid / aid / bvid / cid / view / danmaku / reply / favorite / coin / share / like / pubdate / ctime`）。

## 坑 / 陷阱

1. **wbi 签名缓存 `img_key / sub_key`**：24 小时内有效，每次请求都重新 fetch `nav` 会被限频。utils.js 内部做了缓存
2. **`mid` 和 `uid` 一回事**：接口不统一，`mid=` 居多，个别接口要 `host_mid=`
3. **视频 ID 两种**：`aid`（老数字）和 `bvid`（BV1xxx），视频详情要用 `bvid`
4. **`ps=` 最大 50**（popular/ranking），超过了多发几页拼
5. **动态接口换版**：老的 `dynamic_svr` 已经废，新的走 `x/polymer/web-dynamic/v1/feed/space`，写新 adapter 直接用新接口
6. **评论分页靠 `next` 游标**，不是页号
7. **B 站限频 `-352 风控`**：短时间高频调会拦截，adapter 层加 500ms 间隔
8. **搜索要先 "cold start"**：空 cookie 的 session 第一次搜会 412，先访问首页拿 `buvid3` cookie
9. **直播接口在 `api.live.bilibili.com`**，不是主域名

## 可参考的 adapter

| 模板类型 | 参考文件 |
|---------|---------|
| 用户资料 / 视频列表 | `clis/bilibili/user-videos.js` / `me.js` |
| 视频详情 / 字幕 | `clis/bilibili/download.js` / `subtitle.js` |
| 评论 | `clis/bilibili/comments.js` |
| 搜索 | `clis/bilibili/search.js` |
| 热门 / 排行 | `clis/bilibili/hot.js` / `ranking.js` |
| 动态 | `clis/bilibili/dynamic.js` |
| 关注 | `clis/bilibili/following.js` |
| 收藏 | `clis/bilibili/favorite.js` |
| 观看历史 | `clis/bilibili/history.js` |

通用工具：`clis/bilibili/utils.js`。新 adapter 先 `import { apiGet, fetchJson } from './utils.js'`，不要重写。
