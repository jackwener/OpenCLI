# quark-app-cli

夸克网盘桌面端视频 AI 导出适配器。

## 目标

不用鼠标事件，默认也不打开视频播放器页面；复用夸克桌面端/浏览器登录态和夸克接口，导出和手动点“导出”一致的网盘文件：

- `<视频名>_AI总结.docx`
- `<视频名>_文稿.docx`
- `<视频名>_课件.doc`

成功标准不是“AI 任务完成”，也不是“本机生成文件”，而是目标夸克网盘目录里真实出现这些文件。最终验收用：

```bash
opencli quark ls '<网盘文件夹路径>' --depth 0 -f json
```

## 命令

单个视频导出：

```bash
opencli quark-app-cli export-cloud <video-fid> --pdirFid <folder-fid> --title '<video-name>.mp4' -f json
```

批处理流水线：

```bash
opencli quark-app-cli scan-tree '<网盘根目录>' --depth 5 -f json
opencli quark-app-cli export-tree '<网盘根目录>' --depth 5 --mode missing -f json
```

任务清单、扫描快照和报告固定写到当前项目目录：

```text
./data/jobs/
./data/scans/
./data/reports/
```

辅助命令：

```bash
opencli quark-app-cli launch
opencli quark-app-cli status
opencli quark-app-cli open-video <video-fid> --tab summary
opencli quark-app-cli tab <video|summary|transcript|courseware>
opencli quark-app-cli api-context [video-fid]
opencli quark-app-cli ai-record <video-fid> -f json
```

## API-only 模式

`export-cloud` 和 `export-tree` 默认 `--openTabs false`，不会调用 `sys.openVideoPlayer`，不会打开视频页或 AI 面板。当前导出链路直接使用：

1. 当前登录态；
2. `noteUrl`；
3. AI record；
4. subtitle task；
5. manuscript/courseware/subtitle export 接口；
6. 目标文件夹列表接口做最终验收。

如果夸克客户端升级导致 API 上下文不可用，先运行：

```bash
opencli quark-app-cli api-context <video-fid> -f json
```

只有排障或重新初始化客户端上下文时，才显式加：

```bash
--openTabs true
```

批处理建议继续使用任务清单：

```bash
opencli quark-app-cli scan-tree '<网盘根目录>' --depth 5 --job xxx.json -f json
opencli quark-app-cli export-tree '<网盘根目录>' --job xxx.json --refresh false --mode missing -f json
opencli quark-app-cli scan-tree '<网盘根目录>' --depth 5 --job xxx.json -f json
```

`export-tree` 默认 `--checkExisting false`，避免每个视频都查一次目录；是否缺文件以 `scan-tree` 的网盘列表验收为准。

单视频命令如果显式使用 `--checkExisting true`，但当前上下文无法读取目标目录，会直接失败，不会继续导出，避免重复文件。

## 扩展方案

后面如果要增加新的夸克 AI 产物，统一按 `export-cloud.js` 的模式扩展：

1. 确保或发起后端生成任务。
2. 只轮询到拿到可导出内容为止。
3. 调用夸克自己的云端导出接口，明确传入 `pdir_fid` 和规范文件名 `file_name`。
4. 用夸克网盘目录列表验收，不用本机文件、不用页面文字作为最终结果。

兼容模式下的视频打开和面板切换走原生 bridge：`sys.openVideoPlayer`。不要加入 `MouseEvent`、`PointerEvent`、DOM `.click()` 或 AppleScript UI 点击。
