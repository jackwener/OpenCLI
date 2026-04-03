# Browser-based Commands

Commands that require Chrome browser with login state.

## Bilibili (哔哩哔哩)

```bash
opencli bilibili hot --limit 10          # B站热门视频
opencli bilibili search "rust"            # 搜索视频 (query positional)
opencli bilibili me                       # 我的信息
opencli bilibili favorite                 # 我的收藏
opencli bilibili history --limit 20       # 观看历史
opencli bilibili feed --limit 10          # 动态时间线
opencli bilibili user-videos --uid 12345  # 用户投稿
opencli bilibili subtitle --bvid BV1xxx   # 获取视频字幕 (支持 --lang zh-CN)
opencli bilibili dynamic --limit 10       # 动态
opencli bilibili ranking --limit 10       # 排行榜
opencli bilibili following --limit 20     # 我的关注列表 (支持 --uid 查看他人)
```

## Zhihu (知乎)

```bash
opencli zhihu hot --limit 10             # 知乎热榜
opencli zhihu search "AI"                # 搜索 (query positional)
opencli zhihu question 34816524            # 问题详情和回答 (id positional)
```

## Xiaohongshu (小红书)

```bash
opencli xiaohongshu search "美食"              # 搜索笔记 (query positional)
opencli xiaohongshu note <note-id-or-url>      # 读取笔记正文和互动数据
opencli xiaohongshu comments <note-id>         # 笔记评论
opencli xiaohongshu notifications              # 通知（mentions/likes/connections）
opencli xiaohongshu feed --limit 10            # 推荐 Feed
opencli xiaohongshu user xxx                   # 用户主页 (id positional)
opencli xiaohongshu download <note-id>         # 下载笔记图片/视频
opencli xiaohongshu publish                    # 发布笔记
opencli xiaohongshu creator-notes --limit 10   # 创作者笔记列表
opencli xiaohongshu creator-note-detail --note-id xxx  # 笔记详情
opencli xiaohongshu creator-notes-summary      # 笔记数据概览
opencli xiaohongshu creator-profile            # 创作者资料
opencli xiaohongshu creator-stats              # 创作者数据统计
```

## Xueqiu (雪球)

```bash
opencli xueqiu hot-stock --limit 10      # 雪球热门股票榜
opencli xueqiu stock --symbol SH600519   # 查看股票实时行情
opencli xueqiu watchlist                 # 获取自选股/持仓列表
opencli xueqiu feed                      # 我的关注 timeline
opencli xueqiu hot --limit 10            # 雪球热榜
opencli xueqiu search "特斯拉"            # 搜索 (query positional)
opencli xueqiu earnings-date SH600519    # 股票财报发布日期 (symbol positional)
opencli xueqiu fund-holdings             # 蛋卷基金持仓明细 (支持 --account 过滤)
opencli xueqiu fund-snapshot             # 蛋卷基金快照（总资产、子账户、持仓）
```

## Twitter/X

```bash
opencli twitter trending --limit 10      # 热门话题
opencli twitter bookmarks --limit 20     # 获取收藏的书签推文
opencli twitter search "AI"              # 搜索推文 (query positional)
opencli twitter profile elonmusk         # 用户资料
opencli twitter timeline --limit 20      # 时间线
opencli twitter thread 1234567890        # 推文 thread（原文 + 回复）
opencli twitter article 1891511252174299446 # 推文长文内容
opencli twitter follow elonmusk          # 关注用户
opencli twitter unfollow elonmusk        # 取消关注
opencli twitter bookmark https://x.com/... # 收藏推文
opencli twitter unbookmark https://x.com/... # 取消收藏
opencli twitter post "Hello world"       # 发布推文 (text positional)
opencli twitter like https://x.com/...   # 点赞推文 (url positional)
opencli twitter reply https://x.com/... "Nice!" # 回复推文 (url + text positional)
opencli twitter delete https://x.com/... # 删除推文 (url positional)
opencli twitter block elonmusk           # 屏蔽用户 (username positional)
opencli twitter unblock elonmusk         # 取消屏蔽 (username positional)
opencli twitter followers elonmusk       # 用户的粉丝列表 (user positional)
opencli twitter following elonmusk       # 用户的关注列表 (user positional)
opencli twitter notifications --limit 20 # 通知列表
opencli twitter hide-reply https://x.com/... # 隐藏回复 (url positional)
opencli twitter download elonmusk        # 下载用户媒体 (username positional, 支持 --tweet-url)
opencli twitter accept "群,微信"          # 自动接受含关键词的 DM 请求 (query positional)
opencli twitter reply-dm "消息内容"       # 批量回复 DM (text positional)
```

## Reddit

```bash
opencli reddit hot --limit 10            # 热门帖子
opencli reddit hot --subreddit programming  # 指定子版块
opencli reddit frontpage --limit 10      # 首页 /r/all
opencli reddit popular --limit 10        # /r/popular 热门
opencli reddit search "AI" --sort top --time week  # 搜索（支持排序+时间过滤）
opencli reddit subreddit rust --sort top --time month  # 子版块浏览（支持时间过滤）
opencli reddit read --post-id 1abc123    # 阅读帖子 + 评论
opencli reddit user spez                 # 用户资料（karma、注册时间）
opencli reddit user-posts spez           # 用户发帖历史
opencli reddit user-comments spez        # 用户评论历史
opencli reddit upvote --post-id xxx --direction up  # 投票（up/down/none）
opencli reddit save --post-id xxx        # 收藏帖子
opencli reddit comment --post-id xxx "Great!"  # 发表评论 (text positional)
opencli reddit subscribe --subreddit python  # 订阅子版块
opencli reddit saved --limit 10          # 我的收藏
opencli reddit upvoted --limit 10        # 我的赞
```

## V2EX (Browser Features)

```bash
opencli v2ex daily                       # 每日签到
opencli v2ex me                          # 我的信息
opencli v2ex notifications --limit 10    # 通知
```

## Weibo (微博)

```bash
opencli weibo hot --limit 10            # 微博热搜
opencli weibo search "关键词"            # 搜索微博
opencli weibo feed --limit 20           # 首页时间线
opencli weibo user <uid>                # 用户信息
opencli weibo me                        # 我的信息
opencli weibo post "内容"               # 发微博
opencli weibo comments <mid>            # 微博评论
```

## BOSS直聘

```bash
opencli boss search "AI agent"          # 搜索职位 (query positional)
opencli boss detail --security-id xxx    # 职位详情
opencli boss recommend --limit 10        # 推荐职位
opencli boss joblist --limit 10          # 职位列表
opencli boss greet --security-id xxx     # 打招呼
opencli boss batchgreet --job-id xxx     # 批量打招呼
opencli boss send --uid xxx "消息内容"    # 发消息 (text positional)
opencli boss chatlist --limit 10         # 聊天列表
opencli boss chatmsg --security-id xxx   # 聊天记录
opencli boss invite --security-id xxx    # 邀请沟通
opencli boss mark --security-id xxx      # 标记管理
opencli boss exchange --security-id xxx  # 交换联系方式
opencli boss resume                    # 简历管理
opencli boss stats                     # 数据统计
```

## YouTube

```bash
opencli youtube search "rust"            # 搜索视频 (query positional)
opencli youtube video "https://www.youtube.com/watch?v=xxx"  # 视频元数据
opencli youtube transcript "https://www.youtube.com/watch?v=xxx"  # 获取视频字幕/转录
opencli youtube transcript "xxx" --lang zh-Hans --mode raw  # 指定语言 + 原始时间戳模式
```

## Yahoo Finance

```bash
opencli yahoo-finance quote --symbol AAPL  # 股票行情
```

## Sina Finance

```bash
opencli sinafinance news --limit 10 --type 1  # 7x24实时快讯
# Types: 0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它
```

## Reuters (路透社)

```bash
opencli reuters search "AI"              # 路透社搜索 (query positional)
```

## SMZDM (什么值得买)

```bash
opencli smzdm search "耳机"              # 搜索好价 (query positional)
```

## Ctrip (携程)

```bash
opencli ctrip search "三亚"              # 搜索目的地 (query positional)
```

## Barchart

```bash
opencli barchart quote --symbol AAPL     # 股票行情
opencli barchart options --symbol AAPL   # 期权链
opencli barchart greeks --symbol AAPL    # 期权 Greeks
opencli barchart flow --limit 20         # 异常期权活动
```

## Jike (即刻)

```bash
opencli jike feed --limit 10             # 动态流
opencli jike search "AI"                 # 搜索 (query positional)
opencli jike create "内容"                # 发布动态 (text positional)
opencli jike like xxx                    # 点赞 (id positional)
opencli jike comment xxx "评论"           # 评论 (id + text positional)
opencli jike repost xxx                  # 转发 (id positional)
opencli jike notifications               # 通知
```

## Linux.do (Browser Features)

```bash
opencli linux-do categories --limit 20   # 分类列表
opencli linux-do category dev 7          # 分类内话题 (slug + id positional)
```

## WeRead (微信读书)

```bash
opencli weread shelf --limit 10          # 书架
opencli weread search "AI"               # 搜索图书 (query positional)
opencli weread book xxx                  # 图书详情 (book-id positional)
opencli weread highlights xxx            # 划线笔记 (book-id positional)
opencli weread notes xxx                 # 想法笔记 (book-id positional)
opencli weread ranking --limit 10        # 排行榜
```

## Jimeng (即梦 AI)

```bash
opencli jimeng generate --prompt "描述"  # AI 生图
opencli jimeng history --limit 10        # 生成历史
```

## Chaoxing (超星学习通)

```bash
opencli chaoxing assignments             # 作业列表
opencli chaoxing exams                   # 考试列表
```

## Douban (豆瓣)

```bash
opencli douban search "三体"              # 搜索 (query positional)
opencli douban top250                     # 豆瓣 Top 250
opencli douban subject 1234567            # 条目详情 (id positional)
opencli douban photos 30382501            # 图片列表 / 直链（默认海报）
opencli douban download 30382501          # 下载海报 / 剧照
opencli douban marks --limit 10           # 我的标记
opencli douban reviews --limit 10         # 短评
```

## Facebook

```bash
opencli facebook feed --limit 10          # 动态流
opencli facebook profile username         # 用户资料 (id positional)
opencli facebook search "AI"              # 搜索 (query positional)
opencli facebook friends                  # 好友列表
opencli facebook groups                   # 群组
opencli facebook events                   # 活动
opencli facebook notifications            # 通知
opencli facebook memories                 # 回忆
opencli facebook add-friend username      # 添加好友 (id positional)
opencli facebook join-group groupid       # 加入群组 (id positional)
```

## Instagram

```bash
opencli instagram explore                 # 探索
opencli instagram profile username        # 用户资料 (id positional)
opencli instagram search "AI"             # 搜索 (query positional)
opencli instagram user username           # 用户详情 (id positional)
opencli instagram followers username      # 粉丝 (id positional)
opencli instagram following username      # 关注 (id positional)
opencli instagram follow username         # 关注用户 (id positional)
opencli instagram unfollow username       # 取消关注 (id positional)
opencli instagram like postid             # 点赞 (id positional)
opencli instagram unlike postid           # 取消点赞 (id positional)
opencli instagram comment postid "评论"   # 评论 (id + text positional)
opencli instagram save postid             # 收藏 (id positional)
opencli instagram unsave postid           # 取消收藏 (id positional)
opencli instagram saved                   # 已收藏列表
```

## TikTok

```bash
opencli tiktok explore                    # 探索
opencli tiktok search "AI"                # 搜索 (query positional)
opencli tiktok profile username           # 用户资料 (id positional)
opencli tiktok user username              # 用户详情 (id positional)
opencli tiktok following username         # 关注列表 (id positional)
opencli tiktok follow username            # 关注 (id positional)
opencli tiktok unfollow username          # 取消关注 (id positional)
opencli tiktok like videoid               # 点赞 (id positional)
opencli tiktok unlike videoid             # 取消点赞 (id positional)
opencli tiktok comment videoid "评论"     # 评论 (id + text positional)
opencli tiktok save videoid               # 收藏 (id positional)
opencli tiktok unsave videoid             # 取消收藏 (id positional)
opencli tiktok live                       # 直播
opencli tiktok notifications              # 通知
opencli tiktok friends                    # 朋友
```

## Medium

```bash
opencli medium feed --limit 10            # 动态流
opencli medium search "AI"                # 搜索 (query positional)
opencli medium user username              # 用户主页 (id positional)
```

## Substack

```bash
opencli substack feed --limit 10          # 订阅动态
opencli substack search "AI"              # 搜索 (query positional)
opencli substack publication name         # 出版物详情 (id positional)
```

## Sinablog (新浪博客)

```bash
opencli sinablog hot --limit 10           # 热门
opencli sinablog search "AI"              # 搜索 (query positional)
opencli sinablog article url              # 文章详情
opencli sinablog user username            # 用户主页 (id positional)
```

## Coupang (쿠팡)

```bash
opencli coupang search "耳机"             # 搜索商品 (query positional, 支持 --filter rocket)
opencli coupang add-to-cart 12345         # 加入购物车 (product-id positional, 或 --url)
```

## Yollomi (browser — 需在 Chrome 登录 yollomi.com)

```bash
opencli yollomi models --type image      # 列出图像模型与积分
opencli yollomi generate "提示词" --model z-image-turbo   # 文生图
opencli yollomi video "提示词" --model kling-2-1        # 视频
opencli yollomi upload ./photo.jpg       # 上传得 URL，供 img2img / 工具链使用
opencli yollomi remove-bg <image-url>    # 去背景（免费）
opencli yollomi edit <image-url> "改成油画风格"        # Qwen 图像编辑
opencli yollomi background <image-url>   # AI 背景生成 (5 credits)
opencli yollomi face-swap --source <url> --target <url>  # 换脸 (3 credits)
opencli yollomi object-remover <image-url> <mask-url>    # AI 去除物体 (3 credits)
opencli yollomi restore <image-url>      # AI 修复老照片 (4 credits)
opencli yollomi try-on --person <url> --cloth <url>      # 虚拟试衣 (3 credits)
opencli yollomi upscale <image-url>      # AI 超分辨率 (1 credit, 支持 --scale 2/4)
```

## Doubao Web (豆包)

```bash
opencli doubao status                     # 检查豆包页面状态
opencli doubao new                        # 新建对话
opencli doubao send "你好"                # 发送消息 (text positional)
opencli doubao read                       # 读取对话记录
opencli doubao ask "问题"                 # 一键提问并等回复 (text positional)
opencli doubao detail <id>                # 对话详情
opencli doubao history                    # 历史对话列表
opencli doubao meeting-summary <id>       # 会议总结
opencli doubao meeting-transcript <id>    # 会议记录
```

## Grok

```bash
opencli grok ask --prompt "问题"         # 提问 Grok（兼容默认路径）
opencli grok ask --prompt "问题" --web   # 显式 grok.com consumer web UI 路径
```

## Pixiv

```bash
opencli pixiv ranking --limit 20         # 插画排行榜 (支持 --mode daily/weekly/monthly)
opencli pixiv search "風景"               # 搜索插画 (query positional)
opencli pixiv user 12345                 # 画师资料 (uid positional)
opencli pixiv illusts 12345              # 画师作品列表 (user-id positional)
opencli pixiv detail 12345               # 插画详情 (id positional)
opencli pixiv download 12345             # 下载插画 (illust-id positional)
```

## Web

```bash
opencli web read --url "https://..."     # 抓取任意网页并导出为 Markdown
```

## Weixin (微信公众号)

```bash
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx"  # 下载公众号文章为 Markdown
```

## JD (京东)

```bash
opencli jd item 100291143898             # 商品详情 (sku positional, 含价格/主图/规格)
```

## LinkedIn

```bash
opencli linkedin search "AI engineer"    # 搜索职位 (query positional, 支持 --location/--company/--remote)
opencli linkedin timeline --limit 20     # 首页动态流
```

## Bloomberg (Browser - Full Article)

```bash
opencli bloomberg news "https://..."      # 阅读 Bloomberg 文章全文 (link positional, browser)
```

## Gemini

```bash
opencli gemini ask "问题"                 # 提问 (prompt positional)
opencli gemini new                        # 新建对话
opencli gemini image "描述"               # 生成图片
```

## NotebookLM

```bash
opencli notebooklm status                 # 检查页面状态
opencli notebooklm list                   # 列出所有笔记本
opencli notebooklm open <notebook>        # 打开笔记本
opencli notebooklm current                # 当前笔记本信息
opencli notebooklm get                    # 获取笔记本详情
opencli notebooklm history                # 对话历史
opencli notebooklm summary                # 笔记本摘要
opencli notebooklm source-list            # 列出来源
opencli notebooklm source-get <source>    # 获取来源详情
opencli notebooklm source-fulltext <src>  # 来源全文
opencli notebooklm source-guide <src>     # 来源指南
opencli notebooklm note-list              # 笔记列表
opencli notebooklm notes-get <note>       # 获取笔记内容
```

## Bluesky

```bash
opencli bluesky search "关键词"           # 搜索帖子 (query positional)
opencli bluesky profile <handle>          # 用户资料
opencli bluesky user <handle>             # 用户详情
opencli bluesky feeds <handle>            # 用户 feeds
opencli bluesky followers <handle>        # 粉丝列表
opencli bluesky following <handle>        # 关注列表
opencli bluesky thread <uri>              # 帖子线程
opencli bluesky trending                  # 热门话题
opencli bluesky starter-packs             # Starter packs
```

## Douyin (抖音)

```bash
opencli douyin profile                    # 创作者资料
opencli douyin videos --limit 10          # 浏览视频
opencli douyin user-videos                # 我的作品列表
opencli douyin activities                 # 动态
opencli douyin collections                # 收藏夹
opencli douyin hashtag <tag>              # 话题页
opencli douyin location <poi>             # 地点页
opencli douyin stats                      # 数据统计
opencli douyin publish                    # 发布视频
opencli douyin draft                      # 编辑草稿
opencli douyin drafts                     # 草稿列表
opencli douyin delete <id>                # 删除作品
opencli douyin update <id>                # 更新作品信息
```

## Band

```bash
opencli band bands                        # 列出已加入的 bands
opencli band posts <band-id>              # Band 帖子列表
opencli band post <post-key>              # 帖子详情
opencli band mentions                     # 提到我的消息
```

## ZSXQ (知识星球)

```bash
opencli zsxq groups                       # 我加入的星球
opencli zsxq dynamics <group-id>          # 星球动态
opencli zsxq topics <group-id>            # 主题列表
opencli zsxq topic <topic-id>             # 主题详情
opencli zsxq search "关键词"              # 搜索
```

## Tieba (百度贴吧)

```bash
opencli tieba hot                         # 热门贴吧
opencli tieba search "关键词"             # 搜索
opencli tieba posts <forum>               # 帖子列表
opencli tieba read <thread-id>            # 阅读帖子
```

## 36kr

```bash
opencli 36kr hot                          # 热门文章
opencli 36kr news                         # 最新资讯
opencli 36kr search "关键词"              # 搜索文章
opencli 36kr article <id>                 # 文章全文
```

## ONES

```bash
opencli ones login                        # 登录
opencli ones me                           # 我的信息
opencli ones tasks --team <id>            # 项目任务列表
opencli ones my-tasks                     # 我的任务
opencli ones task <id>                    # 任务详情
opencli ones worklog --task <id>          # 工时日志
opencli ones token-info                   # Token 信息
opencli ones logout                       # 登出
```
