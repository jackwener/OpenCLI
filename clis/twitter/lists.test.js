import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { isEmptyListsState, parseListCards } from './lists-parser.js';
import './lists.js';

describe('twitter lists parser', () => {
    it('parses english list cards without relying on page locale', () => {
        const result = parseListCards([
            {
                href: '/i/lists/123',
                text: `AI Researchers
@jack
124 Members 3.4K Followers
Private`,
            },
        ]);
        expect(result).toEqual([
            {
                name: 'AI Researchers',
                members: '124',
                followers: '3.4K',
                mode: 'private',
            },
        ]);
    });

    it('parses chinese list cards without scanning document.body.innerText', () => {
        const result = parseListCards([
            {
                href: '/i/lists/456',
                text: `AI观察
@jack
321 位成员 8.8K 位关注者
锁定列表`,
            },
        ]);
        expect(result).toEqual([
            {
                name: 'AI观察',
                members: '321',
                followers: '8.8K',
                mode: 'private',
            },
        ]);
    });

    it('detects empty state text in english and chinese', () => {
        expect(isEmptyListsState(`@jack hasn't created any Lists yet`)).toBe(true);
        expect(isEmptyListsState('这个账号还没有创建任何列表')).toBe(true);
        expect(isEmptyListsState('AI Researchers 124 Members')).toBe(false);
    });
});

describe('twitter lists command', () => {
    it('reads visible list cells from the overview page and parses each detail page', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1617772739917647876',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
        ]);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/elonmusk/lists');
    });

    it('prefers focused detail text over full page chrome when parsing a list detail page', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1617772739917647876',
                primaryText: `Monkeys
@elonmusk
See new posts
Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                text: `To view keyboard shortcuts, press question mark
View keyboard shortcuts
Home
Explore
Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result[0]).toMatchObject({
            name: 'Monkeys',
            members: '0',
            followers: '51.8K',
            mode: 'public',
        });
    });

    it('falls back to body text when primary text exists but has not loaded the metrics yet', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1617772739917647876',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `To view keyboard shortcuts, press question mark
Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result[0]).toMatchObject({
            name: 'Monkeys',
            members: '0',
            followers: '51.8K',
            mode: 'public',
        });
    });

    it('ignores leading primary-column chrome when body text has the missing follower metric', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1617772739917647876',
                primaryText: `To view keyboard shortcuts, press question mark
Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `To view keyboard shortcuts, press question mark
Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result[0]).toMatchObject({
            name: 'Monkeys',
            members: '0',
            followers: '51.8K',
            mode: 'public',
        });
    });

    it('fails instead of parsing overview text when click does not reach a list detail page', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/elonmusk/lists',
                primaryText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
                text: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        await expect(command.func(page, { user: 'elonmusk', limit: 1 }))
            .rejects
            .toThrow('Twitter list detail');
    });

    it('fails when click lands on a non-canonical list subroute instead of the detail page', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
51.8K followers including @HTX_Global`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1617772739917647876/members',
                primaryText: `Members
Monkeys
Elon Musk
@elonmusk`,
                text: `Members
Monkeys
Elon Musk
@elonmusk`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        await expect(command.func(page, { user: 'elonmusk', limit: 1 }))
            .rejects
            .toThrow('Twitter list detail');
    });

    it('revisits the overview page to open the second visible list cell', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/2',
                text: `Robots
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Robots',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/elonmusk/lists');
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://x.com/elonmusk/lists');
    });

    it('uses newly hydrated overview cells on revisit instead of freezing the initial list count', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/2',
                text: `Robots
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Robots',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('uses the current overview ordering on revisit instead of reopening a duplicate list', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: ['Monkeys\n51.8K followers including @HTX_Global'],
                        pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        'Robots\n7.2K followers including @HTX_Global',
                        'Monkeys\n51.8K followers including @HTX_Global',
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Robots
Monkeys`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview === 2 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/2',
                        text: `Robots
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/1',
                    text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Robots',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('distinguishes lists with the same visible preview text by cell signature', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: [{ preview: 'Same Preview', signature: 'list-a' }],
                        pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        { preview: 'Same Preview', signature: 'list-a' },
                        { preview: 'Same Preview', signature: 'list-b' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview === 2 && lastClickedIndex === 1) {
                    return {
                        href: 'https://x.com/i/lists/2',
                        text: `Beta List
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/1',
                    text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Alpha List',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Beta List',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('does not stop early when two different lists collide on the same derived signature', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: [{ preview: 'Same Preview', signature: 'same-sig' }],
                        pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        { preview: 'Same Preview', signature: 'same-sig' },
                        { preview: 'Same Preview', signature: 'same-sig' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview >= 2 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/2',
                    text: `Beta List
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Alpha List',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Beta List',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('continues scanning when a different overview cell resolves to an already-seen detail href', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: [{ preview: 'Alpha Preview', signature: 'list-a-first' }],
                        pageText: `Lists
@elonmusk
Your Lists
Alpha Preview`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        { preview: 'Alpha Preview', signature: 'list-a-second' },
                        { preview: 'Beta Preview', signature: 'list-b' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Alpha Preview
Beta Preview`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview >= 2 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/2',
                    text: `Beta List
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Alpha List',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Beta List',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('suppresses duplicates when the same canonical list detail is revisited with different query strings', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: [{ preview: 'Alpha Preview', signature: 'list-a-first' }],
                        pageText: `Lists
@elonmusk
Your Lists
Alpha Preview`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        { preview: 'Alpha Preview', signature: 'list-a-second' },
                        { preview: 'Beta Preview', signature: 'list-b' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Alpha Preview
Beta Preview`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1?foo=1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview >= 2 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1?foo=2',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/2',
                    text: `Beta List
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Alpha List',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Beta List',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('retries from the refreshed index set when duplicate href recovery sees signature churn', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let activeOverview = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                activeOverview = overviewReads;
                if (overviewReads === 1) {
                    return {
                        listCount: 1,
                        cells: [{ preview: 'Same Preview', signature: 'sig-a-0' }],
                        pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                    };
                }
                if (overviewReads === 2) {
                    return {
                        listCount: 2,
                        cells: [
                            { preview: 'Same Preview', signature: 'sig-a-1' },
                            { preview: 'Same Preview', signature: 'sig-b-1' },
                        ],
                        pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                    };
                }
                return {
                    listCount: 2,
                    cells: [
                        { preview: 'Same Preview', signature: 'sig-b-2' },
                        { preview: 'Same Preview', signature: 'sig-a-2' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Same Preview`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (activeOverview === 1 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview === 2 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/1',
                        text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                    };
                }
                if (activeOverview === 3 && lastClickedIndex === 0) {
                    return {
                        href: 'https://x.com/i/lists/2',
                        text: `Beta List
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
                    };
                }
                return {
                    href: 'https://x.com/i/lists/1',
                    text: `Alpha List
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Alpha List',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Beta List',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('keeps DOM indices aligned when early list cells are still empty placeholders', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                return {
                    listCount: 2,
                    cells: [
                        { preview: '', signature: 'placeholder-0' },
                        { preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' },
                    ],
                    pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (lastClickedIndex !== 1) {
                    return {
                        href: 'https://x.com/elonmusk/lists',
                        text: '',
                    };
                }
                return {
                    href: 'https://x.com/i/lists/1',
                    text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
        ]);
        expect(lastClickedIndex).toBe(1);
    });

    it('fails instead of silently truncating results when a later overview revisit never recovers', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 0,
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 0,
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 0,
                pageText: `Lists
@elonmusk
See new posts`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        await expect(command.func(page, { user: 'elonmusk', limit: 2 }))
            .rejects
            .toThrow('Twitter lists');
    });

    it('fails instead of silently truncating when known list slots rerender as blank placeholders', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 2,
                cells: [
                    { preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' },
                    { preview: '', signature: 'placeholder-1' },
                ],
                pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                cells: [
                    { preview: '', signature: 'placeholder-0' },
                    { preview: '', signature: 'placeholder-1' },
                ],
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                cells: [
                    { preview: '', signature: 'placeholder-0' },
                    { preview: '', signature: 'placeholder-1' },
                ],
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                cells: [
                    { preview: '', signature: 'placeholder-0' },
                    { preview: '', signature: 'placeholder-1' },
                ],
                pageText: `Lists
@elonmusk
See new posts`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        await expect(command.func(page, { user: 'elonmusk', limit: 2 }))
            .rejects
            .toThrow('Twitter lists');
    });

    it('rechecks the overview page when list cells appear after initial page chrome', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 0,
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
        ]);
        expect(page.wait).toHaveBeenCalledWith(1);
    });

    it('does not treat all-placeholder overview cells as ready data', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        let overviewReads = 0;
        let lastClickedIndex = -1;

        const evaluate = vi.fn(async (code) => {
            if (code.includes("cells: Array.from(document.querySelectorAll('[data-testid=\"listCell\"]'))")) {
                overviewReads += 1;
                if (overviewReads < 3) {
                    return {
                        listCount: 1,
                        cells: [{ preview: '', signature: 'placeholder-0' }],
                        pageText: `Lists
@elonmusk
See new posts`,
                    };
                }
                return {
                    listCount: 1,
                    cells: [{ preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' }],
                    pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
                };
            }

            if (code.includes('const cell = cells[')) {
                const match = code.match(/const cell = cells\[(\d+)\]/);
                lastClickedIndex = match ? Number(match[1]) : -1;
                return true;
            }

            if (code.includes('primaryText:')) {
                if (overviewReads < 3 || lastClickedIndex !== 0) {
                    return {
                        href: 'https://x.com/elonmusk/lists',
                        text: '',
                    };
                }
                return {
                    href: 'https://x.com/i/lists/1',
                    text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                };
            }

            throw new Error(`Unexpected evaluate call: ${code.slice(0, 80)}`);
        });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
        ]);
        expect(page.wait).toHaveBeenCalledWith(1);
    });

    it('stops cleanly when only blank placeholder cells remain after harvesting all ready lists', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 3,
                cells: [
                    { preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' },
                    { preview: 'Robots\n7.2K followers including @HTX_Global', signature: 'list-b' },
                    { preview: '', signature: 'placeholder-2' },
                ],
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 3,
                cells: [
                    { preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' },
                    { preview: 'Robots\n7.2K followers including @HTX_Global', signature: 'list-b' },
                    { preview: '', signature: 'placeholder-2' },
                ],
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/2',
                text: `Robots
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 3,
                cells: [
                    { preview: 'Monkeys\n51.8K followers including @HTX_Global', signature: 'list-a' },
                    { preview: 'Robots\n7.2K followers including @HTX_Global', signature: 'list-b' },
                    { preview: '', signature: 'placeholder-2' },
                ],
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 3 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Robots',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
    });

    it('rechecks the detail page when metrics have not rendered yet', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `Monkeys
Elon Musk
@elonmusk
0 Members`,
            })
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 1 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
        ]);
        expect(page.wait).toHaveBeenCalledWith(1);
    });

    it('fails when the canonical detail page never loads its list metrics', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 1,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `Monkeys
Elon Musk
@elonmusk
0 Members`,
            })
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `Monkeys
Elon Musk
@elonmusk
0 Members`,
            })
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                primaryText: `Monkeys
Elon Musk
@elonmusk
0 Members`,
                text: `Monkeys
Elon Musk
@elonmusk
0 Members`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        await expect(command.func(page, { user: 'elonmusk', limit: 1 }))
            .rejects
            .toThrow('Twitter list detail');
    });

    it('rechecks the overview page again before opening the second list after revisit', async () => {
        const command = getRegistry().get('twitter/lists');
        expect(command?.func).toBeTypeOf('function');

        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/1',
                text: `Monkeys
Elon Musk
@elonmusk
0 Members
51.8K Followers`,
            })
            .mockResolvedValueOnce({
                listCount: 0,
                pageText: `Lists
@elonmusk
See new posts`,
            })
            .mockResolvedValueOnce({
                listCount: 2,
                pageText: `Lists
@elonmusk
Your Lists
Monkeys
Robots`,
            })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({
                href: 'https://x.com/i/lists/2',
                text: `Robots
Elon Musk
@elonmusk
12 Members
7.2K Followers`,
            });

        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };

        const result = await command.func(page, { user: 'elonmusk', limit: 2 });

        expect(result).toEqual([
            {
                name: 'Monkeys',
                members: '0',
                followers: '51.8K',
                mode: 'public',
            },
            {
                name: 'Robots',
                members: '12',
                followers: '7.2K',
                mode: 'public',
            },
        ]);
        expect(evaluate).toHaveBeenCalledTimes(7);
        expect(page.wait).toHaveBeenCalledWith(1);
    });
});
