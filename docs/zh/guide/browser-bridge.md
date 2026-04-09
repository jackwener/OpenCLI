# Browser Bridge 设置

> **⚠️ 重要**: 浏览器命令复用你的 Chrome 登录会话。运行命令前必须在 Chrome 中登录目标网站。

OpenCLI 通过轻量级 **Browser Bridge** Chrome 扩展 + 微守护进程连接浏览器（零配置，自动启动）。

## 扩展安装

### 方法 1：下载预构建版本（推荐）

1. 前往 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension.zip`。
2. 解压后打开 `chrome://extensions`，启用**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择解压后的文件夹。

### 方法 2：加载源码（开发者）

1. 打开 `chrome://extensions`，启用**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择仓库中的 `extension/` 目录。

## 验证

```bash
opencli doctor            # 检查扩展 + 守护进程连接
```

## Daemon 生命周期

Daemon 在首次运行浏览器命令时自动启动，之后保持常驻运行。

```bash
opencli daemon status    # 查看 daemon 状态（PID、运行时长、扩展连接、内存）
opencli daemon stop      # 优雅关停
opencli daemon restart   # 重启
```

Daemon 为常驻模式，会一直运行直到你显式停止（`opencli daemon stop`）或卸载包。
