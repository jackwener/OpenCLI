# AI 默认源

当用户没有明确指定网站时，先在 `grok`、`doubao`、`gemini` 中选择一个，不要一开始并行跑多个 AI 源。

## 使用规则

1. 先运行 `opencli list -f yaml`
2. 确认 `grok`、`doubao`、`gemini` 哪些在当前 registry 中可用
3. 运行 `opencli <site> -h`
4. 锁定具体子命令后，再运行 `opencli <site> <command> -h`

## 路由建议

### grok

- 适用：实时热点、Twitter/X 语境、英文互联网讨论、舆论与趋势
- 补充源常见去向：`twitter`、`reddit`、`reuters`、`google`
- 搜索词建议：
  - 加上时间范围，例如“today / this week”
  - 加上平台范围，例如“on X”, “from social posts”
  - 加上目标，例如“latest reactions”, “main viewpoints”, “key claims”
  - 示例：
    - `OpenAI latest reactions on X this week`
    - `TSLA earnings main viewpoints on social media April 2026`
    - `Nintendo Switch 2 rumors latest discussion on X`

### doubao

- 适用：中文语境、国内热点、生活方式、字节生态、中文泛问答
- 补充源常见去向：`xiaohongshu`、`weibo`、`zhihu`、`bilibili`、`36kr`
- 搜索词建议：
  - 加上中文场景限定，例如“中文讨论”“国内用户”“小红书/微博语境”
  - 加上需求目标，例如“帮我总结”“给我对比”“提取推荐理由”
  - 加上人群或用途，例如“适合新手”“预算 500 元内”“上海求职”
  - 示例：
    - `2026年MacBook Air值得买吗 中文讨论里主要观点是什么`
    - `上海 AI 产品经理招聘趋势 近一个月中文信息总结`
    - `敏感肌防晒推荐 中文用户常提到的优缺点`

### gemini

- 适用：全球网页、英文资料、背景综述、通用检索
- 补充源常见去向：`google`、`wikipedia`、`arxiv`、`stackoverflow`
- 搜索词建议：
  - 加上主题类型，例如“overview”, “comparison”, “background”, “best sources”
  - 加上范围限定，例如地区、时间、语言、行业
  - 加上结果形式，例如“with sources”, “compare pros and cons”, “official guidance”
  - 示例：
    - `MCP overview and official guidance with sources`
    - `best budget travel destinations in Japan April 2026 compare pros and cons`
    - `TypeScript decorators current status official sources`

## 补充原则

- 先用一个 AI 源拿到初步答案
- 若答案缺少原始数据、垂直结果或权威来源，再补 1-2 个专用源
- 不要把 AI 默认源当成命令签名的事实来源；命令细节始终以 `opencli ... -h` 为准

## 通用写法模板

可直接按下面模板构造 AI 查询：

- 热点/新闻：
  `<事件> + 最新进展 + <时间范围> + <地区/平台>`
- 对比/推荐：
  `<对象A> vs <对象B> + <关注维度> + <人群/预算/用途>`
- 中文社区：
  `<主题> + 中文讨论里主要观点 + <时间范围>`
- 全球资料：
  `<主题> + overview/background + with sources`
- 求职：
  `<岗位> + <城市/国家> + market trends/hiring + <时间范围>`
- 购物：
  `<商品> + reviews/price/value + <地区/预算>`
