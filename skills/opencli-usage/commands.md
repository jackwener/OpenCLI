# Website Adapter Commands

Detailed usage examples for all website adapters, sorted alphabetically by site.

Type legend: 🌐 = Browser (needs Chrome login) · ✅ = Public API (no browser)

## 1688 🌐

```bash
opencli 1688 search "手机壳"              # 搜索商品 (query positional)
opencli 1688 item <id>                   # 商品详情 (id positional)
opencli 1688 download <id>              # 下载商品图片
opencli 1688 store <id>                 # 店铺详情
```

## 36kr 🌐

```bash
opencli 36kr hot                          # 热门文章
opencli 36kr news                         # 最新资讯
opencli 36kr search "关键词"              # 搜索文章
opencli 36kr article <id>                 # 文章全文
```

## Amazon 🌐

```bash
opencli amazon bestsellers               # 畅销商品
opencli amazon search "耳机"              # 搜索商品 (query positional)
opencli amazon product <asin>            # 商品详情
opencli amazon offer <asin>              # 商品报价
opencli amazon discussion <asin>         # 商品讨论
opencli amazon movers-shakers            # 飙升榜
opencli amazon new-releases              # 新品榜
```

## Apple Podcasts ✅

```bash
opencli apple-podcasts top --limit 10     # 热门播客排行榜 (支持 --country us/cn/gb/jp)
opencli apple-podcasts search "科技"       # 搜索播客 (query positional)
opencli apple-podcasts episodes 12345     # 播客剧集列表 (id positional)
```

## arXiv ✅

```bash
opencli arxiv search "attention"          # 搜索论文 (query positional)
opencli arxiv paper 1706.03762            # 论文详情 (id positional)
```

## Band 🌐

```bash
opencli band bands                        # 列出已加入的 bands
opencli band posts <band-id>              # Band 帖子列表
opencli band post <post-key>              # 帖子详情
opencli band mentions                     # 提到我的消息
```

## Baidu Scholar 🌐

```bash
opencli baidu-scholar search "大语言模型"   # 搜索百度学术论文
```

## Barchart 🌐

```bash
opencli barchart quote --symbol AAPL     # 股票行情
opencli barchart options --symbol AAPL   # 期权链
opencli barchart greeks --symbol AAPL    # 期权 Greeks
opencli barchart flow --limit 20         # 异常期权活动
```

## BBC ✅

```bash
opencli bbc news --limit 10             # BBC News RSS headlines
```

## Bilibili (哔哩哔哩) 🌐

```bash
opencli bilibili hot --limit 10          # B站热门视频
opencli bilibili search "rust"            # 搜索视频 (query positional)
opencli bilibili me                       # 我的信息
opencli bilibili favorite                 # 我的收藏夹（默认第一个收藏夹）
opencli bilibili favorite --fid 123456789 # 指定收藏夹
opencli bilibili history --limit 20       # 观看历史
opencli bilibili feed --limit 10          # 动态时间线
opencli bilibili user-videos --uid 12345  # 用户投稿
opencli bilibili subtitle --bvid BV1xxx   # 获取视频字幕 (支持 --lang zh-CN)
opencli bilibili dynamic --limit 10       # 动态
opencli bilibili ranking --limit 10       # 排行榜
opencli bilibili following --limit 20     # 我的关注列表 (支持 --uid 查看他人)
```

## Bloomberg ✅🌐

```bash
# RSS (Public API)
opencli bloomberg main --limit 10         # Bloomberg 首页头条
opencli bloomberg markets --limit 10      # 市场新闻
opencli bloomberg tech --limit 10         # 科技新闻
opencli bloomberg politics --limit 10     # 政治新闻
opencli bloomberg economics --limit 10    # 经济新闻
opencli bloomberg opinions --limit 10     # 观点
opencli bloomberg industries --limit 10   # 行业新闻
opencli bloomberg businessweek --limit 10 # Businessweek
opencli bloomberg feeds                   # 列出所有 RSS feed 别名

# Browser (login required)
opencli bloomberg news "https://..."      # 阅读 Bloomberg 文章全文 (link positional)
```

## Bluesky 🌐

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

## BOSS直聘 🌐

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

## Chaoxing (超星学习通) 🌐

```bash
opencli chaoxing assignments             # 作业列表
opencli chaoxing exams                   # 考试列表
```

## Coupang (쿠팡) 🌐

```bash
opencli coupang search "耳机"             # 搜索商品 (query positional, 支持 --filter rocket)
opencli coupang add-to-cart 12345         # 加入购物车 (product-id positional, 或 --url)
```

## Ctrip (携程) 🌐

```bash
opencli ctrip search "三亚"              # 搜索目的地 (query positional)
```

## DEV.to ✅

```bash
opencli devto top --limit 10              # 热门文章
opencli devto tag javascript --limit 10   # 按标签 (tag positional)
opencli devto user username               # 用户文章 (username positional)
```

## Dictionary ✅

```bash
opencli dictionary search "serendipity"   # 单词释义 (word positional)
opencli dictionary synonyms "happy"       # 近义词 (word positional)
opencli dictionary examples "ubiquitous"  # 例句 (word positional)
```

## Doubao (豆包) 🌐

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

## Douban (豆瓣) 🌐

```bash
opencli douban search "三体"              # 搜索 (query positional)
opencli douban top250                     # 豆瓣 Top 250
opencli douban subject 1234567            # 条目详情 (id positional)
opencli douban photos 30382501            # 图片列表 / 直链（默认海报）
opencli douban download 30382501          # 下载海报 / 剧照
opencli douban marks --limit 10           # 我的标记
opencli douban reviews --limit 10         # 短评
opencli douban movie-hot                  # 热门电影
opencli douban book-hot                   # 热门图书
```

## Douyin (抖音) 🌐

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

## Facebook 🌐

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

## Gemini 🌐

```bash
opencli gemini ask "问题"                 # 提问 (prompt positional)
opencli gemini new                        # 新建对话
opencli gemini image "描述"               # 生成图片
opencli gemini deep-research "topic"      # 深度研究
opencli gemini deep-research-result       # 深度研究结果
```

## Google ✅

```bash
opencli google news --limit 10            # 新闻
opencli google search "AI"                # 搜索 (query positional)
opencli google suggest "AI"               # 搜索建议 (query positional)
opencli google trends                     # 趋势
```

## Google Scholar 🌐

```bash
opencli google-scholar search "transformer" # 搜索 Google Scholar 论文
```

## Gov Law 🌐

```bash
opencli gov-law search "人工智能"           # 搜索国家法律法规数据库
opencli gov-law recent --limit 10          # 最新法律法规
```

## Gov Policy 🌐

```bash
opencli gov-policy search "科技创新"        # 搜索中国政府网政策文件
opencli gov-policy recent --limit 10       # 国务院最新政策文件
```

## Grok 🌐

```bash
opencli grok ask --prompt "问题"         # 提问 Grok（兼容默认路径）
opencli grok ask --prompt "问题" --web   # 显式 grok.com consumer web UI 路径
opencli grok image "赛博朋克机械猫头鹰"    # 生成图片并返回 URL
opencli grok image "水彩灯塔" --out /tmp/grok-img  # 下载生成结果到本地
```

## Hacker News ✅

```bash
opencli hackernews top --limit 10        # Top stories
opencli hackernews new --limit 10        # Newest stories
opencli hackernews best --limit 10       # Best stories
opencli hackernews ask --limit 10        # Ask HN posts
opencli hackernews show --limit 10       # Show HN posts
opencli hackernews jobs --limit 10       # Job postings
opencli hackernews search "rust"         # 搜索 (query positional)
opencli hackernews user dang             # 用户资料 (username positional)
```

## HuggingFace ✅

```bash
opencli hf top --limit 10                # 热门模型
```

## Hupu (虎扑) 🌐

```bash
opencli hupu hot --limit 10              # 热门帖子
opencli hupu search "NBA"                # 搜索 (query positional)
opencli hupu detail <id>                 # 帖子详情 (id positional)
opencli hupu like <id>                   # 点赞 (id positional)
opencli hupu unlike <id>                 # 取消点赞 (id positional)
opencli hupu reply <id> "评论"            # 回复 (id + text positional)
opencli hupu mentions                    # 提到我的消息
```

## IMDB ✅

```bash
opencli imdb top --limit 10              # Top 250
opencli imdb trending --limit 10         # 热门影视
opencli imdb search "关键词"             # 搜索 (query positional)
opencli imdb title <id>                  # 影视详情
opencli imdb person <id>                 # 演员详情
opencli imdb reviews <id>               # 评论
```

## Instagram 🌐

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

## JD (京东) 🌐

```bash
opencli jd item 100291143898             # 商品详情 (sku positional, 含价格/主图/规格)
```

## Jianyu (剑鱼) 🌐

```bash
opencli jianyu search "关键词"            # 搜索招标信息 (query positional)
```

## Jike (即刻) 🌐

```bash
opencli jike feed --limit 10             # 动态流
opencli jike search "AI"                 # 搜索 (query positional)
opencli jike create "内容"                # 发布动态 (text positional)
opencli jike like xxx                    # 点赞 (id positional)
opencli jike comment xxx "评论"           # 评论 (id + text positional)
opencli jike repost xxx                  # 转发 (id positional)
opencli jike notifications               # 通知
opencli jike post <id>                   # 帖子详情
opencli jike topic <id>                  # 话题详情
opencli jike user <id>                   # 用户主页
```

## Jimeng (即梦 AI) 🌐

```bash
opencli jimeng generate --prompt "描述"  # AI 生图
opencli jimeng history --limit 10        # 生成历史
```

## LessWrong ✅

```bash
opencli lesswrong frontpage --limit 10    # 首页推荐
opencli lesswrong curated --limit 10      # 精选文章
opencli lesswrong new --limit 10          # 最新文章
opencli lesswrong top --limit 10          # 热门文章
opencli lesswrong top-week --limit 10     # 本周热门
opencli lesswrong top-month --limit 10    # 本月热门
opencli lesswrong top-year --limit 10     # 年度热门
opencli lesswrong shortform --limit 10    # 短文
opencli lesswrong read <id>               # 文章正文 (id positional)
opencli lesswrong comments <id>           # 文章评论 (id positional)
opencli lesswrong user <username>         # 用户资料 (username positional)
opencli lesswrong user-posts <username>   # 用户文章
opencli lesswrong sequences               # 序列列表
opencli lesswrong tags                    # 标签列表
opencli lesswrong tag <slug>              # 标签下文章
```

## LinkedIn 🌐

```bash
opencli linkedin search "AI engineer"    # 搜索职位 (query positional, 支持 --location/--company/--remote)
opencli linkedin timeline --limit 20     # 首页动态流
```

## Linux.do 🌐

```bash
opencli linux-do hot --limit 10           # 热门帖子
opencli linux-do latest --limit 10        # 最新帖子
opencli linux-do feed --limit 10          # 个人 Feed
opencli linux-do search "关键词"          # 搜索
opencli linux-do categories --limit 20    # 分类列表
opencli linux-do category dev 7           # 分类内话题 (slug + id positional)
opencli linux-do tags                     # 标签列表
opencli linux-do topic 1234               # 帖子回复列表
opencli linux-do topic-content 1234       # 主贴 Markdown 正文
opencli linux-do user-posts <username>    # 用户帖子
opencli linux-do user-topics <username>   # 用户话题
```

## Lobsters ✅

```bash
opencli lobsters hot --limit 10           # 热门
opencli lobsters newest --limit 10        # 最新
opencli lobsters active --limit 10        # 活跃
opencli lobsters tag rust                 # 按标签筛选 (tag positional)
```

## Medium 🌐

```bash
opencli medium feed --limit 10            # 动态流
opencli medium search "AI"                # 搜索 (query positional)
opencli medium user username              # 用户主页 (id positional)
```

## NotebookLM 🌐

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

## ONES 🌐

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

## Paper Review ✅

```bash
opencli paperreview submit               # 提交论文
opencli paperreview review               # 审阅
opencli paperreview feedback             # 反馈
```

## Pixiv 🌐

```bash
opencli pixiv ranking --limit 20         # 插画排行榜 (支持 --mode daily/weekly/monthly)
opencli pixiv search "風景"               # 搜索插画 (query positional)
opencli pixiv user 12345                 # 画师资料 (uid positional)
opencli pixiv illusts 12345              # 画师作品列表 (user-id positional)
opencli pixiv detail 12345               # 插画详情 (id positional)
opencli pixiv download 12345             # 下载插画 (illust-id positional)
```

## Product Hunt ✅

```bash
opencli producthunt today --limit 10      # 今日产品
opencli producthunt hot --limit 10        # 热门产品
opencli producthunt browse --limit 10     # 浏览产品
opencli producthunt posts --limit 10      # 最新产品
```

## Quark (夸克网盘) 🌐

```bash
opencli quark ls                          # 列出文件
opencli quark mkdir "新文件夹"             # 创建文件夹
opencli quark mv <id> <target>            # 移动文件
opencli quark rename <id> "新名称"         # 重命名
opencli quark rm <id>                     # 删除文件
opencli quark save <share-url>            # 保存分享文件
opencli quark share-tree <share-url>      # 查看分享文件树
```

## Reddit 🌐

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

## Reuters (路透社) 🌐

```bash
opencli reuters search "AI"              # 路透社搜索 (query positional)
```

## Sinablog (新浪博客) 🌐

```bash
opencli sinablog hot --limit 10           # 热门
opencli sinablog search "AI"              # 搜索 (query positional)
opencli sinablog article url              # 文章详情
opencli sinablog user username            # 用户主页 (id positional)
```

## Sina Finance ✅

```bash
opencli sinafinance news --limit 10 --type 1  # 7x24实时快讯
# Types: 0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它
```

## SMZDM (什么值得买) 🌐

```bash
opencli smzdm search "耳机"              # 搜索好价 (query positional)
```

## Spotify ✅

```bash
opencli spotify auth                     # OAuth 授权
opencli spotify status                   # 播放状态
opencli spotify play "歌曲"              # 播放 (query positional)
opencli spotify pause                    # 暂停
opencli spotify next                     # 下一首
opencli spotify prev                     # 上一首
opencli spotify volume 80                # 音量
opencli spotify search "歌曲"            # 搜索
opencli spotify queue                    # 播放队列
opencli spotify shuffle                  # 随机播放
opencli spotify repeat                   # 循环播放
```

## StackOverflow ✅

```bash
opencli stackoverflow hot --limit 10     # 热门问题
opencli stackoverflow search "typescript"  # 搜索 (query positional)
opencli stackoverflow bounties --limit 10  # 悬赏问题
opencli stackoverflow unanswered --limit 10  # 未回答问题
```

## Steam ✅

```bash
opencli steam top-sellers --limit 10      # 热销游戏
```

## Substack 🌐

```bash
opencli substack feed --limit 10          # 订阅动态
opencli substack search "AI"              # 搜索 (query positional)
opencli substack publication name         # 出版物详情 (id positional)
```

## Tieba (百度贴吧) 🌐

```bash
opencli tieba hot                         # 热门贴吧
opencli tieba search "关键词"             # 搜索
opencli tieba posts <forum>               # 帖子列表
opencli tieba read <thread-id>            # 阅读帖子
```

## TikTok 🌐

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

## Twitter/X 🌐

```bash
opencli twitter trending --limit 10      # 热门话题
opencli twitter lists --limit 20         # 我的列表（owned + subscribed）
opencli twitter list-tweets 1234567890 --limit 20   # 列表时间线
opencli twitter list-add 1234567890 elonmusk        # 把用户加入列表
opencli twitter list-remove 1234567890 elonmusk     # 把用户移出列表
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
opencli twitter likes elonmusk           # 用户点赞列表
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

## Uiverse 🌐

```bash
opencli uiverse code "Galahhad/strong-squid-82" --target html -f json      # 导出 HTML
opencli uiverse code "Galahhad/strong-squid-82" --target css -f json       # 导出 CSS
opencli uiverse code "Galahhad/strong-squid-82" --target react -f json     # 导出 React
opencli uiverse code "Galahhad/strong-squid-82" --target vue -f json       # 导出 Vue
opencli uiverse preview "Galahhad/strong-squid-82" --output ./preview.png -f json # 仅截取组件预览区域
```

## V2EX ✅🌐

```bash
# Public API (no browser)
opencli v2ex hot --limit 10              # 热门话题
opencli v2ex latest --limit 10           # 最新话题
opencli v2ex topic 1024                  # 主题详情 (id positional)
opencli v2ex node python                 # 节点话题列表 (name positional)
opencli v2ex nodes --limit 30            # 所有节点列表
opencli v2ex member username             # 用户资料 (username positional)
opencli v2ex user username               # 用户发帖列表 (username positional)
opencli v2ex replies 1024                # 主题回复列表 (id positional)

# Browser (login required)
opencli v2ex daily                       # 每日签到
opencli v2ex me                          # 我的信息
opencli v2ex notifications --limit 10    # 通知
```

## Web 🌐

```bash
opencli web read --url "https://..."     # 抓取任意网页并导出为 Markdown（默认保存到 ./web-articles/，可用 --output 修改）
```

## Wanfang 🌐

```bash
opencli wanfang search "知识图谱"           # 搜索万方论文
```

## Weibo (微博) 🌐

```bash
opencli weibo hot --limit 10            # 微博热搜
opencli weibo search "关键词"            # 搜索微博
opencli weibo feed --limit 20           # 首页时间线
opencli weibo user <uid>                # 用户信息
opencli weibo me                        # 我的信息
opencli weibo post "内容"               # 发微博
opencli weibo comments <mid>            # 微博评论
```

## Weixin (微信公众号) 🌐

```bash
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx"  # 下载公众号文章为 Markdown（默认保存到 ./weixin-articles/，可用 --output 修改）
```

## WeRead (微信读书) 🌐

```bash
opencli weread shelf --limit 10          # 书架
opencli weread search "AI"               # 搜索图书 (query positional)
opencli weread book xxx                  # 图书详情 (book-id positional)
opencli weread highlights xxx            # 划线笔记 (book-id positional)
opencli weread notes xxx                 # 想法笔记 (book-id positional)
opencli weread notebooks                 # 笔记本列表
opencli weread ranking --limit 10        # 排行榜
```

## Wikipedia ✅

```bash
opencli wikipedia search "AI"             # 搜索 (query positional)
opencli wikipedia summary "Python"        # 摘要 (title positional)
opencli wikipedia random                  # 随机条目
opencli wikipedia trending               # 热门条目
```

## Xianyu (闲鱼) 🌐

```bash
opencli xianyu search "关键词"            # 搜索闲置商品 (query positional)
opencli xianyu item <id>                 # 商品详情 (id positional)
opencli xianyu chat <id>                 # 聊天记录
```

## Xiaoe (小鹅通) 🌐

```bash
opencli xiaoe courses                     # 课程列表
opencli xiaoe catalog                     # 目录
opencli xiaoe content                     # 内容
opencli xiaoe detail <id>                 # 详情
opencli xiaoe play-url <id>              # 播放地址
```

## Xiaohongshu (小红书) 🌐

```bash
opencli xiaohongshu search "美食"              # 搜索笔记 (query positional)
opencli xiaohongshu note <signed-note-url>     # 读取笔记正文和互动数据
opencli xiaohongshu comments <signed-note-url> # 笔记评论
opencli xiaohongshu notifications              # 通知（mentions/likes/connections）
opencli xiaohongshu feed --limit 10            # 推荐 Feed
opencli xiaohongshu user xxx                   # 用户主页 (id positional)
opencli xiaohongshu download <signed-url-or-short-link> # 下载笔记图片/视频
opencli xiaohongshu publish                    # 发布笔记
opencli xiaohongshu creator-notes --limit 10   # 创作者笔记列表
opencli xiaohongshu creator-note-detail --note-id xxx  # 笔记详情
opencli xiaohongshu creator-notes-summary      # 笔记数据概览
opencli xiaohongshu creator-profile            # 创作者资料
opencli xiaohongshu creator-stats              # 创作者数据统计
```

## Xiaoyuzhou (小宇宙) 🔑

以下小宇宙命令都需要本地凭证：`~/.opencli/xiaoyuzhou.json`。

```bash
opencli xiaoyuzhou podcast 12345          # 播客资料 (id positional，需要本地凭证)
opencli xiaoyuzhou podcast-episodes 12345 # 播客剧集列表 (id positional，需要本地凭证)
opencli xiaoyuzhou episode 12345          # 单集详情 (id positional，需要本地凭证)
opencli xiaoyuzhou download 12345         # 下载单集音频 (id positional，需要本地凭证)
opencli xiaoyuzhou transcript 12345       # 下载单集转录 JSON / 文本（需要本地凭证）
```

## Nowcoder (牛客网) ✅🌐

```bash
opencli nowcoder hot --limit 10                # 热搜榜（公开）
opencli nowcoder trending --limit 10           # 热门帖子（公开）
opencli nowcoder topics --limit 10             # 热门话题（公开）
opencli nowcoder recommend --limit 15          # 推荐内容流（公开）
opencli nowcoder creators --limit 10           # 创作者榜单（公开）
opencli nowcoder companies --job 11002         # 热门面经公司（公开）
opencli nowcoder jobs                          # 岗位分类（公开）
opencli nowcoder search "java" --type post     # 全文搜索（需登录）
opencli nowcoder suggest "java"                # 搜索联想（需登录）
opencli nowcoder experience --limit 10         # 面经帖子（需登录）
opencli nowcoder referral --limit 10           # 内推帖子（需登录）
opencli nowcoder salary --limit 10             # 薪资爆料（需登录）
opencli nowcoder papers --job 11002 --company 239  # 题库（需登录）
opencli nowcoder practice --job 11226 --limit 10   # 练习题（需登录）
opencli nowcoder notifications                 # 未读消息摘要（需登录）
opencli nowcoder detail 2b6b64d4adb34ea3838e832ae4447ab1  # 帖子详情（需登录）
```

## Xueqiu (雪球) 🌐

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

## Yahoo Finance 🌐

```bash
opencli yahoo-finance quote --symbol AAPL  # 股票行情
```

## Yollomi 🌐

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

## YouTube 🌐

```bash
opencli youtube feed --limit 10          # 首页推荐
opencli youtube history --limit 20       # 观看历史
opencli youtube watch-later --limit 50   # 稍后再看
opencli youtube subscriptions --limit 30 # 订阅频道列表
opencli youtube search "rust"            # 搜索视频 (query positional)
opencli youtube video "https://www.youtube.com/watch?v=xxx"  # 视频元数据
opencli youtube transcript "https://www.youtube.com/watch?v=xxx"  # 获取视频字幕/转录
opencli youtube transcript "xxx" --lang zh-Hans --mode raw  # 指定语言 + 原始时间戳模式
opencli youtube like "https://www.youtube.com/watch?v=xxx"  # 点赞视频
opencli youtube unlike "xxx"             # 取消点赞
opencli youtube subscribe "@OpenAI"      # 订阅频道
opencli youtube unsubscribe "UCxxxxxxxxxxxxxx"  # 取消订阅
```

## Yuanbao (腾讯元宝) 🌐

```bash
opencli yuanbao new                       # 新建对话
opencli yuanbao ask "问题"                # 提问 (text positional)
```

## Zhihu (知乎) 🌐

```bash
opencli zhihu hot --limit 10             # 知乎热榜
opencli zhihu search "AI"                # 搜索 (query positional)
opencli zhihu question 34816524            # 问题详情和回答 (id positional)
```

## ZSXQ (知识星球) 🌐

```bash
opencli zsxq groups                       # 我加入的星球
opencli zsxq dynamics <group-id>          # 星球动态
opencli zsxq topics <group-id>            # 主题列表
opencli zsxq topic <topic-id>             # 主题详情
opencli zsxq search "关键词"              # 搜索
```
