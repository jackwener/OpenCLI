# WeChat Channels (视频号)

**Mode**: 🔐 Browser · **Domain**: `channels.weixin.qq.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli wechat-channels publish` | 发布视频到视频号 |

## Usage Examples

```bash
# 立即发布
opencli wechat-channels publish ./video.mp4 \
  --title "今天的vlog" \
  --caption "记录日常 #生活 #vlog"

# 定时发布（ISO8601 或 "YYYY-MM-DD HH:mm"）
opencli wechat-channels publish ./video.mp4 \
  --title "周末出游" \
  --schedule "2026-05-20 10:00"

# 保存为草稿
opencli wechat-channels publish ./video.mp4 --title "草稿测试" --draft

# 手动审核模式：填好所有字段后由你亲自点「发表」
# 注意必须配合 --site-session persistent，否则表单页约 30 秒后会被重置
opencli wechat-channels publish ./video.mp4 \
  --title "重要内容" \
  --caption "发布前我要再看一眼" \
  --manual --site-session persistent

# 调整整体超时（含登录等待 + 上传转码，默认 600 秒）
opencli wechat-channels publish ./big-video.mp4 --title "大文件" --timeout 1200
```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `video` (positional) | ✅ | 视频文件路径 (.mp4/.mov/.avi/.webm) |
| `--title` | | 短标题（建议 6-16 字） |
| `--caption` | | 描述内容，支持直接写 `#话题`（如：`日常生活 #搞笑 #生活`） |
| `--schedule` | | 定时发布时间（ISO8601 或 Unix 秒，如 `"2026-05-20 10:00"`） |
| `--draft` | | 保存为草稿，不直接发布 |
| `--manual` | | 填完所有字段后不自动发布，由用户手动点击「发表」 |
| `--timeout` | | 命令整体超时秒数（含登录等待 + 上传转码，默认 600，最小 30） |

## Prerequisites

- Chrome running and **logged into** `channels.weixin.qq.com`
- [Browser Bridge extension](/guide/browser-bridge) installed (v1.6+ recommended for CDP-based
  file upload; older versions fall back to chunked base64 injection)

## Notes

- 视频号创作者中心运行在 **wujie 微前端的 shadow DOM** 内，所有表单元素都在
  `wujie-app::shadow-root` 中。本 adapter 已透明处理 shadow DOM 穿透，无需额外配置。
- 若启动时未登录，命令会跳转到登录页并**等待最多 2 分钟**供你扫码，登录成功后自动继续发布。
- 视频上传后需等待服务端转码，命令会等待明确的视频预览、文件名或完成提示；只看到普通表单字段不会被当成上传成功。
- 提交后必须看到草稿/发布成功提示，或跳转到发布列表页；否则命令会抛出 typed failure 并保存调试截图，而不是返回成功形结果。
- 封面设置暂未暴露为 CLI 参数，因为当前视频号 DOM 没有稳定、可读回的封面应用状态；宁可不支持，也不返回伪成功。
- `--manual` 必须配合 `--site-session persistent` 使用——默认的 ephemeral 生命周期会在命令返回后
  立即释放标签页并重置为空白页，手动审核所需时间必然超过该窗口。
- 定时发布通过 WeUI 桌面端日期-时间选择器完成；选择器结构变动时，命令会保存调试截图到
  `/tmp/wechat-channels_schedule_debug.png` 并失败，不会降级为非定时发布。
