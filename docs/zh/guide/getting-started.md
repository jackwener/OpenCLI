# 快速开始

> **让任何网站或 Electron 应用成为你的 CLI。**
> 零风险 · 复用 Chrome 登录态 · AI 驱动发现 · 浏览器 + 桌面自动化

OpenCLI 将**任何网站**或 **Electron 应用**变成命令行界面 — Bilibili、知乎、小红书、Twitter/X、Reddit、YouTube、Antigravity 等 — 基于浏览器会话复用和 AI 原生发现。

## 安装

```bash
npm install -g @jackwener/opencli
```

## 基本使用

```bash
opencli list                              # 查看所有命令
opencli hackernews top --limit 5          # 公开 API，无需浏览器
opencli bilibili hot --limit 5            # 浏览器命令
opencli zhihu hot -f json                 # JSON 输出
```

## 输出格式

所有命令支持 `--format` / `-f`：

```bash
opencli bilibili hot -f table   # 默认：终端表格
opencli bilibili hot -f json    # JSON
opencli bilibili hot -f yaml    # YAML
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
```

## 下一步

- [安装详情](/zh/guide/installation)
- [Browser Bridge 设置](/zh/guide/browser-bridge)
- [所有适配器](/zh/adapters/)
- [开发者指南](/zh/developer/contributing)
