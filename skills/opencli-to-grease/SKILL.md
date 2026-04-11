---
name: opencli-to-grease
description: Convert OpenCLI commands to GreaseAI-compatible JSON format. Use when you need to export OpenCLI adapters as browser automation workflows for GreaseAI platform.
user-invocable: true
---

# OpenCLI to GreaseAI Converter

Converts OpenCLI CLI commands to GreaseAI-compatible JSON format for browser automation workflows.

> **Dependency**: Requires [greasedev/automator@7024108](https://github.com/greasedev/automator/commit/7024108) which adds `driver-layer` export and `async (intermediate) => {}` pattern.

## Output Directory Structure

生成的 JSON 文件按照 OpenCLI `clis/` 目录结构存放：

```
skills/opencli-to-grease/
├── SKILL.md
├── test.ts
├── package.json
├── tsconfig.json
└── clis/                      # 输出目录，镜像 OpenCLI clis 结构
    ├── zhihu/
    │   ├── hot.json
    │   ├── search.json
    │   └── ...
    ├── bilibili/
    │   ├── hot.json
    │   └── ...
    └── 36kr/
        └── hot.json
```

**映射规则**：
- `clis/36kr/hot.ts` → `opencli-to-grease/clis/36kr/hot.json`
- `clis/zhihu/search.ts` → `opencli-to-grease/clis/zhihu/search.json`

---

## Output Format

GreaseAI JSON structure:
```json
{
  "actions": [
    {
      "action": "open",
      "argument": { "url": "https://..." }
    },
    {
      "action": "evaluate",
      "argument": { "script": "async (intermediate) => { ... }" }
    }
  ],
  "api_endpoint": "{domain}-{command}",
  "category": "auth|search|content|action",
  "description": "命令描述",
  "is_public": true,
  "method": "GET|POST",
  "name": "CommandName",
  "output_schema": [
    { "name": "field1", "type": "string", "description": "字段描述" },
    { "name": "field2", "type": "number", "description": "字段描述" }
  ],
  "website_domain": "example.com",
  "website_id": "website-example.com"
}
```

### api_endpoint 格式

使用 `{domain}-{command}` 格式确保全局唯一：
- 移除域名前缀（如 `www.`）
- 移除域名后缀（如 `.com`）
- 使用小写和连字符

示例：
| OpenCLI 命令 | api_endpoint |
|-------------|--------------|
| `bilibili hot` | `bilibili-hot` |
| `zhihu search` | `zhihu-search` |
| `36kr hot` | `36kr-hot` |
| `www.zhihu.com hot` | `zhihu-hot` |

### output_schema 格式

从 OpenCLI `columns` 字段生成输出格式描述：

| OpenCLI column | output_schema type |
|----------------|-------------------|
| `rank` | `number` |
| `title`, `author`, `url`, `description` | `string` |
| `play`, `danmaku`, `count`, `views` | `number` |
| 其他 | `string` (默认) |

示例转换：
```typescript
// OpenCLI
columns: ['rank', 'title', 'author', 'play', 'danmaku']

// GreaseAI
"output_schema": [
  { "name": "rank", "type": "number", "description": "排名" },
  { "name": "title", "type": "string", "description": "视频标题" },
  { "name": "author", "type": "string", "description": "作者" },
  { "name": "play", "type": "number", "description": "播放量" },
  { "name": "danmaku", "type": "number", "description": "弹幕数" }
]
```

### variables 格式

从 OpenCLI `args` 字段生成，包含 `help` 描述和 `test` 测试值：

```typescript
// OpenCLI
args: [
  { name: 'limit', type: 'int', default: 20, help: 'Number of videos' },
  { name: 'keyword', type: 'str', required: true, help: 'Search keyword' }
]

// GreaseAI
"variables": [
  { "name": "limit", "type": "int", "default": 20, "help": "Number of videos", "test": 5 },
  { "name": "keyword", "type": "string", "required": true, "help": "Search keyword", "test": "AI" }
]
```

### test 字段说明

每个 variable 应包含 `test` 字段，提供测试时使用的参数值：

- **来源**: 从 OpenCLI 源文件的 `.test.ts` 测试文件中提取
- **用途**: 用于自动化测试，无需手动指定参数
- **示例**: 
  - `clis/zhihu/question.test.ts` 使用 `{ id: '2021881398772981878', limit: 3 }`
  - 则 `question.json` 的 variables 应添加 `"test": "2021881398772981878"` 和 `"test": 3`

**测试命令会自动读取 test 字段**:
```bash
# 无需手动指定参数
npm run test -- ./clis/zhihu/question.json

# test.ts 会自动使用 variables 中的 test 值构建 params
```

**提取 test 值的方法**:
1. 查找对应的 `.test.ts` 文件
2. 找到测试用例中的参数值（如 `cmd!.func!(page, { id: 'xxx', limit: 3 })`)
3. 将这些值作为 `test` 字段添加到 variables

---

## Action Types (GreaseAI)

| Action | Argument | Purpose |
|--------|----------|---------|
| `open` | `{ url, waitUntil }` | Navigate to URL |
| `evaluate` | `{ script }` | Execute JS, uses `async (intermediate) => {}` pattern |
| `click` | `{ target }` | Click element by description |
| `input` | `{ target, text, delay, withReturn }` | Type text into input |
| `extract` | `{ target, contentType }` | Extract content |
| `scroll` | `{ target }` | Scroll page or element |
| `wait` | `{ target }` or `{ time }` | Wait for condition or time |
| `goBack` | `{}` | Navigate back |
| `close` | `{}` | Close page |

### evaluate Script Pattern (greasedev/automator@7024108)

> **Dependency**: Requires [greasedev/automator@7024108](https://github.com/greasedev/automator/commit/7024108)

evaluate action uses **arrow function pattern** to receive intermediateResults:

```javascript
// Step 1: First evaluate - intermediate is empty {}
{
  "action": "evaluate",
  "argument": {
    "script": "async (intermediate) => { const keyword = \"{{ query }}\"; ... return { data, keyword }; }"
  }
}

// Step 2: Second evaluate - intermediate has previous results
{
  "action": "evaluate",
  "argument": {
    "script": "async (intermediate) => { const data = intermediate.data; ... return processedResults; }"
  }
}
```

**Key Points**:
- All evaluate scripts use `async (intermediate) => {}` format
- First evaluate receives empty `{}` intermediate
- Return value is saved to intermediateResults for next evaluate
- Use `intermediate.xxx` to reference previous evaluate's return
- `{{ xxx }}` is replaced with task params (before script execution)
- Last evaluate's return is the final output

**Multi-Step Example** (WBI signing + result processing):
```json
{
  "actions": [
    { "action": "open", "argument": { "url": "https://..." } },
    {
      "action": "evaluate",
      "argument": {
        "script": "async (intermediate) => { /* fetch API with signing */ return { results, searchType }; }"
      }
    },
    {
      "action": "evaluate",
      "argument": {
        "script": "async (intermediate) => { const results = intermediate.results; /* process */ return finalArray; }"
      }
    }
  ]
}
```

---

## Conversion Rules

### Action Type Mapping

| OpenCLI Pipeline Step | GreaseAI Action |
|----------------------|-----------------|
| `navigate` | `open` |
| `evaluate` | `evaluate` (with `script` argument) |
| `click` (in func) | `click` |
| `typeText` (in func) | `input` |
| `wait` | `wait` |
| `scroll` | `scroll` |

### Strategy to Category

| OpenCLI Strategy | GreaseAI Category |
|-----------------|-------------------|
| `PUBLIC` | `public` |
| `COOKIE` | `auth` (implicit) |
| `HEADER` | `auth` |
| `INTERCEPT` | `intercept` |
| `UI` | `ui_action` |

### Variable Template

GreaseAI uses `{{ variable }}` for template placeholders (double braces):

| OpenCLI | GreaseAI |
|---------|----------|
| `${{ args.limit }}` | `{{ limit }}` |
| `${{ args.keyword }}` | `{{ keyword }}` |
| `{username}` | `{{ username }}` |

### Intermediate Results in Non-evaluate Actions

**在 open、click、input 等非 evaluate 操作中也可以引用中间结果**，使用 `${key}` 语法：

```json
{
  "actions": [
    {
      "action": "evaluate",
      "argument": {
        "script": "async (intermediate) => { return { noteId: 'xxx', userId: 'yyy' }; }"
      }
    },
    {
      "action": "open",
      "argument": {
        "url": "https://www.xiaohongshu.com/user/profile/${userId}/${noteId}"
      }
    }
  ]
}
```

**Key Points**:
- `${key}` 在任何 action 的 argument 中都可以使用
- 引用的是前一个 evaluate 返回的对象字段
- 替换发生在 action 执行前，由 driver-layer 自动处理
- 与 `{{ xxx }}` 不同：`{{ }}` 替换 task params，`${}` 替换 intermediate results

**Example - Dynamic URL Navigation**:
```json
{
  "actions": [
    { "action": "open", "argument": { "url": "https://creator.xiaohongshu.com/statistics/data-analysis" } },
    {
      "action": "evaluate",
      "argument": {
        "script": "async (intermediate) => { const notes = await fetch('/api/notes/list').then(r => r.json()); return { firstNoteId: notes.data[0]?.id }; }"
      }
    },
    {
      "action": "open",
      "argument": {
        "url": "https://creator.xiaohongshu.com/statistics/note-detail?noteId=${firstNoteId}"
      }
    }
  ]
}
```

---

## AI-Driven Conversion Workflow

生成过程由 AI 驱动完成，按照以下步骤操作：

### Step 1: Read Source File

读取 OpenCLI 命令源文件：

```bash
# 示例：读取 36kr/hot.ts
cat clis/36kr/hot.ts
```

### Step 2: Analyze Command Structure

分析命令结构：
- `site`, `name`, `description`, `domain`
- `args` 参数定义
- `pipeline` 步骤 (navigate, evaluate, map, limit)
- `strategy` 认证策略

### Step 3: Convert to GreaseAI Format

按照转换规则生成 JSON：

1. **navigate → open action**
   ```json
   {
     "action": "open",
     "argument": { "url": "https://...", "waitUntil": "load" }
   }
   ```

2. **evaluate → evaluate action**
   - 替换 `${{ args.xxx }}` 为 `{{ xxx }}`
   - 保留 `credentials: 'include'`

3. **args → variables**
   - 提取参数定义

### Step 4: Write Output File

写入到对应目录：

```
源文件: clis/36kr/hot.ts
目标:   skills/opencli-to-grease/clis/36kr/hot.json
```

---

## Complete Conversion Example

### Input: clis/36kr/hot.ts

```typescript
cli({
  site: '36kr',
  name: 'hot',
  description: '36氪热榜',
  domain: '36kr.com',
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'url'],
  pipeline: [
    { navigate: 'https://36kr.com' },
    { evaluate: `(async () => {
      const res = await fetch('https://gateway.36kr.com/api/mis/nav/home/nav/v2', {
        credentials: 'include'
      });
      const d = await res.json();
      return (d?.data?.hotNewsList || []).map(item => ({
        title: item.title,
        url: item.url,
      }));
    })()` },
    { limit: '${{ args.limit }}' },
  ],
});
```

### Output: clis/36kr/hot.json

```json
{
  "actions": [
    {
      "action": "open",
      "argument": {
        "url": "https://36kr.com",
        "waitUntil": "load"
      }
    },
    {
      "action": "evaluate",
      "argument": {
        "script": "(async () => { const res = await fetch('https://gateway.36kr.com/api/mis/nav/home/nav/v2', { credentials: 'include' }); const d = await res.json(); return (d?.data?.hotNewsList || []).map(item => ({ title: item.title, url: item.url })); })()"
      }
    }
  ],
  "api_endpoint": "36kr-hot",
  "category": "content",
  "description": "36氪热榜",
  "is_public": false,
  "method": "GET",
  "name": "Hot",
  "variables": [
    {
      "name": "limit",
      "type": "int",
      "default": 20
    }
  ],
  "website_domain": "36kr.com",
  "website_id": "website-36kr.com"
}
```

### Step 5: Test Generated JSON (Required)

**所有 JSON 文件必须生成测试日志**，验证转换结果正确：

```bash
# 基本测试
npm run test -- ./clis/36kr/hot.json

# 带参数测试
npm run test -- ./clis/zhihu/search.json --params '{"query":"AI","limit":5}'
```

测试完成后会生成 `.test` 日志文件：
- `clis/36kr/hot.json` → `clis/36kr/hot.test`
- 日志中包含 `comparison.match` 字段，确认与 OpenCLI 结果一致

**如果测试失败**：
1. 检查 `evaluate` script 是否使用 `async (intermediate) => {}` 模式
2. 检查 `{{ xxx }}` 模板是否正确替换
3. 检查 API 是否需要 WBI 签名或其他认证
4. 调整脚本后重新测试直到 `match: true`

---

## Test Generated JSON

测试生成的 JSON 文件并对比 OpenCLI 结果（默认启用对比）：

```bash
cd skills/opencli-to-grease
npm install

# 测试单个文件（默认对比）
npm run test -- ./clis/36kr/hot.json

# 带参数测试
npm run test -- ./clis/zhihu/search.json --params '{"query":"AI","limit":5}'

# 禁用对比
npm run test -- ./clis/bilibili/hot.json --no-compare
```

### Test Script Options

```bash
npm run test -- <json-file> [options]

Options:
  --cdp <url>       CDP URL (default: http://localhost:9222)
  --params <json>   Parameters as JSON string (支持 --params='...' 或 --params '...')
  --no-compare      禁用 OpenCLI 对比 (默认启用对比)
  --site <name>     手动指定 OpenCLI 命令名 (默认从 domain 自动提取)
```

### Test Log Output

每次测试完成后，会在 JSON 文件同目录下生成 `.test` 日志文件：

```
clis/bilibili/hot.json    → clis/bilibili/hot.test
clis/zhihu/search.json    → clis/zhihu/search.test
```

日志文件格式：

```json
{
  "timestamp": "2026-04-10T13:20:45.123Z",
  "json_file": "./clis/bilibili/hot.json",
  "command": "Hot",
  "website": "www.bilibili.com",
  "params": { "limit": 20 },
  "success": true,
  "actions": [
    { "action": "open", "status": "succeeded" },
    { "action": "evaluate", "status": "succeeded" }
  ],
  "data_count": 20,
  "sample_data": [ ... ],
  "comparison": {
    "grease_count": 20,
    "opencli_count": 20,
    "match": true,
    "differences": []
  }
}
```

### Prerequisites

1. **Chrome with remote debugging**:
   ```bash
   chrome --remote-debugging-port=9222
   ```

2. **LLM API Key** (required by automator):
   ```bash
   export DOUBAO_API_KEY=your_key
   # or
   export OPENAI_API_KEY=your_key
   ```

3. **Automator package**:
   ```bash
   npm install
   ```

4. **OpenCLI** (for comparison):
   ```bash
   npm install -g @jackwener/opencli
   ```

---

## Files

| File | Description |
|------|-------------|
| `SKILL.md` | This documentation |
| `test.ts` | Test script with OpenCLI comparison |
| `package.json` | Dependencies (automator@1b2f456) |
| `tsconfig.json` | TypeScript configuration |
| `clis/` | Output directory (mirrors OpenCLI clis structure) |

### Test Requirements (Mandatory)

**转换后必须测试**：
- 每个 JSON 文件必须有对应的 `.test` 日志文件
- 测试日志必须显示 `comparison.match: true`
- 如果测试不通过，必须修复 JSON 文件

**提交前检查**：
```bash
# 确认所有 JSON 都有 .test 文件
ls clis/bilibili/*.json | wc -l
ls clis/bilibili/*.test | wc -l
# 数量应相等

# 检查测试结果
grep -l '"match": true' clis/bilibili/*.test | wc -l
# 应等于 JSON 文件数量
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No fetch URL in evaluate | Command uses UI strategy, generate click/input actions |
| Complex evaluate code | Extract fetch call, simplify script |
| Template mismatch | Replace `${{ args.xxx }}` with `{{ xxx }}` |
| Multiple API calls | Chain evaluate actions |
| networkidle timeout | Change waitUntil to `load` |
| API returns -403 | Check if API needs different auth or use simpler endpoint |
| StagehandEvalError | Convert IIFE to `async (intermediate) => {}` pattern |