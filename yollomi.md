# Yollomi

**Mode**: 🔐 Browser · **Domain**: `yollomi.com`

AI image/video generation and editing on [yollomi.com](https://yollomi.com). Uses the same `/api/ai/*` routes as the web app; authentication is your **logged-in Chrome session** (NextAuth cookies).

## Commands

| Command | Description |
|---------|-------------|
| `opencli yollomi generate` | Text-to-image / image-to-image |
| `opencli yollomi video` | Text-to-video / image-to-video |
| `opencli yollomi edit` | Qwen image edit (prompt + image) |
| `opencli yollomi upload` | Upload a local file → public URL for other commands |
| `opencli yollomi models` | List image / video / tool models and credit costs |
| `opencli yollomi remove-bg` | Remove background (free) |
| `opencli yollomi upscale` | Image upscaling |
| `opencli yollomi face-swap` | Face swap between two images |
| `opencli yollomi restore` | Photo restoration |
| `opencli yollomi try-on` | Virtual try-on |
| `opencli yollomi background` | AI background for product/object images |
| `opencli yollomi object-remover` | Remove objects (image + mask URLs) |

## Usage Examples

```bash
# List models
opencli yollomi models --type image

# Text-to-image (default model: z-image-turbo)
opencli yollomi generate "a red apple on a wooden table"

# Choose model and aspect ratio
opencli yollomi generate "sunset" --model flux-schnell --ratio 16:9

# Image-to-image: upload first, then pass URL
opencli yollomi upload ./photo.png
opencli yollomi generate "oil painting style" --model flux-2-pro --image "https://..."

# Video
opencli yollomi video "waves on a beach" --model kling-2-1

# Tools
opencli yollomi remove-bg https://example.com/image.png
opencli yollomi upscale https://example.com/image.png --scale 4
opencli yollomi edit https://example.com/in.png "make it vintage"
```

### Common options

| Option | Applies to | Description |
|--------|------------|-------------|
| `--model` | `generate`, `video` | Model id (see `yollomi models`) |
| `--ratio` | `generate`, `video` | Aspect ratio, e.g. `1:1`, `16:9` |
| `--image` | `generate`, `video` | Image URL for img2img / i2v |
| `--output` | Most | Output directory (default `./yollomi-output`) |
| `--no-download` | Several | Print URLs only, skip saving files |

## Prerequisites

- Chrome running and **logged into** [yollomi.com](https://yollomi.com) (Google OAuth)
- [Browser Bridge extension](/guide/browser-bridge) installed; daemon connects on first command

The CLI ensures the automation tab is on `yollomi.com` before calling APIs (same-origin `fetch` with session cookies).

## Notes

- **Credits**: Each model consumes account credits; insufficient credits returns HTTP 402.
- **Upload**: Local paths for tools are not accepted directly — use `yollomi upload` to get a URL, or pass an existing HTTPS image URL.
