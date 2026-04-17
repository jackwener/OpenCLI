# Browser Bridge 设置

> **⚠️ 重要**: 浏览器命令复用你的 Chrome 登录会话。运行命令前必须在 Chrome 中登录目标网站。

OpenCLI 通过轻量级 **Browser Bridge** Chrome 扩展 + 微守护进程连接浏览器（零配置，自动启动）。

## 扩展安装

### 方法 1：下载预构建版本（推荐）

1. 前往 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension-v{version}.zip`。
2. 解压后打开 `chrome://extensions`，启用**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择解压后的文件夹。

### 方法 2：加载源码（开发者）

1. 打开 `chrome://extensions`，启用**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择仓库中的 `extension/` 目录。

## 验证

```bash
opencli doctor            # 检查扩展 + 守护进程连接
```

## 多 Tab 定位

浏览器命令默认运行在共享的 `browser:default` workspace 中；如果需要操作指定 tab，可以显式传目标 target。

```bash
opencli browser tab list
opencli browser tab new https://www.baidu.com/
opencli browser eval --tab <targetId> 'document.title'
opencli browser tab select <targetId>
opencli browser get title
opencli browser tab close <targetId>
```

规则如下：

- `opencli browser tab list` 会打印当前 tab 的 `targetId`。
- `--tab <targetId>` 会把单条 browser 命令路由到对应 tab。
- `tab new` 只会新建 tab，不会改变默认浏览器目标。
- `tab select <targetId>` 会把该 tab 设为后续未显式指定 target 的 `opencli browser ...` 命令默认目标。
- `tab close <targetId>` 会关闭该 tab；如果它正好是当前默认目标，会一并清掉这条默认绑定。

## Daemon 生命周期

Daemon 在首次运行浏览器命令时自动启动，之后保持常驻运行。

```bash
opencli daemon stop      # 优雅关停
```

Daemon 为常驻模式，会一直运行直到你显式停止（`opencli daemon stop`）或卸载包。
