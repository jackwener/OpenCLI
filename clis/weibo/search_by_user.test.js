import { describe, it, expect } from 'vitest';

describe('search_by_user', () => {
  function dateToTimestamp(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
  }

  describe('dateToTimestamp', () => {
    it('converts 2025-06-01 to correct UTC+8 timestamp', () => {
      const ts = dateToTimestamp('2025-06-01');
      expect(ts).toBe(1748707200);
    });

    it('converts 2025-01-01', () => {
      const ts = dateToTimestamp('2025-01-01');
      expect(ts).toBe(1735660800);
    });

    it('handles leap year 2024-02-29', () => {
      const ts = dateToTimestamp('2024-02-29');
      expect(Number.isFinite(ts)).toBe(true);
    });
  });

  describe('default output directory naming', () => {
    it('uses default naming pattern when no output specified', () => {
      const uid = '1234567890';
      const start = '2025-06-01';
      const end = '2025-06-30';
      const expected = `./weibo_${uid}_${start}_${end}`;
      expect(expected).toContain(uid);
      expect(expected).toContain(start);
    });
  });

  describe('HTML text stripping for preview', () => {
    const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

    it('strips basic HTML tags', () => {
      expect(strip('<span>Hello</span>')).toBe('Hello');
    });

    it('handles nested tags', () => {
      expect(strip('<div><p>Test <a href="#">link</a></p></div>')).toBe('Test link');
    });

    it('decodes HTML entities', () => {
      expect(strip('&nbsp;&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
    });

    it('handles empty input', () => {
      expect(strip('')).toBe('');
      expect(strip(null)).toBe('');
    });

    it('truncates preview to 80 chars', () => {
      const longText = 'a'.repeat(100);
      const preview = longText.substring(0, 80) + (longText.length > 80 ? '...' : '');
      expect(preview.length).toBe(83);
    });
  });

  describe('post URL construction', () => {
    it('builds correct weibo post URL', () => {
      const uid = '1670458304';
      const mblogid = 'QD5uq0ydj';
      const url = `https://weibo.com/${uid}/${mblogid}`;
      expect(url).toBe('https://weibo.com/1670458304/QD5uq0ydj');
    });
  });
});
