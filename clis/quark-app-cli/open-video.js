// cli( registration marker for OpenCLI filesystem discovery
import { makeUiCommand, openQuarkVideo } from './utils.js';

makeUiCommand({
  name: 'open-video',
  aliases: ['play-video'],
  description: 'Open a Quark video player by visible name or fid',
  access: 'write',
  args: [
    { name: 'input', positional: true, required: true, help: 'Video file name or fid' },
    { name: 'tab', required: false, default: '', choices: ['video', 'summary', 'transcript', 'courseware', '视频', 'AI总结', '文稿', 'AI课件'], help: 'Open player with a target tab' },
  ],
  columns: ['Status', 'Name', 'Fid', 'Source', 'TargetTab', 'Result'],
  func: async (page, kwargs) => [await openQuarkVideo(page, kwargs.input, kwargs.tab)],
});
