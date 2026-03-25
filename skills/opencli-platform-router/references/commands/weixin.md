# weixin

## Commands

### download
- 用途：下载微信公众号文章为 Markdown 格式
- 参数：
  - `url`（必填）：WeChat article URL (mp.weixin.qq.com/s/xxx)
  - `output`（可选）：默认值 './weixin-articles'；Output directory
  - `download-images`（可选）：类型 boolean；默认值 true；Download images locally
- 用法：`opencli weixin download [options] -f json`
