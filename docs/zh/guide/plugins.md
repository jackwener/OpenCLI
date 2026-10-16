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

Plugins 存放在 `~/.opencli/plugins/<name>/`。每个子目录都会在启动时扫描 `.ts`、`.js` 命令文件，格式与内置 adapters 相同。

## 安装来源

```bash
opencli plugin install github:user/repo
opencli plugin install github:user/repo/subplugin   # 安装 monorepo 中的指定子插件
opencli plugin install https://github.com/user/repo
```

如果仓库名带 `opencli-plugin-` 前缀，本地目录会自动去掉这个前缀。例如 `opencli-plugin-hot-digest` 会变成 `hot-digest`。

## 插件清单 (`opencli-plugin.json`)

插件可以在仓库根目录放置 `opencli-plugin.json` 来声明元数据：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "opencli": ">=1.0.0",
  "description": "我的插件"
}
```

| 字段 | 说明 |
|------|------|
| `name` | 插件名称（覆盖从仓库名推导的名称） |
| `version` | 语义化版本 |
| `opencli` | 所需的 opencli 版本范围（如 `>=1.0.0`、`^1.2.0`） |
| `description` | 描述 |
| `plugins` | Monorepo 子插件声明（见下文） |

清单文件是可选的——没有它的插件依然可以正常工作。

## Monorepo 插件

一个仓库可以通过在 `opencli-plugin.json` 中声明 `plugins` 字段来包含多个插件：

```json
{
  "version": "1.0.0",
  "opencli": ">=1.0.0",
  "description": "我的插件合集",
  "plugins": {
    "polymarket": {
      "path": "packages/polymarket",
      "description": "预测市场分析",
      "version": "1.2.0"
    },
    "defi": {
      "path": "packages/defi",
      "description": "DeFi 协议数据",
      "version": "0.8.0"
    },
    "experimental": {
      "path": "packages/experimental",
      "disabled": true
    }
  }
}
```

```bash
# 安装 monorepo 中的全部子插件
opencli plugin install github:user/opencli-plugins

# 安装指定子插件
opencli plugin install github:user/opencli-plugins/polymarket
```

- Monorepo 只 clone 一次到 `~/.opencli/monorepos/<repo>/`
- 每个子插件通过 symlink 出现在 `~/.opencli/plugins/<name>/`
- 更新任何子插件会拉取整个 monorepo 并刷新所有子插件
- 卸载最后一个子插件时，monorepo 目录会被自动清理

## 版本追踪

OpenCLI 会把已安装 plugin 的版本记录到 `~/.opencli/plugins.lock.json`。每条记录会保存 plugin source、当前 git commit hash、安装时间，以及最近一次更新时间。只要有这份元数据，`opencli plugin list` 就会显示对应的短 commit hash。

## Pipeline plugin 示例

```text
my-plugin/
  package.json
  hot.ts
```

`hot.ts`:

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'my-plugin',
  name: 'hot',
  description: 'Example plugin command',
  access: 'read',
  example: 'opencli my-plugin hot -f yaml',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['title', 'url'],
  pipeline: [
    { evaluate: `() => [{ title: 'hello', url: 'https://example.com' }]` },
  ],
});
```

## func() plugin 示例

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
  access: 'read',
  example: 'opencli my-plugin hot -f yaml',
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

- [`opencli-plugin-albato`](https://github.com/vecyang1/opencli-plugin-albato)：Albato 自动化工作流管理：方案查看、启停控制、失败诊断与重试
- [`opencli-plugin-amap`](https://github.com/vecyang1/opencli-plugin-amap)：高德地图收藏地点与路线导出、坐标转换 (GCJ-02/WGS-84) 与 SSR 搜索
- `opencli-plugin-github-trending`：GitHub Trending 仓库
- [`opencli-plugin-goofish`](https://github.com/vecyang1/opencli-plugin-goofish)：闲鱼买家订单、收藏夹、私信消息、个人资料、商品搜索与交易履约统计
- `opencli-plugin-hot-digest`：多平台热点聚合（zhihu、weibo、bilibili、v2ex、stackoverflow、reddit、linux-do）
- `opencli-plugin-juejin`：稀土掘金热榜、分类和文章流
- `opencli-plugin-rubysec`：RubySec 漏洞归档与单篇漏洞文章读取
- [`opencli-plugin-taobao`](https://github.com/vecyang1/opencli-plugin-taobao)：淘宝买家聊天记录、历史订单、已购店铺、收藏夹与基于关键词的聊天摘要
- [`opencli-plugin-x-article-publisher`](https://github.com/genoooool/opencli-plugin-x-article-publisher)：通过 OpenCLI 与 xPoster 将带本地图片的 Markdown 发布为 X 长文

### 社区 adapter 集合

Albato、Goofish 和 Taobao 当前将命令放在 `clis/<site>` 下，未声明 monorepo manifest。直接用 `github:vecyang1/opencli-plugin-<site>` 安装仓库根目录会在结构验证时失败。请先 clone，再安装命令目录；本地安装通过链接引用该目录，因此需要保留 clone：

```bash
git clone https://github.com/vecyang1/opencli-plugin-taobao.git
opencli plugin install ./opencli-plugin-taobao/clis/taobao
```

安装 Albato 或 Goofish 时，将两处路径中的 `taobao` 换成 `albato` 或 `goofish`。这两个仓库要求 Node.js 22.5 或更高版本。其他工具和配置请参考各仓库 README。以上为社区维护的 adapter，列出的能力不代表历史数据完整性的保证。

## 排查问题

### TS plugin import 报错

如果看到 `Cannot find module '@jackwener/opencli/registry'`，通常是宿主 symlink 失效。重新安装 plugin 即可：

```bash
opencli plugin uninstall my-plugin
opencli plugin install github:user/opencli-plugin-my-plugin
```

安装或卸载 plugin 后，建议重新打开一个终端，确保启动时重新发现命令。
