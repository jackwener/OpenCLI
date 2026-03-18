# Notion 桌面端适配器

通过 Chrome DevTools Protocol (CDP) 在终端中控制 **Notion 桌面应用**。

## 前置条件

通过远程调试端口启动：
```bash
/Applications/Notion.app/Contents/MacOS/Notion --remote-debugging-port=9230
```

## 配置

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9230"
```

## 命令

| 命令 | 说明 |
|------|------|
| `notion status` | 检查 CDP 连接 |
| `notion search "关键词"` | 快速搜索（Cmd+P） |
| `notion read` | 读取当前页面内容 |
| `notion new "标题"` | 新建页面（Cmd+N） |
| `notion write "文本"` | 在当前页面追加文字 |
| `notion sidebar` | 列出侧边栏页面列表 |
| `notion favorites` | 列出收藏夹页面列表 |
| `notion export` | 导出页面为 Markdown |
