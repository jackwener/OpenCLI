import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  MIDJOURNEY_DOMAIN,
  MIDJOURNEY_IMAGINE_URL,
  isSettingsPanelVisible,
  readSiteSettings,
  toggleSettingsPanel,
} from './utils.js';

cli({
  site: 'midjourney',
  name: 'settings',
  access: 'read',
  description: 'Read the currently selected Midjourney image and video settings from the visible Create UI',
  example: 'opencli midjourney settings -f yaml',
  domain: MIDJOURNEY_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: MIDJOURNEY_IMAGINE_URL,
  args: [],
  columns: ['model', 'image_resolution', 'personalization', 'raw', 'speed', 'video_resolution', 'video_batch_size'],
  func: async (page) => {
    const wasVisible = await isSettingsPanelVisible(page);
    try {
      const settings = await readSiteSettings(page);
      return [{
        model: settings.model,
        image_resolution: settings.imageResolution,
        personalization: settings.personalization,
        raw: settings.raw,
        speed: settings.speed,
        video_resolution: settings.videoResolution,
        video_batch_size: settings.videoBatchSize,
      }];
    } finally {
      if (!wasVisible && await isSettingsPanelVisible(page)) await toggleSettingsPanel(page);
    }
  },
});
