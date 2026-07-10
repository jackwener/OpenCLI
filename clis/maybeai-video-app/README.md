# maybeai-video-app

`opencli` 侧负责：

- 自然语言识别具体 video app
- 从自然语言和 flags 里组合结构化参数
- 直接串联 MaybeAI video workflows：storyboard → clip generation → concat

当前首版已接入仓库内已有的关键 workflow 链路：

- `key-workflow/2-video-prompt-gen.json`
- `key-workflow/4-generate-video-from-image.json`
- `key-workflow/5-concat-video.json`

同时 `video-remake` 使用 CLI-only tool-chain：

- `/v1/tool/video/generate`
- `/api/v1/tool/function_call`

## 常用命令

先只看识别结果，不真正执行：

```bash
opencli maybeai-video-app select "给这个商品生成一条 TikTok 短视频 https://example.com/product.jpg" \
  --platform TikTokShop \
  --market "North America"
```

直接执行：

```bash
opencli maybeai-video-app run "给这个商品生成一条 TikTok 短视频 https://example.com/product.jpg https://example.com/model.jpg" \
  --platform TikTokShop \
  --market "North America" \
  --ratio 9:16 \
  --duration 15 \
  --playground-url https://play-be.omnimcp.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

视频翻拍：

```bash
opencli maybeai-video-app run "翻拍这个参考视频" \
  --app video-remake \
  --product https://example.com/product.jpg \
  --person https://example.com/model.jpg \
  --reference-video https://example.com/reference.mp4 \
  --ratio 9:16 \
  --duration 15 \
  --playground-url https://play-be.omnimcp.ai \
  --fastest-api-url https://api.fastest.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

图生视频：

```bash
opencli maybeai-video-app run "让这张图动起来 https://example.com/cover.jpg" \
  --app image-to-video \
  --prompt "slow push-in, soft studio motion, fabric gently moving" \
  --duration 5 \
  --ratio 9:16 \
  --playground-url https://play-be.omnimcp.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

只看将要执行的选择和输入：

```bash
opencli maybeai-video-app run "生成一条种草视频 https://example.com/product.jpg" --dry-run
```

## 推荐规则

- 自然语言入口优先用 `run`
- 需要调试识别逻辑时用 `select`
- 已知 app 和完整结构化参数时用 `generate`
- `payload` 用来预览多步 workflow 变量
- 当前首版重点覆盖：
  - `product-ad-video`
  - `listing-video`
  - `ugc-ad-video`
  - `image-to-video`
  - `video-remake`
