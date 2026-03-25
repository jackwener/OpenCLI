# Recipe: content-post（内容发布）

## 输入

- `platform`: twitter/weibo/xiaohongshu
- `draft`: 文案草稿
- `attachments`: 可选
- `dryRun`: 默认 true
- `confirm`: 必填（写操作前）

## 命令链

```bash
# 1) 取素材参考
opencli zhihu hot --limit 10

# 2) 预演（不发布，仅回显）
# (由 skill 层模拟 dryRun 输出)

# 3) 用户确认后执行写操作
opencli twitter post "<draft>"
```

## 失败处理

- 文案超长：自动给出裁剪建议。
- 平台拒绝：回传错误并建议稍后重试。
- 发送失败：保留草稿并提供重试命令。

## 输出格式

- 发布前：`待确认摘要 + 最终命令`
- 发布后：`执行结果 + 平台回执（如有）`
