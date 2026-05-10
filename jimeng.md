# 即梦AI (Jimeng)

**Mode**: 🔐 Browser · **Domain**: `jimeng.jianying.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jimeng generate` | 即梦AI 文生图 — 输入 prompt 生成图片 |
| `opencli jimeng history` | 查看生成历史 |

## Usage Examples

```bash
# Generate an image
opencli jimeng generate --prompt "一只在星空下的猫"

# Use a specific model
opencli jimeng generate --prompt "cyberpunk city" --model high_aes_general_v50

# Set custom wait timeout
opencli jimeng generate --prompt "sunset landscape" --wait 60

# View generation history
opencli jimeng history --limit 10
```

### Options (generate)

| Option | Description |
|--------|-------------|
| `--prompt` | Image description prompt (required) |
| `--model` | Model: `high_aes_general_v50` (5.0 Lite), `high_aes_general_v42` (4.6), `high_aes_general_v40` (4.0) |
| `--wait` | Wait seconds for generation (default: 40) |

## Prerequisites

- Chrome running and **logged into** jimeng.jianying.com
- [Browser Bridge extension](/guide/browser-bridge) installed
