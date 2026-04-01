# 仓库指南

## 项目结构与模块组织

`src/` 是 CLI 运行时、命令发现、浏览器集成、下载能力和 pipeline 引擎的主目录。内置 adapter 放在 `src/clis/<site>/` 下，文件通常是 `.yaml` 或 `.ts`；如果测试只针对某个 adapter，测试文件应尽量放在相邻目录。端到端测试和 smoke 测试分别位于 `tests/e2e/` 与 `tests/smoke/`。Chrome 扩展是独立的 TypeScript 工程，源码在 `extension/src/`。文档和 adapter 索引在 `docs/`，发布与维护脚本在 `scripts/`。

## 构建、测试与开发命令

- `npm install`：安装根目录依赖，要求 Node `>=20`。
- `npm run dev`：通过 `tsx` 直接运行 CLI 入口，适合本地开发。
- `npm run build`：将 `src/` 编译到 `dist/`，复制 YAML adapter，并重建 manifest。
- `npm run typecheck` 或 `npm run lint`：执行严格的 TypeScript 类型检查（`tsc --noEmit`）。
- `npm test`：运行核心 Vitest 单元测试。
- `npm run test:adapter`：运行 `src/clis/{zhihu,twitter,reddit,bilibili}` 下的重点 adapter 测试。
- `npm run test:e2e` 或 `npx vitest run tests/e2e/`：运行真实 CLI 集成测试；先执行构建。
- `cd extension && npm run build`：构建 Browser Bridge 扩展。

## 代码风格与命名约定

项目使用 TypeScript strict mode、ES Modules，以及显式 `.js` 导入后缀。沿用现有的 2 空格缩进。优先使用命名导出，不使用默认导出。文件名使用 `kebab-case`，函数和变量使用 `camelCase`，类型和类使用 `PascalCase`。adapter 开发优先选择 YAML；只有在需要浏览器端逻辑或多步骤流程时再使用 TypeScript。可预期的失败应统一抛出 `CliError` 子类，不要直接抛裸 `Error`。

## 测试说明

单元测试文件命名为 `*.test.ts`，并尽量放在被测代码旁边。adapter 行为测试优先放在对应 adapter 目录；CLI 行为测试放在 `tests/e2e/*.test.ts`。运行 E2E 或 smoke 测试前先执行 `npm run build`，因为这些测试会直接调用 `dist/main.js`。扩展浏览器 E2E 覆盖默认不开启，如需启用请设置 `OPENCLI_E2E=1`。

## 提交与 Pull Request 规范

提交信息使用 Conventional Commits，例如 `feat(browser): add ONES adapter support` 或 `fix(spotify): handle token refresh`。PR 需要包含简要说明、关联 issue、已执行的检查项，以及必要时附上输出结果或截图。如果新增或修改 adapter，还需要同步更新 `docs/adapters/`、`docs/adapters/index.md`、`docs/.vitepress/config.mts`，并保持 `README.md` 与 `README.zh-CN.md` 内容一致。
