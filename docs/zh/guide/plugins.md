# 插件

OpenCLI 支持社区贡献的 plugins。你可以从 GitHub 安装第三方 adapters，它们会和内置 commands 一起在启动时自动发现。

## 安装插件

```bash
# 安装插件
opencli plugin install github:ByteYue/opencli-plugin-github-trending

# 列出已安装插件
opencli plugin list

# 更新单个插件
opencli plugin update github-trending

# 更新全部已安装插件
opencli plugin update --all

# 使用插件（本质上就是普通 command）
opencli github-trending today

# 卸载插件
opencli plugin uninstall github-trending
```

## 插件目录结构

Plugins 存放在 `~/.opencli/plugins/<name>/`。每个子目录都会在启动时扫描 `.yaml`、`.ts`、`.js` 命令文件，格式与内置 adapters 相同。

## 安装来源

```bash
opencli plugin install github:user/repo
opencli plugin install https://github.com/user/repo
```

如果仓库名带 `opencli-plugin-` 前缀，本地目录会自动去掉这个前缀。例如 `opencli-plugin-hot-digest` 会变成 `hot-digest`。

## 版本追踪

OpenCLI 会把已安装 plugin 的版本记录到 `~/.opencli/plugins.lock.json`。每条记录会保存 plugin source、当前 git commit hash、安装时间，以及最近一次更新时间。只要有这份元数据，`opencli plugin list` 就会显示对应的短 commit hash。

## YAML plugin 示例

```text
my-plugin/
  hot.yaml
```

```yaml
site: my-plugin
name: hot
description: Example plugin command
strategy: public
browser: false

pipeline:
  - evaluate: |
      () => [{ title: 'hello', url: 'https://example.com' }]

columns: [title, url]
```

## TypeScript plugin 示例

```text
my-plugin/
  index.ts
  package.json
```

```json
{
  "name": "opencli-plugin-my-plugin",
  "type": "module"
}
```

```ts
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'my-plugin',
  name: 'hot',
  description: 'Example TS plugin command',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['title', 'url'],
  func: async () => [{ title: 'hello', url: 'https://example.com' }],
});
```

运行 `opencli plugin install` 时，TS plugins 会自动完成基础设置：

1. 安装 plugin 自身依赖
2. 补齐 TypeScript 运行环境
3. 将宿主 `@jackwener/opencli` 链接到 plugin 的 `node_modules/`，保证 `@jackwener/opencli/registry` 指向当前宿主版本

## 示例 plugins

- `opencli-plugin-github-trending`：GitHub Trending 仓库
- `opencli-plugin-hot-digest`：多平台热点聚合（zhihu、weibo、bilibili、v2ex、stackoverflow、reddit、linux-do）
- `opencli-plugin-juejin`：稀土掘金热榜、分类和文章流

## 排查问题

### TS plugin import 报错

如果看到 `Cannot find module '@jackwener/opencli/registry'`，通常是宿主 symlink 失效。重新安装 plugin 即可：

```bash
opencli plugin uninstall my-plugin
opencli plugin install github:user/opencli-plugin-my-plugin
```

安装或卸载 plugin 后，建议重新打开一个终端，确保启动时重新发现命令。
