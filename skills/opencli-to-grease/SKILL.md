---
name: opencli-to-grease
description: Convert OpenCLI commands to GreaseAI-compatible JSON format. Use when you need to export OpenCLI adapters as browser automation workflows for GreaseAI platform.
user-invocable: true
---

# OpenCLI to GreaseAI Converter

Converts OpenCLI CLI commands to GreaseAI-compatible JSON format for browser automation workflows.

> **Dependency**: Requires [greasedev/automator@1b2f456](https://github.com/greasedev/automator/commit/1b2f456) which adds `driver-layer` export.

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
      "argument": { "script": "(async () => { ... })()" }
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

从 OpenCLI `args` 字段生成，包含 `help` 描述：

```typescript
// OpenCLI
args: [
  { name: 'limit', type: 'int', default: 20, help: 'Number of videos' },
  { name: 'keyword', type: 'str', required: true, help: 'Search keyword' }
]

// GreaseAI
"variables": [
  { "name": "limit", "type": "int", "default": 20, "help": "Number of videos" },
  { "name": "keyword", "type": "string", "required": true, "help": "Search keyword" }
]
```

---

## Action Types (GreaseAI)

| Action | Argument | Purpose |
|--------|----------|---------|
| `open` | `{ url, waitUntil }` | Navigate to URL |
| `evaluate` | `{ script }` | Execute JS, supports `{{ param }}` templates |
| `click` | `{ target }` | Click element by description |
| `input` | `{ target, text, delay, withReturn }` | Type text into input |
| `extract` | `{ target, contentType }` | Extract content |
| `scroll` | `{ target }` | Scroll page or element |
| `wait` | `{ target }` or `{ time }` | Wait for condition or time |
| `goBack` | `{}` | Navigate back |
| `close` | `{}` | Close page |

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

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No fetch URL in evaluate | Command uses UI strategy, generate click/input actions |
| Complex evaluate code | Extract fetch call, simplify script |
| Template mismatch | Replace `${{ args.xxx }}` with `{{ xxx }}` |
| Multiple API calls | Chain evaluate actions |