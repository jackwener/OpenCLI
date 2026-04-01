# Public API Commands

Commands that work without browser or authentication.

## Hacker News

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

## V2EX (Public Features)

```bash
opencli v2ex hot --limit 10              # 热门话题
opencli v2ex latest --limit 10           # 最新话题
opencli v2ex topic 1024                  # 主题详情 (id positional)
opencli v2ex node python                 # 节点话题列表 (name positional)
opencli v2ex nodes --limit 30            # 所有节点列表
opencli v2ex member username             # 用户资料 (username positional)
opencli v2ex user username               # 用户发帖列表 (username positional)
opencli v2ex replies 1024                # 主题回复列表 (id positional)
```

## BBC News

```bash
opencli bbc news --limit 10             # BBC News RSS headlines
```

## Sina Finance

```bash
opencli sinafinance news --limit 10 --type 1  # 7x24实时快讯
# Types: 0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它
```

## Lobsters

```bash
opencli lobsters hot --limit 10           # 热门
opencli lobsters newest --limit 10        # 最新
opencli lobsters active --limit 10        # 活跃
opencli lobsters tag rust                 # 按标签筛选 (tag positional)
```

## Google

```bash
opencli google news --limit 10            # 新闻
opencli google search "AI"                # 搜索 (query positional)
opencli google suggest "AI"               # 搜索建议 (query positional)
opencli google trends                     # 趋势
```

## DEV.to

```bash
opencli devto top --limit 10              # 热门文章
opencli devto tag javascript --limit 10   # 按标签 (tag positional)
opencli devto user username               # 用户文章 (username positional)
```

## Steam

```bash
opencli steam top-sellers --limit 10      # 热销游戏
```

## Apple Podcasts

```bash
opencli apple-podcasts top --limit 10     # 热门播客排行榜 (支持 --country us/cn/gb/jp)
opencli apple-podcasts search "科技"       # 搜索播客 (query positional)
opencli apple-podcasts episodes 12345     # 播客剧集列表 (id positional)
```

## arXiv

```bash
opencli arxiv search "attention"          # 搜索论文 (query positional)
opencli arxiv paper 1706.03762            # 论文详情 (id positional)
```

## Bloomberg (RSS)

```bash
opencli bloomberg main --limit 10         # Bloomberg 首页头条
opencli bloomberg markets --limit 10      # 市场新闻
opencli bloomberg tech --limit 10         # 科技新闻
opencli bloomberg politics --limit 10     # 政治新闻
opencli bloomberg economics --limit 10    # 经济新闻
opencli bloomberg opinions --limit 10     # 观点
opencli bloomberg industries --limit 10   # 行业新闻
opencli bloomberg businessweek --limit 10 # Businessweek
opencli bloomberg feeds                   # 列出所有 RSS feed 别名
```

## Dictionary

```bash
opencli dictionary search "serendipity"   # 单词释义 (word positional)
opencli dictionary synonyms "happy"       # 近义词 (word positional)
opencli dictionary examples "ubiquitous"  # 例句 (word positional)
```

## HuggingFace

```bash
opencli hf top --limit 10                # 热门模型
```

## Product Hunt

```bash
opencli producthunt today --limit 10      # 今日产品
opencli producthunt week --limit 10       # 本周产品
opencli producthunt month --limit 10      # 本月产品
opencli producthunt search "AI"           # 搜索产品 (query positional)
```
