# maybeai-image-app

`opencli` 侧负责：

- 自然语言识别具体 app
- 从自然语言和 flags 里组合结构化参数
- 直接串联 MaybeAI workflow：prompt workflow → image workflow

`maybeai-app` 后端不再是运行依赖；同一套规则已内置在 `opencli/clis/maybeai-image-app`：

- app 字段定义
- 平台 / 国家 / 类目 / 角度规则
- 模型默认值和固定模型策略
- workflow artifact 编排

## 常用命令

先只看识别结果，不真正执行：

```bash
opencli maybeai-image-app select "给这个商品生成淘宝主图 https://example.com/a.jpg" \
  --platform Taobao \
  --market China \
  --category Electronics
```

直接执行：

```bash
opencli maybeai-image-app run "给这个商品生成淘宝主图 https://example.com/a.jpg" \
  --platform Taobao \
  --market China \
  --category Electronics \
  --playground-url https://play-be.omnimcp.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

参考生套图：

```bash
opencli maybeai-image-app run "给这个商品做参考生套图" \
  --app replica-listing-image \
  --product-images "https://example.com/front.jpg,https://example.com/side.jpg" \
  --reference-template "https://example.com/template.jpg" \
  --image-group-type Listing \
  --platform Amazon \
  --market "North America" \
  --playground-url https://play-be.omnimcp.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

参考生单图：

```bash
opencli maybeai-image-app run "按参考图生成一张新图" \
  --app gen-reference \
  --product-images "https://example.com/product-front.jpg,https://example.com/product-back.jpg" \
  --reference-images "https://example.com/ref-color.jpg,https://example.com/ref-model.jpg,https://example.com/ref-scene.jpg" \
  --prompt "保留商品材质与卖点，参考模特和排版生成更高级的展示图" \
  --playground-url https://play-be.omnimcp.ai \
  --auth-token $MAYBEAI_AUTH_TOKEN \
  --user-id $MAYBEAI_USER_ID
```

只看最终将要请求的 body：

```bash
opencli maybeai-image-app run "帮我换模特 https://example.com/product.jpg https://example.com/model.jpg" \
  --dry-run
```

## 推荐规则

- 自然语言入口优先用 `run`
- 需要调试识别逻辑时用 `select`
- 已知 app 和完整结构化参数时用 `generate`
- `run` / `generate` 会直接调用 `/api/v1/workflow/detail/public` 和 `/api/v1/workflow/run`
- `replica-listing-image` 推荐配合 `--product-images`、`--reference-template`、`--image-group-type`
- `gen-reference` 推荐配合 `--product-images`、`--reference-images`
