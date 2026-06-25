// cli( registration marker for OpenCLI filesystem discovery
import { clickVideoTab, makeUiCommand } from './utils.js';

makeUiCommand({
  name: 'tab',
  aliases: ['open-tab'],
  description: 'Open a Quark video panel tab via native bridge: video, summary, transcript, or courseware',
  access: 'write',
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      choices: ['video', 'summary', 'transcript', 'courseware', '视频', 'AI总结', '文稿', 'AI课件'],
      help: 'Target tab name',
    },
  ],
  columns: ['Status', 'Tab', 'Label', 'Target', 'Position'],
  func: async (page, kwargs) => [await clickVideoTab(page, kwargs.name)],
});
