/**
 * Z-Library Desktop download command.
 *
 * Accepts a book detail URL, navigates to it, extracts the /dl/ URL,
 * then downloads the file via CDP Fetch stream (Electron webview).
 *
 * Flow: parse URL → validate output → dedup → navigate → extract /dl/ link
 *       → CDP Fetch stream → validate → ingest → record manifest.
 *
 * CDP Transport: uses page.bridge duck-typing for Fetch.requestPaused events,
 * Fetch.takeResponseBodyAsStream for incremental file write with MD5 computation.
 * No separate cookie fetch or Node HTTP client — cookies inherited from session.
 *
 * Column layout: ['Status', 'Filename', 'Size']
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseBookIdFromUrlPath } from './_shared/infra/book-selector.js';
import { extractDownloadLinkFromCurrentPage } from './_shared/book-download/link.js';
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall, toDownloadUrlRelative } from './_shared/infra/url-boundary.js';
import { loadQuotaTracker } from './_shared/quota/checker.js';
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js';
import { DownloadFixtureRecorder } from './_shared/fixture/index.js';
import { hasCanonicalDownloadForBookId, FILENAME_TEMPLATE_DEFAULT } from './_shared/infra/manifest-helpers.js';
import { buildBookPageMetadata } from './_shared/book-metadata.js';
import { initCdpDownload } from './_shared/book-download/transport.js';
import { recordCompletedDownload } from './_shared/book-download/workflow.js';

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

cli({
    site: 'zlibrary-app',
    name: 'download',
    access: 'write',
    description: 'Download a Z-Library book file via the Z-Library Desktop app (CDP Fetch stream)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'book-url',
            required: true,
            help: 'Z-Library book detail URL (e.g., /book/DjEXwd1ZRo/title.html or https://z-lib.bz/book/DjEXwd1ZRo/title.html)',
        },
        {
            name: 'extension',
            required: false,
            help: 'Download format (epub, pdf, mobi, azw3) — auto-detected from the book page when omitted',
        },
        {
            name: 'output',
            required: false,
            default: './downloads',
            help: 'Output directory for downloaded files',
        },
        {
            name: 'filename-template',
            required: false,
            default: FILENAME_TEMPLATE_DEFAULT,
            help: 'Filename template. Keys: {id} {title} {author} {md5}. Extension auto-appended.',
        },
        {
            name: 'fixture',
            required: false,
            type: 'boolean',
            default: false,
            help: 'Save a download telemetry fixture for offline diagnosis',
        },
    ],
    columns: ['Status', 'Filename', 'Size'],
    func: async (page, kwargs) => {
        const lock = await acquireLockOrThrow('zlibrary-app download');
        try {
        // -- 1. Parse URL and extract book ID (pure, no navigation) --
        const rawInput = String(kwargs['book-url'] || '').trim();

        // Normalize absolute URL to relative path
        let urlPath;
        if (rawInput.startsWith('http:') || rawInput.startsWith('https:')) {
            try {
                const parsed = new URL(rawInput);
                // Security: validate input URL is same-origin to prevent
                // cross-origin navigation that could leak cookies or state.
                const currentOriginUrl = await getCurrentHttpOrigin(page);
                if (parsed.origin !== currentOriginUrl.origin) {
                    throw new ArgumentError(
                        `--book-url origin mismatch: expected ${currentOriginUrl.origin}, got ${parsed.origin}. ` +
                        'Use a relative path instead (e.g., /book/DjEXwd1ZRo/title.html).'
                    );
                }
                urlPath = parsed.pathname + parsed.search + parsed.hash;
            } catch (err) {
                if (err instanceof ArgumentError) throw err;
                throw new ArgumentError(
                    '--book-url must be a Z-Library book detail URL (e.g., /book/DjEXwd1ZRo/title.html)',
                );
            }
        } else {
            urlPath = rawInput;
        }

        // Ensure path starts with /book/
        if (!urlPath.startsWith('/book/')) {
            throw new ArgumentError(
                '--book-url must be a Z-Library book detail URL (e.g., /book/DjEXwd1ZRo/title.html)',
            );
        }

        // Parse book ID from URL path
        const bookId = parseBookIdFromUrlPath(urlPath);

        // -- 2. Validate output directory (BEFORE navigation) --
        const outputDir = String(kwargs.output || './downloads').trim();
        const resolvedOutput = path.resolve(outputDir);
        // -- 3. Dedup check (BEFORE navigation) --
        await mkdir(resolvedOutput, { recursive: true });
        if (hasCanonicalDownloadForBookId(resolvedOutput, bookId)) {
            return [{
                Status: 'Already exists',
                Filename: '(matched by BookID prefix)',
                Size: '',
            }];
        }

        const manifestPath = path.join(resolvedOutput, 'manifest.jsonl');

        // -- 3.5 Quota pre-check (ledger-backed, navigates to /users/downloads) --
        // Creates/loads the persistent ledger and bootstraps from DOM if needed.
        const { ledger, tracker: quotaTracker } = await loadQuotaTracker(page);
        if (quotaTracker.isExhausted()) {
            const resetInfo = ledger.ledger && ledger.ledger.resetAt
                ? 'next reset: ' + new Date(ledger.ledger.resetAt).toLocaleString()
                : 'try later';
            return [{
                Status: 'Quota exhausted',
                Filename: '(quota exceeded — ' + resetInfo + ')',
                Size: '',
            }];
        }

        // -- 4. Navigate to the book detail page (absolute URL) --
        const originUrl = await getCurrentHttpOrigin(page);
        const bookUrl = originUrl.origin + urlPath;
        await page.goto(bookUrl, { waitUntil: 'load', settleMs: 2000 });
        await page.wait(1.5);

        // -- 4.5 Post-navigation validation --
        await assertSameOriginNotLoginWall(page, originUrl, 'zlibrary-app download');

        // -- 5. Extract download link from the already-loaded page --
        const dlResult = await extractDownloadLinkFromCurrentPage(page);
        if (!dlResult) {
            throw new CommandExecutionError(
                'Could not find download link for book ' + bookId,
                'Navigate to the book detail page or use `zlibrary-app search <term>`.',
            );
        }

        // -- 6. Extract page metadata for filename template --
        const metadata = await buildBookPageMetadata(page);

        // -- 7. Execute the download --
        const fixtureFlag = Boolean(kwargs.fixture || false);
        const result = await runDownload(
            page,
            dlResult,
            bookId,
            resolvedOutput,
            manifestPath,
            String(kwargs['filename-template'] || FILENAME_TEMPLATE_DEFAULT),
            metadata,
            String(kwargs.extension || ''),
            fixtureFlag,
        );

        // -- 8. Consume quota after successful download --
        // Only count downloads against the ledger when the file was actually
        // downloaded and the manifest entry was saved.
        quotaTracker.consume(1);

        return result;
    } finally {
        await lock.release();
    }
    },
});

/**
 * Execute download via CDP Fetch transport (Electron webview).
 *
 * Builds a DownloadRequest from the extracted /dl/ link and page context,
 * wires the CDP event bus via page.bridge duck-typing, then runs the
 * download-workflow pipeline: validate → transport → validate → ingest → record.
 *
 * No retry loop — CDP Fetch transport has a single timeout.
 * No separate cookie fetch — cookies inherited from CDP-connected session.
 */
async function runDownload(page, dlResult, bookId, resolvedOutput, manifestPath, filenameTemplate, metadata, extensionArg, fixtureFlag) {
    const format = String(dlResult.format || extensionArg || 'epub').toLowerCase();
    const origin = String(await page.evaluate('window.location.origin'));
    const referer = String(await page.evaluate('window.location.href'));

    // Set up fixture recorder if --fixture flag is set
    const fixtureRecorder = fixtureFlag
        ? new DownloadFixtureRecorder({
            enabled: true,
            command: 'download',
            bookId,
            outputDir: resolvedOutput,
          })
        : null;

    // Record browser context before download
    if (fixtureRecorder) {
        try {
            fixtureRecorder.recordBrowserContext({
                url: referer,
                origin,
                userAgent: String(await page.evaluate('navigator.userAgent').catch(() => '') || ''),
                language: String(await page.evaluate('navigator.language').catch(() => '') || ''),
            });
        } catch (_) { /* best-effort */ }
    }

    // Record book metadata (title, author, extension) for fixture
    if (fixtureRecorder) {
        try {
            fixtureRecorder.recordBook({
                bookId,
                title: metadata.title || '',
                author: metadata.author || '',
                extension: format,
            });
        } catch (_) { /* best-effort */ }
    }

    // Record HTTP request details for fixture trigger block
    if (fixtureRecorder) {
        try {
            fixtureRecorder.recordRequest({
                method: 'GET',
                url: dlResult.url,
            });
        } catch (_) { /* best-effort */ }
    }

    // Convert download URL to internal relative URL (URL boundary)
    const urlRelative = toDownloadUrlRelative(dlResult.url, origin);

    // Build DownloadRequest (follows download-contracts type definition)
    const request = {
        bookId,
        urlRelative,
        origin,
        referer,
        format,
        outputDir: resolvedOutput,
        timeoutMs: 120000,
        metadata: {
            ...metadata,
            title: metadata.title || '',
            author: metadata.author || '',
            language: metadata.language || '',
        },
        filenameTemplate,
    };

    // Wire and execute CDP Fetch download via reusable wrapper
    let workflowResult;
    try {
        workflowResult = await initCdpDownload(page, request, {
            onCdpEvent: fixtureRecorder
                ? (evt) => fixtureRecorder.recordCdpNetwork(evt)
                : undefined,
            verifyDownload: false,
        });

        // Record download result in fixture (when --fixture flag is set)
        if (fixtureRecorder) {
            fixtureRecorder.recordDownloadResult({
                filename: workflowResult.filename,
                finalPath: workflowResult.outputPath,
                fileSizeBytes: workflowResult.fileSize,
                md5: workflowResult.md5,
                cdnMd5: workflowResult.cdnMd5 || '',
                cdnMd5Verified: workflowResult.cdnMd5Verified || false,
            });
        }

        // Record manifest entry via workflow helper
        recordCompletedDownload(workflowResult, { manifestPath, outputDir: resolvedOutput }, {
            bookId,
            title: metadata.title || '',
            author: metadata.author || '',
            language: metadata.language || '',
        });

        return [{
            Status: 'Completed',
            Filename: workflowResult.filename,
            Size: workflowResult.fileSize + ' bytes',
        }];
    } catch (err) {
        // Record error in fixture before rethrowing
        if (fixtureRecorder) {
            try { fixtureRecorder.recordError(err, 'download'); } catch (_) {}
        }
        throw err;
    } finally {
        // Always save fixture on success or failure
        if (fixtureRecorder) {
            try {
                const fixturePath = fixtureRecorder.save();
                if (fixturePath) {
                    console.warn('[download]', JSON.stringify({
                        phase: 'fixture_saved',
                        path: fixturePath,
                    }));
                }
            } catch (_) { /* best-effort */ }
        }
    }
}
