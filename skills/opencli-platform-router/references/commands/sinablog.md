# sinablog

## Commands

### article
- 用途：获取新浪博客单篇文章详情
- 参数：
  - `url`（必填）：文章URL（如 https://blog.sina.com.cn/s/blog_xxx.html）
- 用法：`opencli sinablog article [options] -f json`

### hot
- 用途：获取新浪博客热门文章/推荐
- 参数：
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli sinablog hot [options] -f json`

### search
- 用途：搜索新浪博客文章（通过新浪搜索）
- 参数：
  - `keyword`（必填）：搜索关键词
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli sinablog search [options] -f json`

### user
- 用途：获取新浪博客用户的文章列表
- 参数：
  - `uid`（必填）：新浪博客用户ID（如 1234567890）
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli sinablog user [options] -f json`
