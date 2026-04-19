# ComfyUI

**Mode**: 🌐 Public · **Domain**: ComfyUI server (local or remote)

Manage [ComfyUI](https://github.com/comfyanonymous/ComfyUI) servers from the command line — list nodes, explore models, run workflows, and monitor queue status.

## Commands

| Command | Description |
|---------|-------------|
| `opencli comfyui nodes` | List all registered node types |
| `opencli comfyui node-info <name>` | Detailed definition of a node |
| `opencli comfyui search-node <query>` | Search nodes by keyword |
| `opencli comfyui models` | List available model files |
| `opencli comfyui models --model_type <type>` | List models of a specific type |
| `opencli comfyui system-stats` | Server status and system information |
| `opencli comfyui run <json\|file>` | Execute a workflow |
| `opencli comfyui queue` | View running/pending queue |
| `opencli comfyui history` | View execution history |

## Usage Examples

```bash
# Check server status
opencli comfyui system-stats

# List first 10 node types
opencli comfyui nodes --limit 10

# Search for nodes related to "sampler"
opencli comfyui search-node sampler --limit 5

# View detailed input fields for KSampler
opencli comfyui node-info KSampler

# List all model types with counts
opencli comfyui models

# List LoRA models
opencli comfyui models --model_type loras

# Run a workflow from JSON
opencli comfyui run '{"4":{"class_type":"EmptyLatentImage","inputs":{"width":512,"height":512,"batch_size":1}}}'

# Watch the queue
opencli comfyui queue

# View last 5 execution history entries
opencli comfyui history --limit 5
```

## Configuration

Set the `COMFYUI_HOST` environment variable to point to your ComfyUI server:

```bash
export COMFYUI_HOST=http://127.0.0.1:8188
```

Default is `http://127.0.0.1:8188`. For remote servers on your local network:

```bash
export COMFYUI_HOST=http://192.168.1.100:8008
```

## Prerequisites

- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server
- No browser required — uses ComfyUI REST API directly
