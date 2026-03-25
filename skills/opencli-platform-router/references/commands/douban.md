# douban

## Commands

### book-hot
- 用途：豆瓣图书热门榜单
- 参数：
  - `limit`（可选）：类型 int；默认值 20；返回的图书数量
- 用法：`opencli douban book-hot [options] -f json`

### marks
- 用途：导出个人观影标记
- 参数：
  - `status`（可选）：默认值 'collect'；标记类型: collect(看过), wish(想看), do(在看), all(全部)
  - `limit`（可选）：类型 int；默认值 50；导出数量， 0 表示全部
  - `uid`（可选）：用户ID，不填则使用当前登录账号
- 用法：`opencli douban marks [options] -f json`

### movie-hot
- 用途：豆瓣电影热门榜单
- 参数：
  - `limit`（可选）：类型 int；默认值 20；返回的电影数量
- 用法：`opencli douban movie-hot [options] -f json`

### reviews
- 用途：导出个人影评
- 参数：
  - `limit`（可选）：类型 int；默认值 20；导出数量
  - `uid`（可选）：用户ID，不填则使用当前登录账号
  - `full`（可选）：类型 bool；默认值 false；获取完整影评内容
- 用法：`opencli douban reviews [options] -f json`

### search
- 用途：搜索豆瓣电影、图书或音乐
- 参数：
  - `type`（可选）：默认值 'movie'；搜索类型（movie=电影, book=图书, music=音乐）
  - `keyword`（必填）：搜索关键词
  - `limit`（可选）：类型 int；默认值 20；返回结果数量
- 用法：`opencli douban search [options] -f json`

### subject
- 用途：获取电影详情
- 参数：
  - `id`（必填）：类型 str；电影 ID
- 用法：`opencli douban subject [options] -f json`

### top250
- 用途：豆瓣电影 Top250
- 参数：
  - `limit`（可选）：类型 int；默认值 250；返回结果数量
- 用法：`opencli douban top250 [options] -f json`
