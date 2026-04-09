import { getRegistry } from '@jackwener/opencli/registry';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { __test__ } from './topic-content.js';

describe('linux-do topic-content', () => {
  it('prefers raw markdown when the topic payload includes it', () => {
    const result = __test__.extractTopicContent({
      title: 'Hello Linux.do',
      post_stream: {
        posts: [
          {
            post_number: 1,
            username: 'neo',
            raw: '## Heading\n\n- one\n- two',
            cooked: '<h2>Heading</h2><ul><li>one</li><li>two</li></ul>',
            like_count: 7,
            created_at: '2025-04-05T10:00:00.000Z',
          },
        ],
      },
    }, 1234);

    expect(result.content).toContain('---');
    expect(result.content).toContain('title: Hello Linux.do');
    expect(result.content).toContain('author: neo');
    expect(result.content).toContain('likes: 7');
    expect(result.content).toContain('url: https://linux.do/t/1234');
    expect(result.content).toContain('## Heading');
    expect(result.content).toContain('- one');
  });

  it('falls back to cooked html and converts it to markdown', () => {
    const result = __test__.extractTopicContent({
      title: 'Converted Topic',
      post_stream: {
        posts: [
          {
            post_number: 1,
            username: 'trinity',
            cooked: '<p>Hello <strong>world</strong></p><blockquote><p>quoted</p></blockquote>',
            like_count: 3,
            created_at: '2025-04-05T10:00:00.000Z',
          },
        ],
      },
    }, 42);

    expect(result.content).toContain('Hello **world**');
    expect(result.content).toContain('> quoted');
  });

  it('registers topic-content with plain default output for markdown body rendering', () => {
    const command = getRegistry().get('linux-do/topic-content');

    expect(command?.defaultFormat).toBe('plain');
    expect(command?.columns).toEqual(['content']);
  });

  it('keeps topic adapter as a summarized first-page reader after the split', () => {
    const topicTs = fs.readFileSync(new URL('./topic.ts', import.meta.url), 'utf8');

    expect(topicTs).not.toContain('main_only');
    expect(topicTs).toContain('slice(0, 200)');
    expect(topicTs).toContain('帖子首页摘要和回复');
  });
});
