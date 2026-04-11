# Record Workflow

`record` 是为「无法用 `explore` 自动发现」的页面（需要登录操作、复杂交互、SPA 内路由）准备的手动录制方案。

---

## 工作原理

```
opencli record <url>
  → 打开 automation window 并导航到目标 URL
  → 向所有 tab 注入 fetch/XHR 拦截器（幂等，可重复注入）
  → 每 2s 轮询一次：发现新 tab 自动注入，drain 所有 tab 的捕获缓冲区
  → 超时（默认 60s）或按 Enter 停止
  → 分析捕获到的 JSON 请求：去重 → 评分 → 生成候选 TS
```

**拦截器特性**：
- 同时 patch `window.fetch` 和 `XMLHttpRequest`
- 只捕获 `Content-Type: application/json` 的响应
- 过滤纯对象少于 2 个 key 的响应（避免 tracking/ping）
- 跨 tab 隔离：每个 tab 独立缓冲区，轮询时分别 drain
- 幂等注入：同一 tab 二次注入时先 restore 原始函数再重新 patch，不丢失已捕获数据

---

## 使用步骤

```bash
# 1. 启动录制（建议 --timeout 给足操作时间）
opencli record "https://example.com/page" --timeout 120000

# 2. 在弹出的 automation window 里正常操作页面：
#    - 打开列表、搜索、点击条目、切换 Tab
#    - 凡是触发网络请求的操作都会被捕获

# 3. 完成操作后按 Enter 停止（或等超时自动停止）

# 4. 查看结果
cat .opencli/record/<site>/captured.json        # 原始捕获
ls  .opencli/record/<site>/candidates/          # 候选 TS
```

---

## 页面类型与捕获预期

| 页面类型 | 预期捕获量 | 说明 |
|---------|-----------|------|
| 列表/搜索页 | 多（5~20+） | 每次搜索/翻页都会触发新请求 |
| 详情页（只读） | 少（1~5） | 首屏数据一次性返回 |
| SPA 内路由跳转 | 中等 | 路由切换会触发新接口，但首屏请求在注入前已发出 |
| 需要登录的页面 | 视操作而定 | 确保 Chrome 已登录目标网站 |

> **注意**：如果页面在导航完成前就发出了大部分请求（SSR 注水），拦截器会错过这些请求。
> 解决方案：页面加载完成后，手动触发能产生新请求的操作（搜索、翻页、切 Tab、展开折叠项等）。

---

## 候选 TS 微调

生成的候选 TS 是起点，通常需要微调：

```typescript
// 自动生成的候选，需要微调
// site: tae
// name: getList          # 从 URL path 推断的名称
// strategy: cookie
// browser: true
// pipeline:
//   - navigate: https://...
//   - evaluate: |
//       (async () => {
//         const res = await fetch('/approval/getList.json?procInsId=...', { credentials: 'include' });
//         ...
//       })()
```

**转换为 JS CLI**（参考 `clis/tae/add-expense.js` 风格）：

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'tae',
  name: 'get-approval',
  description: '查看报销单审批流程和操作记录',
  domain: 'tae.alibaba-inc.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'proc_ins_id', type: 'string', required: true, positional: true, help: '流程实例 ID（procInsId）' },
  ],
  columns: ['step', 'operator', 'action', 'time'],
  func: async (page, kwargs) => {
    await page.goto('https://tae.alibaba-inc.com/expense/pc.html?_authType=SAML');
    await page.wait(2);
    const result = await page.evaluate(`(async () => {
      const res = await fetch('/approval/getList.json?taskId=&procInsId=${kwargs.proc_ins_id}', {
        credentials: 'include'
      });
      const data = await res.json();
      return data?.content?.operatorRecords || [];
    })()`);
    return (result as any[]).map((r, i) => ({
      step: i + 1,
      operator: r.operatorName || r.userId,
      action: r.operationType,
      time: r.operateTime,
    }));
  },
});
```

**转换要点**：
1. URL 中的动态 ID 提取为 `args`
2. `captured.json` 里的真实 body 结构用于确定数据路径
3. tae 系统用 `{ success, content, errorCode, errorMsg }` 外层包裹，取数据走 `content.*`
4. 文件放入 `clis/<site>/`，`npm run build` 后自动发现

---

## 故障排查

| 现象 | 原因 | 解法 |
|------|------|------|
| 捕获 0 条请求 | 拦截器注入失败，或页面无 JSON API | 检查 daemon：`curl localhost:19825/status` |
| 捕获量少（1~3 条） | 只读详情页，首屏数据在注入前已发出 | 手动操作触发更多请求（搜索/翻页） |
| 候选 TS 为 0 | 捕获的 JSON 都没有 array 结构 | 直接看 `captured.json` 手写 TS CLI |
| 新开的 tab 没有被拦截 | 轮询间隔内 tab 已关闭 | 缩短 `--poll 500` |
| 二次运行数据不连续 | 正常，每次 `record` 是新的 automation window | 无需处理 |
