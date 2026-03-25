# 给新 Electron 应用生成 CLI

这篇文档是把一个新的 Electron 桌面应用接入 OpenCLI 的**中文入口指南**。

如果你需要更完整的背景和标准流程，继续看：
- [Chrome DevTools Protocol（中文）](/zh/advanced/cdp)
- [CLI-ifying Electron Applications（英文深度版）](/advanced/electron)
- [TypeScript 适配器开发指南（英文）](/developer/ts-adapter)

## 这篇文档适合什么场景

当目标应用满足下面条件时，用这套流程：
- 应用是 **Electron**，或者至少能暴露可用的 **CDP（Chrome DevTools Protocol）** 端口
- 可以通过 `--remote-debugging-port=<port>` 启动
- 你希望控制的是桌面应用本身，而不是它背后的公开 HTTP API

如果应用**不是** Electron，或者不暴露 CDP，就不要硬套这套方案。那种情况应改用原生桌面自动化方案。可参考 [英文版说明](/advanced/electron#non-electron-pattern-applescript)。

## 最短落地路径

### 1. 先确认它是不是 Electron

macOS 下常见检查方式：

```bash
ls /Applications/AppName.app/Contents/Frameworks/Electron\ Framework.framework
```

如果存在，通常就可以继续尝试 CDP。

### 2. 带 CDP 端口启动应用

```bash
/Applications/AppName.app/Contents/MacOS/AppName --remote-debugging-port=9222
```

然后把 OpenCLI 指到这个端口：

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9222"
```

### 3. 先做 5 个基础命令

建议一个新 Electron 适配器先实现这 5 个命令：

- `status.ts` —— 确认 CDP 连通
- `dump.ts` —— 导出 DOM / snapshot，先做逆向再写逻辑
- `read.ts` —— 读取当前上下文
- `send.ts` —— 往真实编辑器里输入并发送
- `new.ts` —— 新建会话 / 标签页 / 文档

这是最稳妥的基线，因为它先把“能连上、能看见、能读、能写、能重置状态”这 5 件核心事情打通了。

## 推荐开发顺序

### 第一步：先做 `status`

目标不是功能，而是先证明：
- CDP 真的连上了
- 你连到的是对的窗口/标签页
- 应用当前页面确实可读

如果 `status` 都不稳定，先不要继续往下做。

### 第二步：做 `dump`

**不要猜 selector。**

先把这些导出来：
- `document.body.innerHTML`
- accessibility snapshot
- 稳定属性：`data-testid`、`role`、`aria-*` 等

然后再决定：
- 消息列表在哪
- 输入框在哪
- 按钮在哪
- 当前会话容器在哪

### 第三步：做 `read`

只读真正需要的区域，不要把整个页面文本都塞出来。

常见目标：
- 对话消息区
- 当前线程内容
- 当前编辑器历史
- 当前文档主区域

### 第四步：做 `send`

很多 Electron 应用的输入框是 React 控制组件，直接改 `.value` 往往没用。

更稳妥的方式通常是：
- 先 focus 到可编辑区域
- 能用时优先 `document.execCommand('insertText', false, text)`
- 最后用真实按键提交，比如 `Enter`、`Meta+Enter`

### 第五步：做 `new`

很多桌面应用的新建动作其实更适合走快捷键，而不是点按钮。

典型模式：

```ts
const isMac = process.platform === 'darwin';
await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
await page.wait(1);
```

## 文件一般怎么放

一个 TypeScript 桌面适配器，通常结构是：

```text
src/clis/<app>/status.ts
src/clis/<app>/dump.ts
src/clis/<app>/read.ts
src/clis/<app>/send.ts
src/clis/<app>/new.ts
src/clis/<app>/utils.ts
```

当基础能力稳定后，再继续加：
- `ask`
- `history`
- `model`
- `screenshot`
- `export`

## 加完适配器后，还应该补什么文档

至少补这几项：
- `docs/adapters/desktop/` 下的适配器说明页
- 命令列表和示例
- 如何带 `--remote-debugging-port` 启动
- 需要哪些环境变量
- 平台限制和注意事项

可以参考这些现成文档：
- `docs/adapters/desktop/codex.md`
- `docs/adapters/desktop/chatwise.md`
- `docs/adapters/desktop/notion.md`
- `docs/adapters/desktop/discord.md`

## 常见问题

### CDP 能连，但命令不稳定

常见原因：
- 连错窗口或标签页
- 页面还没渲染完
- selector 是猜的，不是从 `dump` 里找出来的
- 输入框是受控组件，直接赋值不生效

### 应用看起来像 Chromium，但就是不好控

有些桌面应用虽然嵌了 Chromium，但并不真正暴露可用的 CDP 接口。
这种情况不要强行走 Electron 方案，应该换到非 Electron 的桌面自动化方案。

### 这个应用其实也有网页版本，还要不要做 Electron 适配器

如果网页版本已经足够稳定，浏览器适配器通常更简单。
只有当**桌面应用才是真正的集成面**时，再优先做 Electron 适配器。

## 推荐阅读顺序

如果你从零开始：

1. 先看这篇
2. 再看 [CLI-ifying Electron Applications（英文深度版）](/advanced/electron)
3. 再看 [Chrome DevTools Protocol（中文）](/zh/advanced/cdp)
4. 再看 [TypeScript Adapter Guide（英文）](/developer/ts-adapter)
5. 最后找一个现成桌面适配器文档照着做

## 最后一个实践建议

不要一上来就做很大的命令面。

先把下面 5 个做稳：
- `status`
- `dump`
- `read`
- `send`
- `new`

这 5 个稳定了，再往外扩，成本最低，返工也最少。
