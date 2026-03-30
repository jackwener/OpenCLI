# 即梦AI (Jimeng)

**Mode**: 🔐 Browser · **Domain**: `jimeng.jianying.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jimeng generate` | 即梦AI 文生图 — 输入 prompt 生成图片 |
| `opencli jimeng history` | 查看生成历史 |
| `opencli jimeng balance` | 查看积分余额与会员信息 |
| `opencli jimeng new` | 新建会话（workspace） |
| `opencli jimeng video` | 文生视频 — 提交视频生成任务 |

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

# Check credit balance (JSON output)
opencli jimeng balance -f json

# Create a new conversation/workspace
opencli jimeng new -f json

# Submit a video generation task (returns immediately with task_id)
opencli jimeng video "一只猫在花园里散步" -f json

# Submit and wait for completion (up to 300s)
opencli jimeng video "日落海边" --wait 300 -f json

# Use Seedance 2.0 Fast, 15s, 9:16 portrait
opencli jimeng video "人物走路" --model seedance_20_fast --duration 15 --ratio 9:16 -f json

# Reference image to video (全能参考)
opencli jimeng video "参考图片中的人物，让她在花园散步" --ref-image ./photo.jpg -f json
```

### Output Fields (balance)

| Field | Description |
|-------|-------------|
| `total` | 剩余积分总数（精确数字，如 13932） |
| `vip_level` | 会员等级：高级会员 / 标准会员 / 基础会员 / free |
| `vip_expire` | 会员到期时间（如 2026.04.25 14:17），仅从积分弹层中提取；无法定位时返回空 |

> **Note**: 积分分类明细（订阅/充值/赠送）仅通过 BDMS 签名 API 返回，当前 DOM 抓取方式无法获取，故不输出。

### Output Fields (new)

| Field | Description |
|-------|-------------|
| `workspace_id` | 新会话的 workspace ID |
| `workspace_url` | 新会话的完整 URL |

> **Implementation**: Tier 2 Cookie API — 调用 `/mweb/v1/workspace/create`，无需 DOM 交互。

### Output Fields (video)

| Field | Description |
|-------|-------------|
| `status` | queued / completed / timeout |
| `task_id` | 任务 ID（可用于后续查询） |
| `video_url` | 视频 URL（完成后返回，未完成为空） |
| `queue_position` | 队列位置（如 21161/179851） |

> **Implementation**: Tier 2 Cookie API — 调用 `/mweb/v1/aigc_draft/generate` 提交，`/mweb/v1/get_history_queue_info` 轮询。

### Options (video)

| Option | Description |
|--------|-------------|
| `--prompt` | 视频描述（必填） |
| `--model` | 模型: `seedance_20_fast` (默认), `seedance_20` |
| `--ratio` | 宽高比: `16:9` (默认), `9:16`, `1:1` |
| `--duration` | 时长: `4` (默认), `10`, `15` 秒 |
| `--workspace` | workspace ID (默认 0) |
| `--wait` | 轮询等待秒数 (默认 0 提交即返回) |
| `--ref-image` | 参考图片路径（全能参考模式，可选） |

### Options (generate)

| Option | Description |
|--------|-------------|
| `--prompt` | Image description prompt (required) |
| `--model` | Model: `high_aes_general_v50` (5.0 Lite), `high_aes_general_v42` (4.6), `high_aes_general_v40` (4.0) |
| `--wait` | Wait seconds for generation (default: 40) |

## Prerequisites

- Chrome running and **logged into** jimeng.jianying.com
- [Browser Bridge extension](/guide/browser-bridge) installed
