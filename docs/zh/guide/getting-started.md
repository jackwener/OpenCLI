# 快速开始

> **让任何网站成为你的 CLI。**
> 零风险 · 复用 Chrome 登录态 · AI 驱动发现 · 浏览器自动化

OpenCLI 将**任何网站**变成命令行界面 — Bilibili、知乎、小红书、Twitter/X、Reddit、YouTube 等 — 基于浏览器会话复用和 AI 原生发现。

OpenCLI 是 **general-purpose browser automation CLI**，可以作为 agent-browser 的替代工具。操作陌生网站无需 adapter；adapters 用于可复用的站点命令。参见 [迁移指南](./agent-browser-alternative)。

## 安装

```bash
npm install -g @jackwener/opencli
```

## 直接操作网页（无需 adapter）

先完成 [Browser Bridge 设置](./browser-bridge)，然后运行：

```bash
opencli doctor
opencli browser --session work open https://example.com
opencli browser --session work state
opencli browser --session work extract
opencli browser --session work close
```

安装 `opencli-browser` skill，让 AI Agent 使用同一组 browser primitives：

```bash
npx skills add jackwener/opencli --skill opencli-browser
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

## 终端自动补全

OpenCLI 支持智能的 Tab 自动补全，加快命令输入：

```bash
# 把自动补全加入 shell 启动配置
echo 'eval "$(opencli completion zsh)"' >> ~/.zshrc              # Zsh
echo 'eval "$(opencli completion bash)"' >> ~/.bashrc            # Bash
echo 'opencli completion fish | source' >> ~/.config/fish/config.fish  # Fish

# 重启 shell 后，按 Tab 键补全：
opencli [Tab]          # 补全站点名称（bilibili、zhihu、twitter...）
opencli bilibili [Tab] # 补全命令（hot、search、me、download...）
```

补全功能包含：
- 所有可用的站点和适配器
- 内置命令（list、validate、verify、browser、doctor、plugin、adapter...）
- 命令别名
- 新增适配器时的实时更新

## 下一步

- [安装详情](/zh/guide/installation)
- [Browser Bridge 设置](/zh/guide/browser-bridge)
- [扩展 OpenCLI：自定义命令和 plugin](/zh/guide/extending-opencli)
- [所有适配器](/zh/adapters/)
- [开发者指南](/zh/developer/contributing)
