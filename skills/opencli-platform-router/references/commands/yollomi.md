# yollomi

## Commands

### background
- 用途：Generate AI background for a product/object image (5 credits)
- 参数：
  - `image`（必填）：Image URL (upload via
  - `prompt`（可选）：默认值 ''；Background description (optional)
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi background [options] -f json`

### edit
- 用途：Edit images with AI text prompts (Qwen image edit)
- 参数：
  - `image`（必填）：Input image URL (upload via
  - `prompt`（必填）：Editing instruction (e.g.
  - `model`（可选）：默认值 'qwen-image-edit'；Edit model
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi edit [options] -f json`

### face-swap
- 用途：Swap faces between two photos (3 credits)
- 参数：
  - `source`（必填）：Source face image URL
  - `target`（必填）：Target photo URL
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi face-swap [options] -f json`

### generate
- 用途：Generate images with AI (text-to-image or image-to-image)
- 参数：
  - `prompt`（必填）：Text prompt describing the image
  - `model`（可选）：默认值 'z-image-turbo'；Model ID (z-image-turbo, flux-schnell, nano-banana, flux-2-pro, ...)
  - `ratio`（可选）：默认值 '1:1'；Aspect ratio
  - `image`（可选）：Input image URL for image-to-image (upload via
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URLs, skip download
- 用法：`opencli yollomi generate [options] -f json`

### models
- 用途：List available Yollomi AI models (image, video, tools)
- 参数：
  - `type`（可选）：默认值 'all'；Filter by model type
- 用法：`opencli yollomi models [options] -f json`

### object-remover
- 用途：Remove unwanted objects from images (3 credits)
- 参数：
  - `image`（必填）：Image URL
  - `mask`（必填）：Mask image URL (white = area to remove)
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi object-remover [options] -f json`

### remove-bg
- 用途：Remove image background with AI (free)
- 参数：
  - `image`（必填）：Image URL to remove background from
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi remove-bg [options] -f json`

### restore
- 用途：Restore old or damaged photos with AI (4 credits)
- 参数：
  - `image`（必填）：Image URL to restore
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi restore [options] -f json`

### try-on
- 用途：Virtual try-on — see how clothes look on a person (3 credits)
- 参数：
  - `person`（必填）：Person photo URL (upload via
  - `cloth`（必填）：Clothing image URL
  - `cloth-type`（可选）：默认值 'upper'；Clothing type
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi try-on [options] -f json`

### upload
- 用途：Upload an image or video to Yollomi (returns URL for other commands)
- 参数：
  - `file`（必填）：Local file path to upload
- 用法：`opencli yollomi upload [options] -f json`

### upscale
- 用途：Upscale image resolution with AI (1 credit)
- 参数：
  - `image`（必填）：Image URL to upscale
  - `scale`（可选）：默认值 '2'；Upscale factor (2 or 4)
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL
- 用法：`opencli yollomi upscale [options] -f json`

### video
- 用途：Generate videos with AI (text-to-video or image-to-video)
- 参数：
  - `prompt`（必填）：Text prompt describing the video
  - `model`（可选）：默认值 'kling-2-1'；Model (kling-2-1, openai-sora-2, google-veo-3-1, wan-2-5-t2v, ...)
  - `image`（可选）：Input image URL for image-to-video
  - `ratio`（可选）：默认值 '16:9'；Aspect ratio
  - `output`（可选）：默认值 './yollomi-output'；Output directory
  - `no-download`（可选）：类型 boolean；默认值 false；Only show URL, skip download
- 用法：`opencli yollomi video [options] -f json`
