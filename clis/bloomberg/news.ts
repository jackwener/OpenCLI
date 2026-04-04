import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import {
  extractStoryMediaLinks,
  renderStoryBody,
  validateBloombergLink,
  type BloombergStory,
} from './utils.js';

cli({
  site: 'bloomberg',
  name: 'news',
  description: 'Read a Bloomberg story/article page and return title, full content, and media links',
  domain: 'www.bloomberg.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'link', positional: true, required: true, help: 'Bloomberg story/article URL or relative Bloomberg path' },
  ],
  columns: ['title', 'summary', 'link', 'mediaLinks', 'content'],
  func: async (page, kwargs) => {
    const url = validateBloombergLink(kwargs.link);

    // Navigate and wait for the page to hydrate before extracting story data.
    await page.goto(url);
    await page.wait({ selector: 'article', timeout: 5 });

    const loadStory = async () => page.evaluate(`(() => {
      const isRobot = /Are you a robot/i.test(document.title)
        || /unusual activity/i.test(document.body.innerText)
        || /click the box below to let us know you're not a robot/i.test(document.body.innerText);

      if (isRobot) {
        return {
          errorCode: 'ROBOT_PAGE',
          title: document.title,
          preview: document.body.innerText.slice(0, 400),
        };
      }

      const raw = document.querySelector('#__NEXT_DATA__')?.textContent;
      if (!raw) {
        return {
          errorCode: 'NO_NEXT_DATA',
          title: document.title,
          preview: document.body.innerText.slice(0, 400),
        };
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return {
          errorCode: 'BAD_NEXT_DATA',
          title: document.title,
          preview: document.body.innerText.slice(0, 400),
          message: String(err),
        };
      }

      const story = parsed?.props?.pageProps?.story;
      if (!story) {
        return {
          errorCode: 'NO_STORY',
          title: document.title,
          preview: document.body.innerText.slice(0, 400),
        };
      }

      return {
        story: {
          headline: story.headline || story.seoHeadline || story.seoTitle || document.querySelector('h1')?.textContent?.trim() || document.title,
          summary: story.summary || story.socialDescription || story.seoDescription || document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          url: story.url || story.readingUrl || location.href,
          body: story.body || null,
          lede: story.lede || null,
          ledeImageUrl: story.ledeImageUrl || null,
          socialImageUrl: story.socialImageUrl || null,
          imageAttachments: story.imageAttachments || {},
          videoAttachments: story.videoAttachments || {},
        }
      };
    })()`);

    let result: any = await loadStory();

    // Retry once — Bloomberg pages sometimes hydrate slowly.
    if (result?.errorCode === 'NO_NEXT_DATA' || result?.errorCode === 'NO_STORY') {
      await page.wait(4);
      result = await loadStory();
    }

    if (result?.errorCode === 'ROBOT_PAGE') {
      throw new CliError(
        'FETCH_ERROR',
        'Bloomberg served the bot-protection page instead of article content',
        'Try again later or open the article in a regular Chrome session first, then rerun the command. This command uses your current Bloomberg access and does not bypass paywall or entitlement checks.',
      );
    }

    if (result?.errorCode) {
      throw new CliError(
        'PARSE_ERROR',
        `Bloomberg page did not expose article story data (${result.errorCode})`,
        'This command currently works on standard Bloomberg story/article pages that expose __NEXT_DATA__. Audio, video, newsletter, or other non-standard/blocked pages may not work. Access still depends on your current Bloomberg session.',
      );
    }

    const story = result?.story as BloombergStory | undefined;
    if (!story) {
      throw new CliError(
        'PARSE_ERROR',
        'Failed to extract Bloomberg story data',
        'Bloomberg may have changed the page structure.',
      );
    }

    const content = renderStoryBody(story.body);
    if (!content) {
      throw new CliError(
        'PARSE_ERROR',
        'Bloomberg article body was empty after parsing',
        'Bloomberg may have changed the story-body format, the URL may not point to a standard article page, or the page may not be accessible in your current Bloomberg session.',
      );
    }

    return [{
      title: story.headline || '',
      summary: story.summary || '',
      link: story.url || url,
      mediaLinks: extractStoryMediaLinks(story),
      content,
    }];
  },
});
