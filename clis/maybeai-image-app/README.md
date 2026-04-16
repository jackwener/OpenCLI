# maybeai-image-app

`opencli` 侧负责：

- 自然语言识别具体 app
- 从自然语言和 flags 里组合结构化参数
- 调用 `maybe-uni/cli/maybeai-app` 的 `/api/v1/image-app/generate`

`maybeai-app` 后端负责：

- 校验结构化参数
- 应用平台 / 模型默认值
- 串联 prompt workflow + image workflow
- 返回图片结果和 task id

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
