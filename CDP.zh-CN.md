# 通过 CDP 远程连接 OpenCLI (服务器/无头环境)

如果你无法使用 Playwright MCP Bridge 浏览器扩展（例如：在由于没有提供界面的远程无头服务器上运行 OpenCLI 时），OpenCLI 提供了通过连接 **CDP (Chrome DevTools Protocol)** 来直接操作 Chrome 的备选方案。

处于安全考虑，CDP 默认仅绑定到 `localhost` 本地端口，这意味着要从远程服务器访问本地的 CDP 服务，需要引入额外的网络方案。本文说明了：
1. 如何启用 Chrome 的 CDP 调试端口
2. 借助于 **SSH 隧道反向代理** 或 **反向代理服务 (ngrok 等)** 等网络方案将本地端口暴露给你的服务器。

## 方法一：SSH 隧道 (反向端口转发)

如果你可以通过 SSH 连接到服务器，这是最简单的方法。

### 第一步：启动带远程调试的 Chrome（本地电脑）

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug-profile"
```

**Windows:**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug-profile"
```

### 第二步：登录目标网站

在打开的 Chrome 实例中，登录你要使用的网站（如 bilibili.com、zhihu.com），以确保会话中包含正确的 Cookie。

---

## 暴露给服务器的网络连接方案

在你的本地启动 CDP 后，你需要通过安全的方式将 9222 端口暴露给远端的服务器。根据你的网络条件，请从下方两种方法中选择其一。

### 方法一：SSH 隧道反向端口转发 (推荐)

将调试端口反向转发到服务器：

```bash
ssh -R 9222:localhost:9222 your-server
```

### 第四步：在服务器上运行 OpenCLI

在服务器上，设置环境变量并运行 OpenCLI：

```bash
export OPENCLI_CDP_ENDPOINT="http://localhost:9222"
opencli doctor                    # 验证连接
opencli bilibili hot --limit 5    # 测试命令
```

## 方法二：反向代理 (ngrok / frp / socat)

如果由于网络原因无法使用 SSH 隧道，你可以使用内网穿透或反向代理工具（如 `ngrok`, `frp`, `socat` 等）将本地的 CDP 端口暴露给服务器。

### 使用 ngrok 示例

1. 在本地启动带有远程调试口 (9222) 的 Chrome（参考上方第一步）。
2. 在本地运行 ngrok 暴露该端口：
   ```bash
   ngrok http 9222
   ```
3. 复制生成的 ngrok URL (例如：`https://abcdef.ngrok.app`)。
4. 在服务器上，将该 URL 作为 CDP endpoint 环境变量配置：
   ```bash
   export OPENCLI_CDP_ENDPOINT="https://abcdef.ngrok.app"
   opencli bilibili hot
   ```
   *注：Playwright 支持直接传入 HTTP Endpoint，它会自动请求 `/json/version` 来获取最终的 WebSocket 连接地址。*
