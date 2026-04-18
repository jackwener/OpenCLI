import { describe, expect, it } from 'vitest';
import { getTopicText, toTopicRow } from './utils.js';

describe('zsxq utils', () => {
    it('keeps title and content separate when both fields exist', () => {
        const topic = {
            topic_id: '123',
            title: 'A full title that should not be truncated',
            talk: { text: 'This is the full body text.' },
        };

        expect(getTopicText(topic)).toBe('A full title that should not be truncated');
        expect(toTopicRow(topic)).toMatchObject({
            title: 'A full title that should not be truncated',
            content: 'This is the full body text.',
        });
    });

    it('falls back to body text for title when explicit title is absent', () => {
        const topic = {
            topic_id: '456',
            talk: { text: 'Body-only topic text should still appear as the title preview.' },
        };

        expect(getTopicText(topic)).toBe('Body-only topic text should still appear as the title preview.');
        expect(toTopicRow(topic)).toMatchObject({
            title: 'Body-only topic text should still appear as the title preview.',
            content: 'Body-only topic text should still appear as the title preview.',
        });
    });
});
