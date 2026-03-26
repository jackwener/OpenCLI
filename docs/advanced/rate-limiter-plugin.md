# Rate Limiter Plugin

An optional plugin that adds a random sleep between browser-based commands to reduce the risk of platform rate-limiting or bot detection.

## Install

```bash
opencli plugin install github:jackwener/opencli-plugin-rate-limiter
```

Or copy the example below into `~/.opencli/plugins/rate-limiter/` to use it locally without installing from GitHub.

## What it does

After every command targeting a browser platform (xiaohongshu, weibo, bilibili, douyin, tiktok, …), the plugin sleeps for a random duration — 5–30 seconds by default — before returning control to the caller.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENCLI_RATE_MIN` | `5` | Minimum sleep in seconds |
| `OPENCLI_RATE_MAX` | `30` | Maximum sleep in seconds |
| `OPENCLI_NO_RATE` | — | Set to `1` to disable entirely (local dev) |

```bash
# Shorter delays for light scraping
OPENCLI_RATE_MIN=3 OPENCLI_RATE_MAX=10 opencli xiaohongshu search "AI眼镜"

# Skip delays when iterating locally
OPENCLI_NO_RATE=1 opencli bilibili comments BV1WtAGzYEBm
```

## Local installation (without GitHub)

1. Create the plugin directory:

   ```bash
   mkdir -p ~/.opencli/plugins/rate-limiter
   ```

2. Create `~/.opencli/plugins/rate-limiter/package.json`:

   ```json
   { "type": "module" }
   ```

3. Create `~/.opencli/plugins/rate-limiter/index.js`:

   ```js
   import { onAfterExecute } from '@jackwener/opencli/hooks'

   const BROWSER_DOMAINS = [
     'xiaohongshu', 'weibo', 'bilibili', 'douyin', 'tiktok',
     'instagram', 'twitter', 'youtube', 'zhihu', 'douban',
     'jike', 'weixin', 'xiaoyuzhou',
   ]

   onAfterExecute(async (ctx) => {
     if (process.env.OPENCLI_NO_RATE === '1') return

     const site = ctx.command?.split('/')?.[0] ?? ''
     if (!BROWSER_DOMAINS.includes(site)) return

     const min = Number(process.env.OPENCLI_RATE_MIN ?? 5)
     const max = Number(process.env.OPENCLI_RATE_MAX ?? 30)
     const ms = Math.floor(Math.random() * (max - min + 1) + min) * 1000

     process.stderr.write(`[rate-limiter] ${site}: sleeping ${(ms / 1000).toFixed(0)}s\n`)
     await new Promise(r => setTimeout(r, ms))
   })
   ```

4. Verify it loaded:

   ```bash
   OPENCLI_NO_RATE=1 opencli xiaohongshu search "test" 2>&1 | grep rate-limiter
   # → (no output — plugin loaded but rate limit skipped)

   opencli xiaohongshu search "test" 2>&1 | grep rate-limiter
   # → [rate-limiter] xiaohongshu: sleeping 12s
   ```

## Writing your own plugin

Plugins are plain JS/TS files in `~/.opencli/plugins/<name>/`. A plugin file must export a hook registration call that matches the pattern `onStartup(`, `onBeforeExecute(`, or `onAfterExecute(` — opencli's discovery engine uses this pattern to identify hook files vs. command files.

```js
// ~/.opencli/plugins/my-plugin/index.js
import { onAfterExecute } from '@jackwener/opencli/hooks'

onAfterExecute(async (ctx) => {
  // ctx.command — e.g. "bilibili/comments"
  // ctx.args    — coerced command arguments
  // ctx.error   — set if the command threw
  console.error(`[my-plugin] finished: ${ctx.command}`)
})
```

See [hooks.ts](../../src/hooks.ts) for the full `HookContext` type.
