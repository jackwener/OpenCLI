// cli( registration marker for OpenCLI filesystem discovery
import { getWindowInfo, findTabCandidates, makeUiCommand } from './utils.js';

makeUiCommand({
  name: 'status',
  description: 'Check active CDP connection to QuarkCloudDrive and list visible video tabs',
  columns: ['Status', 'Url', 'Title', 'Ready', 'Tabs'],
  func: async (page) => {
    const info = await getWindowInfo(page);
    const tabs = await findTabCandidates(page);
    return [{
      Status: 'Connected',
      Url: info.url,
      Title: info.title,
      Ready: info.readyState,
      Tabs: tabs.map((tab) => tab.label).join(', '),
    }];
  },
});
