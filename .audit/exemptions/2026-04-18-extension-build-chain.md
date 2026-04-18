# 豁免/容忍登记 — 2026-04-18（extension 构建链）

本文件按 CLAUDE.md §4.4 记录 `extension/` 自编译场景下新增的两项传递依赖违规及其容忍依据。与 `2026-04-17-undici-vite.md` 同目录，分日期独立存放。

**背景**：jdy 作为用户使用本项目，`opencli doctor` 指引需要自行 `cd extension && npm run build` 加载浏览器扩展。扩展的构建链由 `vite@6.4.1` 驱动，其传递依赖包含 `postcss / rollup / tinyglobby / picomatch / fdir / nanoid / picocolors / source-map-js` 等。当构建链中出现未修复 HIGH CVE 时，我们面临与 `undici` 相同的权衡：选 CVE 修复版（违反 §4.2 的 90 天规则）还是选合规版（接受已知 HIGH CVE）。

处理决策与 `undici` 一致：**优先 CVE 修复**，在本文件登记 §4.4 豁免依据。

---

## 1. `picomatch@4.0.4` — §4.2 90-天规则豁免（EXEMPT · TRANSITIVE）

### 基本事实

| 项目 | 值 |
|------|---|
| 类型 | 扩展开发依赖传递（`extension/vite@6.4.1` → `picomatch`） |
| 本应锁定的合规版本 | `picomatch@4.0.3`（277 天） |
| 实际锁定版本 | `picomatch@4.0.4` |
| 实际发布时间 | 2026-03-23（**26 天**） |
| 违反规则 | CLAUDE.md §4.2 准入检查第 2 条（发布 ≥90 天） |

### 豁免依据（§4.4）

`picomatch@4.0.3` 及以下所有版本位于 2 个 GitHub Advisory 的受影响范围：

| GHSA | 严重度 | 描述 | 修复版本 |
|------|--------|------|---------|
| GHSA-3v7f-55p6-f55p | HIGH | Method Injection in POSIX Character Classes causes incorrect Glob Matching | 4.0.4 |
| GHSA-c2c7-rcm5-vvqj | HIGH | ReDoS via extglob quantifiers | 4.0.4 |

**影响路径**：
- `extension/vite@6.4.1` 在 `vite build` 阶段用 picomatch 解析 `include`/`exclude` glob
- `tinyglobby@0.2.15`（90d 合规）依赖 `picomatch ^4.0.3`，自动升格到 4.0.4

**矛盾现实**：
- picomatch `<=4.0.3` 全部在 2 个 HIGH CVE 受影响范围
- picomatch `4.0.4` 是目前唯一修复版，发布仅 26d
- 所有"合规（≥90d）且已修复 CVE"的 picomatch 版本**不存在**

### 攻击面评估（为什么风险低于 undici）

- picomatch 输入来自扩展源码里的 glob pattern，是开发者自己写的字面量
- 非远程攻击者可控数据，CVE 触发条件（恶意 glob 字符串）在本场景不可达
- 即便攻击成立，后果是 `vite build` 本地时间变长或错误匹配文件——不涉及 runtime、不进入 npm tarball、不进扩展 `dist/`

即便如此，仍选 CVE 修复版而非让已知 CVE 留在供应链中。

### 附加合规检查（§4.4 要求仍做 §4.2 第 1/4/5 项）

| 检查 | 结果 |
|------|------|
| 1. 包身份（typosquat） | ✅ `micromatch/picomatch`，维护者 jonschlinkert（长期维护者，无变更） |
| 4. lifecycle scripts | ✅ `hasInstallScript: false` |
| 5. lockfile integrity | ✅ extension/package-lock.json 锁 sha512 |

### 撤销条件

- picomatch `4.0.4` 跨过 90d 门槛（2026-06-21 附近）→ 改为合规，删除本条登记
- picomatch `4.0.5+` 发布且跨过 90d → 升级到新稳定版
- `tinyglobby` 在 vite 新版里被替换 → 评估是否还需要 picomatch

---

## 2. `rollup@4.59.0`（+ 25 个 `@rollup/rollup-*-*@4.59.0` 平台原生包）— §4.2 90-天规则豁免（EXEMPT · TRANSITIVE）

### 基本事实

| 项目 | 值 |
|------|---|
| 类型 | 扩展开发依赖传递（`extension/vite@6.4.1` → `rollup`） |
| 本应锁定的合规版本 | `rollup@4.55.1`（103 天） |
| 实际锁定版本 | `rollup@4.59.0` |
| 实际发布时间 | 2026-02-22（**54 天**） |
| 违反规则 | CLAUDE.md §4.2 准入检查第 2 条 |

`rollup` 通过 `optionalDependencies` 声明了 25 个平台原生包（`@rollup/rollup-<platform>-<arch>`），它们与主包同步发布、同版本号、同发布时间。本豁免统一覆盖整个 rollup 家族（共 26 条 `name@version` 条目）。

### 豁免依据（§4.4）

`rollup@4.58.0` 及以下所有版本位于 1 个 GitHub Advisory 的受影响范围：

| GHSA | 严重度 | 描述 | 修复版本 |
|------|--------|------|---------|
| GHSA-mw96-cpmx-2vgc | HIGH | Arbitrary File Write via Path Traversal | 4.59.0 |

**影响路径**：
- `extension/vite@6.4.1` 使用 rollup 作为 production bundler
- 该 CVE 触发条件：rollup 处理恶意构造的模块路径时，相对路径解析逃逸到工作目录之外

**矛盾现实**：
- rollup `4.x <=4.58.0` 全部在受影响范围
- rollup `4.58.1`（patch）从未发布，最早修复是 `4.59.0`
- 所有"合规（≥90d）且已修复 CVE"的 rollup 版本**不存在**

### 攻击面评估（为什么风险低于 undici）

- rollup 的输入是扩展源码的 import 图，全部源码来自 repo 本身
- 非远程攻击者可控数据；要触发 CVE，攻击者需先向 repo 注入恶意 import 路径
- 若 repo 已被写入恶意源码，CVE 本身是次要问题
- 不进入 runtime、不进入发布的扩展 `dist/`（dist 是已构建的产物）

### 附加合规检查

| 检查 | 结果 |
|------|------|
| 1. 包身份（typosquat） | ✅ `rollup/rollup`，维护者 lukastaegert（长期维护者，无变更） |
| 4. lifecycle scripts | ✅ `hasInstallScript: false`（rollup 主包及所有 `@rollup/*` 平台包均无 install script） |
| 5. lockfile integrity | ✅ 锁 sha512 |

### 撤销条件

- rollup `4.59.0` 跨过 90d 门槛（2026-05-23 附近）→ 改为合规，删除本条登记
- vitepress / vite 未来版本改用其他 bundler（极不可能）
- rollup 发布满 90d 的更新 minor 版，且无新 CVE → 升级

---

## 3. `exemptions.json` 为什么未新增条目

`scripts/audit/check-dep-age.mjs` 的判定逻辑：

- **直接依赖违规 §4.2**（fail）→ 必须在 exemptions.json 登记，否则审计失败
- **传递依赖违规 §4.2**（warn）→ 默认归入 "Grandfathered transitive violations"，由 renovate 后续 90d 规则滚动

本次两项豁免（picomatch、rollup + 原生包）全部是**扩展的传递依赖**，不触发 fail。参照 `2026-04-17-undici-vite.md` §2 vite（同属传递依赖 TOLERATE）的做法，**本文件只作叙述性登记，不扩展 `.audit/exemptions/exemptions.json`**。

若未来引入 `--strict-transitive` 强制模式，届时需为上述 27 条 `name@version`（picomatch 1 条 + rollup 家族 26 条）批量补登记。

---

## 4. 验证记录（2026-04-18）

```bash
# extension/package.json overrides 改为:
#   "postcss": "8.5.6", "rollup": "4.59.0",
#   "tinyglobby": "0.2.15", "picomatch": "4.0.4"
cd extension && rm -rf node_modules package-lock.json && npm install --ignore-scripts
# → added 68 packages

npm audit
# → 1 high severity vulnerability (vite dev-server path traversal, already tolerated in 2026-04-17 §3)

cd .. && node scripts/audit/check-dep-age.mjs extension
# → OK (>=90d): 41
# → Direct violations: 0
# → Grandfathered transitive violations (warn): 27  (picomatch 1 + rollup family 26)
# → PASS (with warnings)
```

`npm audit` 从改动前的 **5 vulnerabilities (2 moderate, 3 high)** 降至 **1 high**（vite，已有 TOLERATE 登记）；不合规传递依赖数从 5 项 × 数量级降至仅「CVE 修复所必需的」27 项。

---

## 5. 复审节奏

与 `2026-04-17-undici-vite.md` 的 2026-07-17 复审合并：

- [ ] **2026-05-23 之前**：rollup 4.59.0 跨 90d → 去掉豁免标签
- [ ] **2026-06-21 之前**：picomatch 4.0.4 跨 90d → 去掉豁免标签
- [ ] 若届时有 rollup / picomatch 的更新小版本且修复 CVE，评估升级至新合规版

## 6. 操作人 / 时间

- 授权人：jdy（2026-04-18 对话中明确选择 "A"）
- 执行人：Claude（opus-4-7, 1M context）
- 记录人：同执行人
- 失误披露：本次执行过程中初次建议的"全部回退到 90d 合规版"漏做 `npm audit`，会引入 5 个已知 HIGH CVE；经 jdy 质疑后纠正为"优先 CVE 修复 + §4.4 豁免"。记入此处以避免下次重犯。
