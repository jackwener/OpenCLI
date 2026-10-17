---
title: OpenCLI vs agent-browser：通用 browser automation 与迁移
description: OpenCLI 可以替代 agent-browser 完成 AI Agent 网页操作，无需预置 adapter。了解 browser workflow、命令对应关系与迁移方法。
---

# OpenCLI vs agent-browser

**OpenCLI 是 general-purpose browser automation CLI，可以作为 agent-browser 的替代工具。** AI Agent 可以通过 `opencli browser` 导航、检查页面、点击、填写表单、提取内容和截图，不需要先为网站编写 adapter。

OpenCLI 同时提供可复用的站点命令。Adapter 列表代表现成命令的覆盖范围，不代表 browser automation 的能力边界。

## 能否替代 agent-browser？

可以。对于 **observe → act → observe** 的 browser workflow，Agent 可以直接探索陌生网站、完成多步导航和表单操作。

迁移时需要调整命令语法、element references、session 管理和输出解析。现有 agent-browser scripts 不能直接原样运行；依赖特定 flags 或 runtime features 的流程，需要逐项验证。

## 选择使用方式

| 需求 | OpenCLI interface | 是否需要 adapter |
|------|-------------------|------------------|
| 探索陌生网站、完成一次性任务 | `opencli browser <session> <command>` | 不需要 |
| 导航、点击、填表、提取、截图 | `opencli browser` primitives | 不需要 |
| 调用带固定输出结构的站点命令 | `opencli <site> <command>` | 需要 |
| 把重复流程封装成可复用命令 | 编写 site adapter | 封装时才需要 |

Browser primitives 和 adapter commands 本身不调用 LLM；如果由 AI Agent 决定操作步骤，Agent 仍会消耗自身的 model tokens。

## 无需 adapter 的快速开始

安装 OpenCLI 和 [Browser Bridge extension](./browser-bridge)，检查连接后安装 Agent skill：

```bash
npm install -g @jackwener/opencli
opencli doctor
npx skills add jackwener/opencli --skill opencli-browser
```

```bash
opencli browser --session work open https://example.com
opencli browser --session work state
opencli browser --session work extract
opencli browser --session work screenshot /tmp/opencli-example.png
opencli browser --session work close
```

多次调用使用相同的 `work` session。`state` 返回 interactive elements 的数字 references；点击或填写表单时使用最新 state 中的 reference 或 CSS selector，页面变化后重新检查 state。`close` 释放 session 的 tab lease。

## 常用命令迁移

| 操作 | agent-browser | OpenCLI |
|------|---------------|---------|
| 打开网页 | `agent-browser open https://example.com` | `opencli browser --session work open https://example.com` |
| 检查页面 | `agent-browser snapshot` | `opencli browser --session work state` |
| 点击元素 | `agent-browser click @e2` | `opencli browser --session work click 2` |
| 填写输入框 | `agent-browser fill "#email" "test@example.com"` | `opencli browser --session work fill "#email" "test@example.com"` |
| 按键 | `agent-browser press Enter` | `opencli browser --session work keys Enter` |
| 读取内容 | `agent-browser get text body` | `opencli browser --session work extract` |
| 截图 | `agent-browser screenshot page.png` | `opencli browser --session work screenshot page.png` |
| 执行 JavaScript | `agent-browser eval "document.title"` | `opencli browser --session work eval "document.title"` |
| 结束 session | `agent-browser close` | `opencli browser --session work close` |

表中的 `@e2` 和 `2` 仅为示例，两个工具的 references 不能互换，也不保证指向同一个元素。使用 `opencli browser --help` 和 subcommand 的 `--help` 检查当前参数。

## Adapter 提供什么额外价值？

例如，反复获取 Bilibili 热门内容时，`opencli bilibili hot -f json` 把重复的 browser workflow 变成一次结构化调用。没有 adapter 时，Agent 仍然可以直接操作网站；需要复用时再封装。

参见 [快速开始](./getting-started)、[扩展 OpenCLI](./extending-opencli) 和 [English comparison](../../guide/agent-browser-alternative)。agent-browser 命令参考其 [upstream README](https://github.com/vercel-labs/agent-browser#quick-start)。
