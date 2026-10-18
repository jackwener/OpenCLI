# Visible answer comments

`opencli zhihu answer-comments-visible <answer-url-or-id> --limit 5 --replies-limit 1 -f json`

This explicit alternative opens the normal answer page and clicks its own comment
button once. It reads only rendered comments and already-visible replies. It does
not construct comment API calls, expand reply buttons, scroll indefinitely, or
fall back to another reader after authentication, verification, or access failure.
The existing `answer-comments` command is unchanged.

Rows keep the answer URL, actual parent ID/depth, `reader: visible_dom`,
`order: page_default`, and `complete: false`. Limits cap output; they do not promise
that many rows exist. `has_unexpanded_replies` identifies a visible expansion
button; false does not prove all replies were read. Image-only rows have
`content_kind: non_text` and are not transcribed. No result claims complete coverage.

The connected browser must already be normally authenticated. An already open or
ambiguous panel stops the command to avoid associating another discussion with
the requested answer. Article comments, sorting, continuation and OCR are outside
this command. No account data, cookies or captured page content are bundled.

Validation: synthetic DOM fixtures cover one-click behavior, parent identity,
hidden rows, image-only rows, challenges, duplicate IDs and argument bounds.
These tests do not establish live-site or long-term stability.
