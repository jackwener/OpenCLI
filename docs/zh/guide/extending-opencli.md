# 扩展 OpenCLI

OpenCLI 有五类扩展路径。按源码放在哪里、命令要如何共享来选。

| 目标 | 使用方式 | 源码位置 | 命令入口 |
|------|----------|----------|----------|
| 在自己的 Git repo 里写个人网站命令 | 本地 plugin | 你的项目目录，symlink 到 `~/.opencli/plugins/` | `opencli <plugin> <command>` |
| 快速写一个只在本机用的 adapter | User adapter | `~/.opencli/clis/<site>/<command>.js` | `opencli <site> <command>` |
| 本地修改官方 adapter | Adapter override | `~/.opencli/clis/<site>/` | `opencli <site> <command>` |
| 发布或安装第三方命令 | Plugin | Git repo，安装到 `~/.opencli/plugins/` | `opencli <plugin> <command>` |
| 包装已有本机 binary | External CLI | `~/.opencli/external-clis.yaml` | `opencli <tool> ...` |

## 把个人命令放在自己的 Git repo

如果你希望源码留在普通项目目录里，用 Git 管理，使用本地 plugin。

```bash
opencli plugin create my-cnn
cd my-cnn
git init
opencli plugin install file://$(pwd)
opencli my-cnn hello
```

`plugin install file://...` 会在 `~/.opencli/plugins/` 下创建 symlink。源码仍然留在你的项目目录，编辑和提交都在项目目录完成。

长期维护的自建命令推荐走这条路径。

## `~/.opencli/clis` 下的私人 adapter

如果你只想快速生成一个本机 adapter，不需要单独项目目录，可以用 user adapter。

```bash
opencli browser init cnn/top
# edit ~/.opencli/clis/cnn/top.js
opencli browser verify cnn/top
opencli cnn top
```

User adapter 加载路径是：

```text
~/.opencli/clis/<site>/<command>.js
```

这条路径适合快速本地自动化。需要版本管理、review、共享的代码推荐做成 plugin。

如果命令有 required positional args，而且 fixture 还没创建，第一次 verify 时直接传 seed：

```bash
opencli browser verify instagram/collection-create --write-fixture --seed-args opencli-verify
opencli browser verify example/detail --write-fixture --seed-args '["https://example.com/item/1", "--limit", 3]'
```

`--seed-args` 只在 fixture 没有 `args` 时生效。fixture 写出后，`opencli browser verify` 会从 `~/.opencli/sites/<site>/verify/<command>.json` 读取 args。

`browser verify` 也会先检查 row shape：每行保持紧凑（顶层 key 不超过 12 个）、嵌套深度不超过 1，并且 `id` / `user_id` 这类 id-shaped 字段必须在顶层。

## 本地覆盖官方 adapter

如果你想改一个已有官方 adapter，用 `adapter eject`。

```bash
opencli adapter eject twitter
# edit ~/.opencli/clis/twitter/*.js
opencli adapter reset twitter
```

`~/.opencli/clis/<site>/<command>.js` 会在本机覆盖同名 package adapter。`opencli browser verify <site>/<command>` 也会跑本地覆盖版本，所以本地 verify 通过不代表 package 里的 adapter 已经改好。

Package 里的 `cli-manifest.json` 只描述 bundled adapter。User adapter 是运行时发现的，不需要写 manifest。

把本地修复复制到仓库发 PR 后，merge 后要删除本地副本，或运行 `opencli adapter reset <site>`。否则本地文件会继续 shadow 后续 package 更新。`opencli doctor` 会在发现这种 shadowing 时给出 warning。

## Plugin：共享命令

Plugin 是第三方命令包。可以从 GitHub、任意 git URL 或本地目录安装。

```bash
opencli plugin install github:user/opencli-plugin-my-tool
opencli plugin install https://github.com/user/opencli-plugin-my-tool
opencli plugin install file:///absolute/path/to/plugin
opencli plugin list
opencli plugin update --all
opencli plugin uninstall my-tool
```

每个 plugin 目录会扫描 `.ts` 和 `.js` 命令文件。TypeScript plugin 会在安装时 transpile。

manifest 字段、TypeScript 示例、更新行为和 monorepo 发布方式见 [插件](./plugins.md)。

## 一个 repo 管多个自建站点

Git 托管的 plugin collection 可以在 `opencli-plugin.json` 里声明多个 sub-plugin：

```json
{
  "plugins": {
    "cnn": { "path": "packages/cnn" },
    "reuters": { "path": "packages/reuters" }
  }
}
```

```bash
opencli plugin install github:user/opencli-plugins
opencli plugin install github:user/opencli-plugins/cnn
```

本地开发时，直接安装每个 sub-plugin 目录：

```bash
opencli plugin install file:///absolute/path/opencli-plugins/packages/cnn
opencli plugin install file:///absolute/path/opencli-plugins/packages/reuters
```

本地 `file://` 安装要求目标目录本身就是一个有效 plugin，并且目录内有命令文件。monorepo root 请推到 GitHub 后走 GitHub monorepo 安装流程。

## External CLI passthrough

如果命令已经是本机 binary，只想统一挂到 `opencli` 下，用 external CLI registration。

```bash
opencli external register my-tool \
  --binary my-tool \
  --install "npm i -g my-tool" \
  --desc "My internal CLI"

opencli my-tool --help
```

External CLI 会把 stdio 和 exit code 透传给底层 binary。
