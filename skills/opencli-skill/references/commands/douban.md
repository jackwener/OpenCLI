# douban

## Commands

### book-hot
- Purpose: Douban books hot list
- Args:
  - `limit`(optional; type: int; default: 20); 返回的图书数量
- Usage: `opencli douban book-hot [options] -f json`

### download
- Purpose: 下载电影海报/剧照图片
- Args:
  - `id`(required); 电影 subject ID
  - `type`(optional; default: 'Rb'); 豆瓣 photos 的 type 参数，默认 Rb（海报）
  - `limit`(optional; type: int; default: 120); 最多下载多少张图片
  - `photo-id`(optional); 只下载指定 photo_id 的图片
  - `output`(optional; default: './douban-downloads'); 输出目录
- Usage: `opencli douban download [options] -f json`

### marks
- Purpose: Export personal movie marks
- Args:
  - `status`(optional; default: 'collect'); 标记类型: collect(看过), wish(想看), do(在看), all(全部)
  - `limit`(optional; type: int; default: 50); 导出数量， 0 表示全部
  - `uid`(optional); 用户ID，不填则使用当前登录账号
- Usage: `opencli douban marks [options] -f json`

### movie-hot
- Purpose: Douban movies hot list
- Args:
  - `limit`(optional; type: int; default: 20); 返回的电影数量
- Usage: `opencli douban movie-hot [options] -f json`

### photos
- Purpose: 获取电影海报/剧照图片列表
- Args:
  - `id`(required); 电影 subject ID
  - `type`(optional; default: 'Rb'); 豆瓣 photos 的 type 参数，默认 Rb（海报）
  - `limit`(optional; type: int; default: 120); 最多返回多少张图片
- Usage: `opencli douban photos [options] -f json`

### reviews
- Purpose: Export personal movie reviews
- Args:
  - `limit`(optional; type: int; default: 20); 导出数量
  - `uid`(optional); 用户ID，不填则使用当前登录账号
  - `full`(optional; type: bool; default: false); 获取完整影评内容
- Usage: `opencli douban reviews [options] -f json`

### search
- Purpose: Search Douban movies, books, or music
- Args:
  - `type`(optional; default: 'movie'); 搜索类型（movie=电影, book=图书, music=音乐）
  - `keyword`(required); 搜索关键词
  - `limit`(optional; type: int; default: 20); 返回结果数量
- Usage: `opencli douban search [options] -f json`

### subject
- Purpose: Get movie detail
- Args: None
- Usage: `opencli douban subject [options] -f json`

### top250
- Purpose: Douban Top 250 movies
- Args: None
- Usage: `opencli douban top250 [options] -f json`
