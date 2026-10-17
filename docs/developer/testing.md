# Testing Guide

测试配置以 `vitest.config.ts` 和 `package.json` 为准；不要维护容易过期的测试数量清单。

## 测试职责

| Project | 位置 | 负责验证 |
|---|---|---|
| `unit` | `src/**/*.test.ts` | 核心逻辑、参数、输出、runtime 与错误分类 |
| `extension` | `extension/src/**/*.test.ts` | 使用 mocked Chrome APIs 的 extension 行为 |
| `adapter` | `clis/**/*.test.{ts,js}` | 站点解析、数据归一化、站点特有错误与 command wiring |
| `e2e-fixed-port` | `tests/e2e/browser-tabs.test.ts`、`daemon-transport.test.ts` | 真实 daemon 与模拟 extension 的协议；串行运行 |
| `e2e` | `tests/e2e/` 中配置启用的文件 | 默认只跑离线 CLI、管理命令与 auth contract；真实站点和 GitHub plugin 测试需显式启用 |
| `smoke` | `tests/smoke/` | 公开 API 与命令注册健康检查，无需 Chrome |

## 本地验证

先跑改动对应的测试；共享逻辑或跨模块改动再扩大范围。

```bash
npm ci
npm run build

# 默认：unit + extension + adapter，不调用真实站点 E2E
npm test

# 目标文件
npx vitest run --project adapter clis/ctrip/auth.test.js

# 真实 CLI + 隔离的站点 fixture，无需登录或 Chrome
npx vitest run --project e2e tests/e2e/auth-contract.test.ts tests/e2e/management.test.ts

# 离线 CLI 与 daemon contract（固定端口测试会重启 daemon）
npm run test:e2e

# 少量严格的真实公开 API 检查
npx vitest run --project smoke

# 所有默认启用的 projects，包含公开 API smoke
npm run test:all
```

`npm run build` 已包含 TypeScript 检查。只需要类型反馈时可单独运行 `npm run typecheck`。
E2E 运行构建后的 CLI，修改源码后先重新 build。
`e2e-fixed-port` 使用固定端口，运行前确认不会与正在使用的 daemon 冲突。

## 如何避免重复测试

- 共享 helper 的完整边界矩阵放在 helper 所在层；各 command 保留必要 wiring 验证。
- Adapter test 覆盖站点 response shape 和解析边界；E2E 保留代表性的成功、typed error、exit code 与跨层连接验证，不复制整套解析矩阵。
- CLI 输出格式入口统一放在 `tests/e2e/management.test.ts`；具体格式渲染逻辑放在 `src/output.test.ts`。
- 不逐 command 抄录 columns、strategy、默认值做静态断言；manifest 一致性、全量 `validate` 与 column lint 统一负责声明检查。站点测试应调用行为；特有的 session/navigation contract 仍可保留。
- 相同 test body 如果调用不同 command，并不自动构成重复。
- 不添加“非零退出时只要有文字就通过”的 auth test：未知命令和程序崩溃也能满足这种断言。应检查具体错误类型、状态或输出内容。
- 不为了验证 auth 自动执行创建、删除、发布或付费操作；使用隔离 fixture 验证这些分支。

## 浏览器与真实站点

`browser-public.test.ts` 等真实站点测试依赖网络、站点状态和可用的 Browser Bridge。
部分测试允许站点限制导致的空数据，因此不能把这些通过结果视为完整登录流程已验证。
Auth 的确定性 CLI contract 在 `auth-contract.test.ts`，站点特有判断在 adapter tests。

可选测试通过环境变量启用：

```bash
# 手动运行真实站点、文章下载与 GitHub plugin 测试
OPENCLI_E2E=1 npm run test:e2e

# 真实 Chrome + extension contract
OPENCLI_AX_E2E=1 npx vitest run --project e2e tests/e2e/browser-ax-chrome.test.ts

# 站点槽位池（OPENCLI_SITE_SLOTS）：真实 daemon + extension + 隔离浏览器，本地 fixture；需先停掉占用 19825 的 daemon。
# 品牌版 Google Chrome 会忽略 --load-extension，需用 CHROME_PATH 指向 Chromium / Chrome for Testing
# 本地有界面时窗口可能被其他窗口遮挡、被系统标记为 hidden，渲染断言会不稳定，建议加 OPENCLI_E2E_HEADLESS=1
OPENCLI_E2E_HEADLESS=1 CHROME_PATH=/path/to/chrome-for-testing OPENCLI_AX_E2E=1 npx vitest run --project e2e tests/e2e/site-slots-chrome.test.ts
```

真实登录问题还应使用已登录浏览器，手动执行对应的只读命令验证。

## CI 分工

| Workflow / job | 频率 | 覆盖 |
|---|---|---|
| CI / build | PR、main/dev push、每周、手动 | Linux build、lint、manifest 与全部离线 CLI E2E；每周/手动再跑三 OS build |
| CI / unit-test | 同上 | Linux 两个 shard 跑完整 unit + extension + adapter；每周/手动额外跑 macOS/Windows core tests |
| CI / bun-test | 每周、手动 | Bun runtime compatibility |
| CI / smoke-test | 每周、手动 | 四个公开 API family 的代表性 endpoint；非零退出即失败 |
| E2E Headed Chrome | 匹配路径的 main/dev push、release tag、每日、手动 | 三 OS 的 CLI tab/daemon contract；Linux 真实 extension，不重复整套站点 E2E |

Bun compatibility 不再作为每次 PR 的 gate；相关 runtime 改动应在本地额外运行 `npm run test:bun`。
CI 的精确触发条件与命令以 `.github/workflows/` 为准。

跨平台 core/build 回归改由每周或手动检查，可能比每次 push 更晚发现。真实站点宽覆盖改为 opt-in；默认 CI 不证明所有网站当前可用。
