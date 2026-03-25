# jimeng

## Commands

### generate
- 用途：即梦AI 文生图 — 输入 prompt 生成图片
- 参数：
  - `prompt`（必填）：类型 string；"图片描述 prompt"
  - `model`（可选）：类型 string；默认值 "high_aes_general_v50"；"模型: high_aes_general_v50 (5.0 Lite), high_aes_general_v42 (4.6), high_aes_general_v40 (4.0)"
  - `wait`（可选）：类型 int；默认值 40；"等待生成完成的秒数"
- 用法：`opencli jimeng generate [options] -f json`

### history
- 用途：即梦AI 查看最近生成的作品
- 参数：
  - `limit`（可选）：类型 int；默认值 5
- 用法：`opencli jimeng history [options] -f json`
