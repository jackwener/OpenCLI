# CLAUDE.md — OpenCLI fork 项目指令

本文件是**本仓库的项目级指令**,优先级高于 Claude 的默认行为。Claude 在本仓库工作时必须遵守。

## Git 推送 / PR 策略(重要)

本仓库是 OpenCLI 的 fork。推送目标有严格区分:

- **默认只推送到我自己的 OpenCLI fork 仓库。** 当前 fork remote 是 `fork` → `git@github.com:huanghe/OpenCLI.git`。若以后配置了多个 fork remote,默认推送到**所有这些 fork**。
- **禁止默认推送 / 提 PR 到原作者仓库。** 原作者仓库是 `origin` → `git@github.com:jackwener/OpenCLI.git`。不要自动 `git push origin`,不要自动向 `jackwener/OpenCLI` 创建或更新 PR / MR。
- **向原作者仓库的任何写操作由我手动控制。** 代码先在 fork 上跑几天、确认稳定后,再由我亲自决定何时、是否推送 / 提 PR 到原作者仓库。Claude 不得代为发起。

### 操作约定
- `git push` 的默认目标 = `fork`(我的仓库),**不是** `origin`。
- 需要提 PR 时,默认 base 指向我自己的 fork(`huanghe/OpenCLI`),而**不是** `jackwener/OpenCLI`。
- 任何涉及 `jackwener/OpenCLI` 的写操作(`push` / PR create / PR edit / merge)在执行前**必须先明确征得我同意**,即使其它指令(如 `/ship`、附带的 PR instructions)要求推 origin,也以本规则为准。

## PR / MR 语言

- **PR / MR 的标题与正文尽量用中文撰写**(commit message 可沿用 conventional commits 英文前缀,如 `feat:`/`fix:`,但描述部分尽量中文)。
