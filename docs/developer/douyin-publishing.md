# Douyin image-text and article publishing

The existing `douyin publish` command remains video-only. Two separate commands
drive the authenticated **official creator-center UI**, without cookie export,
private publication API replay or a new browser profile:

```sh
# Authenticate the Chrome profile once. Reuse that profile for all commands.
opencli douyin login

# Upload images, fill and read back the composer. This does NOT click Publish.
opencli douyin publish-images ./one.png,./two.jpg \
  --title "图片标题" --caption "图文正文" --keep-tab true --window foreground

# UTF-8 plain text, including paragraphs; no HTML/Markdown rendering.
opencli douyin publish-article ./article.txt \
  --title "文章标题" --summary "文章摘要" --cover ./cover.png \
  --keep-tab true --window foreground
```

## Explicit submission

Both commands default to **prepare only** and **private visibility**. Preparation
uploads the requested files to Douyin and fills the editor: it is not a local-only
dry run. The site may autosave editor state. `prepared` does not mean a draft was
explicitly saved or a post was published.

After reviewing the prepared editor, finish manually. Alternatively, start a new
operation with `--publish` to authorize one final submission click, or
`--save-draft` to choose “暂存离开”. These flags are mutually exclusive. An existing
nonempty composer is never overwritten; handle that editor manually first or use
an independent site session for a new operation. Do not replay an operation whose
submission outcome is unknown.

```sh
# These are REAL writes. Only run after explicit publication authorization.
opencli douyin publish-images ./one.png,./two.jpg \
  --title "图片标题" --caption "图文正文" --visibility public --publish
opencli douyin publish-article ./article.txt \
  --title "文章标题" --cover ./cover.png --save-draft
```

No delete, update, scheduling, cross-posting, music or original-content declaration
is implied. `#text` in a caption is plain text; it is not a claim that a native
topic entity was selected. Check topics and platform declarations in the preview.

## Observed input constraints

The creator UI observed on November 8, 2026 supports:

| Input | Image-text | Article |
|---|---|---|
| Title | 1–20 JS characters | 1–30 JS characters |
| Body | Up to 1,000 JS characters | 1–20,000 JS characters |
| Images | 1–35 | Cover required for submission/draft |
| Summary | Not applicable | Up to 30 JS characters |
| Image formats | JPG/JPEG/PNG/WebP, nonempty files, up to 50 MiB each | Same |

Article input is a UTF-8 plain-text file, at most 100 KB. The limit follows the
editor's counter; supplementary Unicode characters can count as two code units.
The article homepage advertises a smaller text limit in some layouts; the active
editor is authoritative, and readback failure prevents submission.

Article covers use a transient, detached file input. The adapter retains that
input for CDP upload, synchronously restores the native `click` method, waits for
the cover image to decode, completes the crop editor and verifies the uploaded
cover outside the modal. Rich-text editor contents are read back without relying
on framework internals.

## Results and uncertainty

- `prepared`: title, body, visibility, image count and optional article cover have
  been read back. No Publish or Save Draft click.
- `submitted`: an explicit `--publish` click received a new success notification
  and left the composer. **Not proof of approval or public visibility.**
- `draft_saved`: equivalent UI confirmation for explicit `--save-draft`.
- `uncertain`: final click was attempted but a complete receipt was unavailable.
  `retryable` is `false`. Inspect creator-center content management before doing
  anything else. There is no automatic resubmission.

The adapter never invents a post ID or constructs a public URL from an unverified
success screen. Captchas, security restrictions, authentication walls, editor
drift and mismatched readback stop the operation.

## Verification boundary

Offline production-path tests cover both commands, validation, cover upload,
paragraph readback, visibility mismatch, unsaved-work protection, security walls,
explicit submission, stale cover-save notifications and unknown outcomes.

Authenticated live testing uses synthetic test content, stops before the final
Publish/Save Draft action, and checks the actual editor. Final publication,
moderation, public reachability and saved-draft receipts are not established by
that prepare-only test. A real submission requires a separately authorized canary.
