import { afterEach, describe, expect, it } from 'vitest';
import { __test__ } from './feed.js';

describe('linux-do feed metadata resolution', () => {
  afterEach(() => {
    __test__.resetMetadataCaches();
  });

  it('prefers live tag metadata over the bundled snapshot', async () => {
    __test__.setLiveMetadataForTests({
      tags: [{ id: 9999, slug: 'fresh-tag', name: 'Fresh Tag' }],
    });

    const request = await __test__.resolveFeedRequest(null, {
      tag: 'Fresh Tag',
      view: 'latest',
      limit: 20,
    });

    expect(request.url).toBe('/tag/fresh-tag/9999.json?per_page=20');
  });

  it('uses live category metadata with parent paths for subcategories', async () => {
    __test__.setLiveMetadataForTests({
      categories: [
        {
          id: 10,
          name: 'Parent',
          description: '',
          slug: 'parent',
          parentCategoryId: null,
          parent: null,
        },
        {
          id: 11,
          name: 'Fresh Child',
          description: '',
          slug: 'fresh-child',
          parentCategoryId: 10,
          parent: {
            id: 10,
            name: 'Parent',
            description: '',
            slug: 'parent',
            parentCategoryId: null,
          },
        },
      ],
    });

    const request = await __test__.resolveFeedRequest(null, {
      category: 'Fresh Child',
      view: 'hot',
      limit: 20,
    });

    expect(request.url).toBe('/c/parent/fresh-child/11/l/hot.json?per_page=20');
  });

  it('accepts parent/name category paths for subcategories', async () => {
    __test__.setLiveMetadataForTests({
      categories: [
        {
          id: 10,
          name: 'Parent',
          description: '',
          slug: 'parent',
          parentCategoryId: null,
          parent: null,
        },
        {
          id: 11,
          name: 'Fresh Child',
          description: '',
          slug: 'fresh-child',
          parentCategoryId: 10,
          parent: {
            id: 10,
            name: 'Parent',
            description: '',
            slug: 'parent',
            parentCategoryId: null,
          },
        },
      ],
    });

    const request = await __test__.resolveFeedRequest(null, {
      category: 'Parent / Fresh Child',
      view: 'latest',
      limit: 20,
    });

    expect(request.url).toBe('/c/parent/fresh-child/11.json?per_page=20');
  });

  it('falls back to the bundled snapshot when live metadata is unavailable', async () => {
    const request = await __test__.resolveFeedRequest(null, {
      tag: 'ChatGPT',
      category: '开发调优',
      view: 'top',
      period: 'monthly',
      limit: 20,
    });

    expect(request.url).toContain('/tags/c/develop/4/chatgpt/3/l/top.json');
    expect(request.url).toContain('per_page=20');
    expect(request.url).toContain('period=monthly');
  });
});
