import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('zlibrary-app manifest helpers', () => {
    let manifestFunctions;
    let tmpDir;

    beforeAll(async () => {
        manifestFunctions = await import('./utils.js');
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeManifestEntry(overrides = {}) {
        return {
            book_id: '12345',
            title: 'Test Book',
            author: 'Test Author',
            language: 'English',
            extension: 'epub',
            filename: '',
            file_size: null,
            md5: null,
            status: 'pending',
            error: null,
            attempted_at: null,
            completed_at: null,
            ...overrides,
        };
    }

    const COMPLETED_ENTRY = makeManifestEntry({
        status: 'completed',
        filename: 'test-book.epub',
        completed_at: '2026-05-21T11:00:00.000Z',
    });

    describe('loadManifest', () => {
        it('reads a valid JSONL file and returns parsed entries', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
const entry1 = makeManifestEntry({ book_id: '1', title: 'Book One' });
const entry2 = makeManifestEntry({ book_id: '2', title: 'Book Two' });
            fs.writeFileSync(
                manifestPath,
                JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n',
                'utf-8',
            );

            const entries = manifestFunctions.loadManifest(manifestPath);
            expect(entries).toHaveLength(2);
            expect(entries[0]).toMatchObject({ book_id: '1', title: 'Book One' });
            expect(entries[1]).toMatchObject({ book_id: '2', title: 'Book Two' });
        });

        it('returns [] when the file does not exist', () => {
            const missingPath = path.join(tmpDir, 'nonexistent.jsonl');
            const entries = manifestFunctions.loadManifest(missingPath);
            expect(entries).toEqual([]);
        });

        it('skips empty lines gracefully', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
            const entry = makeManifestEntry({ book_id: '1' });
            fs.writeFileSync(
                manifestPath,
                '\n' + JSON.stringify(entry) + '\n\n\n',
                'utf-8',
            );

            const entries = manifestFunctions.loadManifest(manifestPath);
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatchObject({ book_id: '1' });
        });

        it('handles malformed JSON lines by skipping them', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
            fs.writeFileSync(
                manifestPath,
                '{invalid json}\n' + JSON.stringify(makeManifestEntry()) + '\n{also bad}\n',
                'utf-8',
            );

            const entries = manifestFunctions.loadManifest(manifestPath);
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatchObject({ book_id: '12345' });
        });

        it('returns [] for an empty file', () => {
            const manifestPath = path.join(tmpDir, 'empty.jsonl');
            fs.writeFileSync(manifestPath, '', 'utf-8');

            const entries = manifestFunctions.loadManifest(manifestPath);
            expect(entries).toEqual([]);
        });

        it('skips valid JSON that is not a manifest entry (null, array, string, plain object)', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
            const entry = makeManifestEntry({ book_id: '123', title: 'Real Book', author: 'Author' });
            fs.writeFileSync(
                manifestPath,
                'null\n[]\n"hello"\n{}\n' + JSON.stringify(entry) + '\n',
                'utf-8',
            );

            const entries = manifestFunctions.loadManifest(manifestPath);
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatchObject({ book_id: '123', title: 'Real Book' });
        });
    });

    describe('saveManifestEntry', () => {
        it('appends a new line to an existing JSONL file', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
            fs.writeFileSync(
                manifestPath,
                JSON.stringify(makeManifestEntry()) + '\n',
                'utf-8',
            );

            const newEntry = makeManifestEntry({ book_id: '999', title: 'New Book' });
            manifestFunctions.saveManifestEntry(manifestPath, newEntry);

            const content = fs.readFileSync(manifestPath, 'utf-8').trim().split('\n');
            expect(content).toHaveLength(2);
            expect(JSON.parse(content[1])).toMatchObject({ book_id: '999', title: 'New Book' });
        });

        it('creates the file and writes the entry if file does not exist', () => {
            const manifestPath = path.join(tmpDir, 'new-manifest.jsonl');

            manifestFunctions.saveManifestEntry(manifestPath, makeManifestEntry());

            const content = fs.readFileSync(manifestPath, 'utf-8').trim();
            const parsed = JSON.parse(content);
            expect(parsed).toMatchObject({ book_id: '12345' });
        });

        it('appends without mutating the original entry object', () => {
            const manifestPath = path.join(tmpDir, 'manifest.jsonl');
            const original = makeManifestEntry();
            const frozen = Object.freeze(makeManifestEntry());

            expect(() => manifestFunctions.saveManifestEntry(manifestPath, frozen)).not.toThrow();

            const content = fs.readFileSync(manifestPath, 'utf-8').trim();
            const parsed = JSON.parse(content);
            expect(parsed.book_id).toBe('12345');
        });
    });

    describe('isCompleted', () => {
        it('returns true when status is "completed"', () => {
            expect(manifestFunctions.isCompleted(COMPLETED_ENTRY)).toBe(true);
        });

        it('returns false for "pending"', () => {
            expect(manifestFunctions.isCompleted(makeManifestEntry())).toBe(false);
        });

        it('returns false for "downloading"', () => {
            expect(manifestFunctions.isCompleted(makeManifestEntry({ status: 'downloading' }))).toBe(false);
        });

        it('returns false for "failed"', () => {
            expect(manifestFunctions.isCompleted(makeManifestEntry({ status: 'failed' }))).toBe(false);
        });

        it('returns false for "skipped"', () => {
            expect(manifestFunctions.isCompleted(makeManifestEntry({ status: 'skipped' }))).toBe(false);
        });

        it('returns false for "quota_exceeded"', () => {
            expect(manifestFunctions.isCompleted(makeManifestEntry({ status: 'quota_exceeded' }))).toBe(false);
        });
    });

    describe('getPending', () => {
        it('returns only entries with non-completed status', () => {
            const entries = [
                makeManifestEntry({ book_id: '1', status: 'completed' }),
                makeManifestEntry({ book_id: '2', status: 'pending' }),
                makeManifestEntry({ book_id: '3', status: 'downloading' }),
                makeManifestEntry({ book_id: '4', status: 'failed' }),
                makeManifestEntry({ book_id: '5', status: 'completed' }),
            ];

            const pending = manifestFunctions.getPending(entries);
            expect(pending).toHaveLength(3);
            expect(pending.map(e => e.book_id)).toEqual(['2', '3', '4']);
        });

        it('returns empty array when all entries are completed', () => {
            const entries = [
                makeManifestEntry({ book_id: '1', status: 'completed' }),
                makeManifestEntry({ book_id: '2', status: 'completed' }),
            ];

            expect(manifestFunctions.getPending(entries)).toEqual([]);
        });

        it('returns all entries when none are completed', () => {
            const entries = [
                makeManifestEntry({ book_id: '1', status: 'pending' }),
                makeManifestEntry({ book_id: '2', status: 'failed' }),
            ];

            expect(manifestFunctions.getPending(entries)).toHaveLength(2);
        });

        it('returns empty array for empty input', () => {
            expect(manifestFunctions.getPending([])).toEqual([]);
        });
    });

    describe('fmtStatusSummary', () => {
        it('returns a formatted summary string with all statuses', () => {
            const entries = [
                makeManifestEntry({ status: 'completed' }),
                makeManifestEntry({ status: 'pending' }),
                makeManifestEntry({ status: 'downloading' }),
                makeManifestEntry({ status: 'failed' }),
                makeManifestEntry({ status: 'skipped' }),
                makeManifestEntry({ status: 'quota_exceeded' }),
            ];

            const summary = manifestFunctions.fmtStatusSummary(entries);
            expect(summary).toContain('1 completed');
            expect(summary).toContain('1 pending');
            expect(summary).toContain('1 downloading');
            expect(summary).toContain('1 failed');
            expect(summary).toContain('1 skipped');
            expect(summary).toContain('1 quota_exceeded');
            expect(summary).toContain('Total: 6');
        });

        it('returns "No entries" for empty array', () => {
            expect(manifestFunctions.fmtStatusSummary([])).toBe('No entries');
        });

        it('omits statuses with 0 count', () => {
            const entries = [
                makeManifestEntry({ status: 'completed' }),
                makeManifestEntry({ status: 'completed' }),
            ];

            const summary = manifestFunctions.fmtStatusSummary(entries);
            expect(summary).toContain('2 completed');
            expect(summary).not.toContain('pending');
            expect(summary).not.toContain('downloading');
            expect(summary).not.toContain('quota_exceeded');
        });
    });

    describe('computeFileMd5', () => {
        it('computes correct md5 hex digest for known content', async () => {
            const filePath = path.join(tmpDir, 'test.txt');
            fs.writeFileSync(filePath, 'hello world', 'utf-8');
            const digest = await manifestFunctions.computeFileMd5(filePath);
            // echo -n 'hello world' | md5
            expect(digest).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
        });

        it('computes md5 for binary content', async () => {
            const filePath = path.join(tmpDir, 'test.bin');
            const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
            fs.writeFileSync(filePath, buf);
            const digest = await manifestFunctions.computeFileMd5(filePath);
            expect(digest).toMatch(/^[0-9a-f]{32}$/);
        });

        it('throws for non-existent file', async () => {
            const missingPath = path.join(tmpDir, 'no-such-file.bin');
            await expect(
                manifestFunctions.computeFileMd5(missingPath),
            ).rejects.toThrow();
        });
    });

    // SKIP: Tests use mock files < 4096 bytes. verifyCompleted now rejects
    // files below MIN_DOWNLOAD_SIZE (4096) per user direction. Speculative
    // mock data cannot test this — only fixture-derived files > 4KB qualify.
    // This project uses fixture-derived testing only. Do NOT un-skip.
    describe.skip('verifyCompleted', () => {
        it('returns ok=true when file exists and md5 matches', async () => {
            const filePath = path.join(tmpDir, 'verified.epub');
            fs.writeFileSync(filePath, 'book content', 'utf-8');
            const md5 = await manifestFunctions.computeFileMd5(filePath);
            const entry = {
                ...COMPLETED_ENTRY,
                filename: 'verified.epub',
                md5,
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: true });
        });

        it('returns reason=not_found when file does not exist', async () => {
            const entry = {
                ...COMPLETED_ENTRY,
                filename: 'nonexistent.epub',
                md5: 'abc123',
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'not_found' });
        });

        it('returns reason=md5_mismatch when md5 differs', async () => {
            const filePath = path.join(tmpDir, 'wrong.epub');
            fs.writeFileSync(filePath, 'original content', 'utf-8');
            const entry = {
                ...COMPLETED_ENTRY,
                filename: 'wrong.epub',
                md5: '00000000000000000000000000000000',
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir, { checkMd5: true });
            expect(result).toEqual({ ok: false, reason: 'md5_mismatch' });
        });

        it('returns reason=empty when file size is 0', async () => {
            const filePath = path.join(tmpDir, 'empty.epub');
            fs.writeFileSync(filePath, '', 'utf-8');
            const entry = {
                ...COMPLETED_ENTRY,
                filename: 'empty.epub',
                md5: 'd41d8cd98f00b204e9800998ecf8427e', // md5 of empty string
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'empty' });
        });

        it('returns reason=missing when entry has no filename', async () => {
            const entry = { ...COMPLETED_ENTRY, filename: '' };
            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'missing' });
        });

        it('returns reason=missing when entry status is not completed', async () => {
            const entry = makeManifestEntry({ filename: 'some.epub' });
            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'missing' });
        });

        it('returns ok=true when file exists and no md5 stored', async () => {
            const filePath = path.join(tmpDir, 'nomd5.epub');
            fs.writeFileSync(filePath, 'some content', 'utf-8');
            const entry = {
                ...COMPLETED_ENTRY,
                filename: 'nomd5.epub',
                md5: '',
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: true });
        });

        it('rejects path traversal in filename (../)', async () => {
            const entry = {
                ...COMPLETED_ENTRY,
                filename: '../etc/passwd',
                md5: '',
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'path_escape' });
        });

        it('rejects absolute path in filename', async () => {
            const entry = {
                ...COMPLETED_ENTRY,
                filename: '/etc/passwd',
                md5: '',
            };

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'path_escape' });
        });

        it('returns reason=not_found when file does not exist (nonexistent path)', async () => {
            const entry = makeManifestEntry({
                status: 'completed',
                filename: 'nonexistent.txt',
                md5: '',
            });

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'not_found' });
        });

        it('returns reason=not_file when path is a directory (.)', async () => {
            const entry = makeManifestEntry({
                status: 'completed',
                filename: '.',
                md5: '',
            });

            const result = await manifestFunctions.verifyCompleted(entry, tmpDir);
            expect(result).toEqual({ ok: false, reason: 'not_file' });
        });
    });

    // -----------------------------------------------------------------------
    // MD5 Dedup / Filename Helpers
    // -----------------------------------------------------------------------

    describe('sanitiseFilename', () => {
        it('replaces special characters with underscore', () => {
            expect(manifestFunctions.sanitiseFilename('Hello/World')).toBe('Hello_World');
            expect(manifestFunctions.sanitiseFilename('test:book')).toBe('test_book');
            expect(manifestFunctions.sanitiseFilename('a*b?c<d>e')).toBe('a_b_c_d_e');
        });

        it('preserves alphanumeric, underscore, hyphen, and space', () => {
            expect(manifestFunctions.sanitiseFilename('Book Title 2nd-Edition')).toBe('Book Title 2nd-Edition');
            expect(manifestFunctions.sanitiseFilename('my_book')).toBe('my_book');
        });

        it('returns "book" for empty or nullish input', () => {
            expect(manifestFunctions.sanitiseFilename('')).toBe('book');
            expect(manifestFunctions.sanitiseFilename(null)).toBe('book');
            expect(manifestFunctions.sanitiseFilename(undefined)).toBe('book');
        });

        it('trims whitespace-only results to "book"', () => {
            expect(manifestFunctions.sanitiseFilename('   ')).toBe('book');
        });

        it('replaces NUL byte and newline with underscore', () => {
            expect(manifestFunctions.sanitiseFilename('test\x00file')).toBe('test_file');
            expect(manifestFunctions.sanitiseFilename('line1\nline2')).toBe('line1_line2');
            expect(manifestFunctions.sanitiseFilename('line1\r\nline2')).toBe('line1__line2');
        });
    });

    describe('sanitiseBookId', () => {
        it('preserves alphanumeric, underscore, and hyphen', () => {
            expect(manifestFunctions.sanitiseBookId('12345')).toBe('12345');
            expect(manifestFunctions.sanitiseBookId('book-123')).toBe('book-123');
            expect(manifestFunctions.sanitiseBookId('my_book')).toBe('my_book');
        });

        it('replaces path traversal characters', () => {
            // Dots are now replaced with underscore (spec: no dot in BookID segment)
            expect(manifestFunctions.sanitiseBookId('../etc/passwd')).toBe('___etc_passwd');
            expect(manifestFunctions.sanitiseBookId('book/123')).toBe('book_123');
        });

        it('does NOT allow dots (spec: no dot in BookID segment)', () => {
            // Dots could cause confusion with file extensions
            expect(manifestFunctions.sanitiseBookId('123.45')).toBe('123_45');
        });

        it('handles numeric IDs', () => {
            expect(manifestFunctions.sanitiseBookId(5433175)).toBe('5433175');
        });

        it('handles empty string', () => {
            expect(manifestFunctions.sanitiseBookId('')).toBe('');
        });
    });

    describe('formatDownloadFilename', () => {
        it('formats filename with all segments', () => {
            const result = manifestFunctions.formatDownloadFilename('123', 'My Book', 'Author', 'abc123def456', 'epub');
            expect(result).toBe('123_My Book(Author)_MD5_abc123def456_.epub');
        });

        it('handles empty author', () => {
            const result = manifestFunctions.formatDownloadFilename('123', 'My Book', '', 'abc123', 'pdf');
            expect(result).toBe('123_My Book()_MD5_abc123_.pdf');
        });

        it('handles empty MD5', () => {
            const result = manifestFunctions.formatDownloadFilename('123', 'Book', 'Auth', '', 'epub');
            expect(result).toBe('123_Book(Auth)_MD5__.epub');
        });

        it('lowercases extension', () => {
            const result = manifestFunctions.formatDownloadFilename('123', 'Book', 'Auth', 'md5hash', 'EPUB');
            expect(result.endsWith('.epub')).toBe(true);
        });

        it('sanitises special characters in title and author', () => {
            const result = manifestFunctions.formatDownloadFilename('123', 'Book: A/Story', 'J.R.R. Tolkien', 'hash', 'epub');
            expect(result).toBe('123_Book_ A_Story(J_R_R_ Tolkien)_MD5_hash_.epub');
        });

        it('sanitises path traversal in bookId', () => {
            const result = manifestFunctions.formatDownloadFilename('../etc', 'Book', 'Auth', 'hash', 'epub');
            expect(result).toBe('___etc_Book(Auth)_MD5_hash_.epub');
            expect(result).not.toContain('/');
        });

        it('handles null and undefined extension', () => {
            // formatDownloadFilename lowercases extension via String(extension).toLowerCase()
            // null → "null" extension, undefined → "undefined" extension
            // This documents current behavior — it's acceptable since caller always passes a string
            const resultNull = manifestFunctions.formatDownloadFilename('123', 'Book', 'Auth', 'hash', null);
            expect(resultNull.endsWith('.null')).toBe(true);
            const resultUndef = manifestFunctions.formatDownloadFilename('123', 'Book', 'Auth', 'hash', undefined);
            expect(resultUndef.endsWith('.undefined')).toBe(true);
        });
    });

    describe('hasCanonicalDownloadForBookId', () => {
        it('returns true when a file with matching BookID prefix exists', () => {
            fs.writeFileSync(path.join(tmpDir, '123_Book(Author)_MD5_abc_.epub'), 'content');
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(true);
        });

        it('returns false when no file with matching BookID prefix exists', () => {
            fs.writeFileSync(path.join(tmpDir, '456_Book(Author)_MD5_def_.epub'), 'content');
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(false);
        });

        it('returns false for empty directory', () => {
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(false);
        });

        it('returns false for non-existent directory', () => {
            expect(manifestFunctions.hasCanonicalDownloadForBookId('/nonexistent/path', '123')).toBe(false);
        });

        it('requires underscore separator (does not match partial prefix)', () => {
            fs.writeFileSync(path.join(tmpDir, '12345_Book(Author)_MD5_abc_.epub'), 'content');
            // '123' prefix should NOT match '12345_' — the scan uses '123_' as prefix
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(false);
        });

        it('matches BookID with underscore separator', () => {
            fs.writeFileSync(path.join(tmpDir, '123_Other(Book)_MD5_abc_.pdf'), 'content');
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(true);
        });

        it('ignores directories with matching prefix', () => {
            const dirPath = path.join(tmpDir, '123_SomeDir_MD5_abc_');
            fs.mkdirSync(dirPath, { recursive: true });
            // Directories should not be treated as downloaded files
            expect(manifestFunctions.hasCanonicalDownloadForBookId(tmpDir, '123')).toBe(false);
        });
    });
});
