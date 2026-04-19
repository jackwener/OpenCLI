# opencli-comfyui

[ComfyUI](https://github.com/comfyanonymous/ComfyUI) plugin for [OpenCLI](https://github.com/jackwener/opencli). Manage your ComfyUI server from the command line — list nodes, explore models, run workflows, and monitor queue status.

## Features

| Command | Description |
|---------|-------------|
| `comfyui nodes` | List all registered node types (700+) |
| `comfyui node-info <name>` | Detailed definition of a node (inputs, types, defaults, constraints) |
| `comfyui search-node <query>` | Search nodes by name or field |
| `comfyui models [--model_type <type>]` | List available model files |
| `comfyui system-stats` | Server status and system information |
| `comfyui run <json\|file>` | Execute a workflow |
| `comfyui queue` | Queue status (running / pending) |
| `comfyui history [--limit N]` | Execution history |

## Installation

```bash
# Install the plugin
cd opencli-comfyui
npm link

# Or symlink manually
opencli plugin install <path-to-this-directory>
```

## Configuration

Set your ComfyUI server address:

```bash
export COMFYUI_HOST=http://127.0.0.1:8188
```

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFYUI_HOST` | `http://127.0.0.1:8188` | ComfyUI server URL |

## Usage Examples

```bash
# Check server status
opencli comfyui system-stats

# List all nodes
opencli comfyui nodes --limit 20

# Search for a node
opencli comfyui search-node sampler

# View node details
opencli comfyui node-info KSampler

# List models
opencli comfyui models
opencli comfyui models --model_type loras

# Run a workflow from JSON
opencli comfyui run '{"4":{"class_type":"EmptyLatentImage","inputs":{"width":512,"height":512,"batch_size":1}}}'

# Run a workflow from file
opencli comfyui run my-workflow.json

# Check queue
opencli comfyui queue

# View history
opencli comfyui history --limit 5
opencli comfyui history --prompt_id <id>
```

## ComfyUI API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/object_info` | GET | List all node definitions |
| `/api/models` | GET | List model directories |
| `/api/models/<type>` | GET | List models of a type |
| `/api/system_stats` | GET | Server information |
| `/prompt` | POST | Queue a workflow for execution |
| `/api/queue` | GET | Queue status |
| `/api/history` | GET | Execution history |

## Requirements

- [OpenCLI](https://github.com/jackwener/opencli) >= 1.6.0
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server
- Node.js 18+

## License

MIT
