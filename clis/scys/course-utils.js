import { cleanText, normalizeScysUrl, toScysCourseUrl } from './common.js';
function safeNormalizeScysUrl(url) {
    const cleaned = cleanText(url);
    if (!cleaned)
        return '';
    return normalizeScysUrl(cleaned);
}
function dedupeStrings(values) {
    return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)));
}
function normalizeImageUrl(url) {
    if (!url)
        return '';
    if (url.startsWith('http://') || url.startsWith('https://'))
        return url;
    if (url.startsWith('/'))
        return `https://scys.com${url}`;
    return '';
}
function normalizeImages(values) {
    return Array.from(new Set(values
        .map((value) => normalizeImageUrl(cleanText(value)))
        .filter(Boolean)
        .filter((value) => !value.startsWith('data:'))
        .filter((value) => !/\/images\/pic_empty\.png$/i.test(value))));
}
function chooseCourseChapterTitle(payload) {
    const explicit = cleanText(payload.chapterTitle);
    if (explicit)
        return explicit;
    const byToc = (payload.tocRows ?? []).find((row) => cleanText(row.chapter_id) === cleanText(payload.chapterId));
    if (byToc?.chapter_title)
        return cleanText(byToc.chapter_title);
    const current = cleanText(payload.currentChapter);
    if (current)
        return current;
    const breadcrumbLast = cleanText((payload.breadcrumb ?? []).at(-1));
    return breadcrumbLast;
}
function normalizeBreadcrumb(payload, chapterTitle) {
    const byToc = (payload.tocRows ?? []).find((row) => cleanText(row.chapter_id) === cleanText(payload.chapterId));
    if (byToc) {
        const tocParts = [cleanText(byToc.section), cleanText(byToc.group), chapterTitle || cleanText(byToc.chapter_title)].filter(Boolean);
        if (tocParts.length > 0)
            return tocParts.join(' > ');
    }
    const parts = dedupeStrings(payload.breadcrumb ?? []);
    if (parts.length === 0)
        return chapterTitle;
    if (!chapterTitle)
        return parts.join(' > ');
    return [...parts.slice(0, -1), chapterTitle].filter(Boolean).join(' > ');
}
function parseParticipantCount(input) {
    const match = cleanText(input).match(/(\d+)\s*人参与/);
    return match?.[1] ? Number(match[1]) : 0;
}
// Course正文是由多个内联节点拼接而成，URL 常在 DOM 文本合并时被打散。
export function repairScysBrokenUrls(input) {
    let output = cleanText(input);
    if (!output)
        return '';
    output = output.replace(/\b(https?)\s*:\s*\/\//gi, '$1://');
    output = output.replace(/(https?:\/\/)\s+/gi, '$1');
    let previous = '';
    while (output !== previous) {
        previous = output;
        output = output.replace(/(https?:\/\/[A-Za-z0-9._-]*[./])\s+([A-Za-z0-9._/-]+)/gi, '$1$2');
        output = output.replace(/(https?:\/\/[A-Za-z0-9._-]+)\s+([A-Za-z0-9._-]+\.[A-Za-z]{2,}(?:\/[A-Za-z0-9._/-]*)?)/gi, '$1$2');
    }
    output = output.replace(/https?:\/\/www\.curor\.com\//gi, 'http://www.cursor.com/');
    output = output.replace(/https?:\/\/github\.com\/ignup/gi, 'http://github.com/signup');
    output = output.replace(/https?:\/\/iliconflow\.cn\//gi, 'http://siliconflow.cn/');
    return output;
}
export function summarizeScysToc(rows) {
    return rows
        .slice(0, 24)
        .map((row, index) => {
        const section = cleanText(row.section);
        const group = cleanText(row.group);
        const chapterTitle = cleanText(row.chapter_title);
        const entryType = cleanText(row.entry_type);
        const left = entryType === 'section'
            ? section || chapterTitle || group
            : [section, group, chapterTitle].filter(Boolean).join(' > ').replace(/ > ([^>]+)$/, '/$1');
        return `${index + 1}.${left}${row.chapter_id ? `(${cleanText(row.chapter_id)})` : ''}`;
    })
        .join(' | ');
}
export function buildScysCourseChapterUrls(baseUrl, rows) {
    const courseUrl = new URL(toScysCourseUrl(baseUrl));
    const seen = new Set();
    const urls = [];
    for (const row of rows) {
        const chapterId = cleanText(row.chapter_id);
        if (!chapterId)
            continue;
        if (cleanText(row.entry_type) && cleanText(row.entry_type) !== 'chapter')
            continue;
        if (seen.has(chapterId))
            continue;
        seen.add(chapterId);
        const url = new URL(courseUrl.toString());
        url.searchParams.set('chapterId', chapterId);
        urls.push(url.toString());
    }
    return urls;
}
export function normalizeScysCoursePayload(payload) {
    const chapterTitle = chooseCourseChapterTitle(payload);
    const images = normalizeImages(payload.images ?? []);
    const contentImages = normalizeImages(payload.contentImages ?? []);
    const links = dedupeStrings(payload.links ?? []).map((value) => normalizeScysUrl(value)).filter(Boolean);
    return {
        course_title: cleanText(payload.courseTitle),
        chapter_title: chapterTitle,
        breadcrumb: normalizeBreadcrumb(payload, chapterTitle),
        content: repairScysBrokenUrls(cleanText(payload.content)),
        chapter_id: cleanText(payload.chapterId),
        toc_summary: summarizeScysToc(payload.tocRows ?? []),
        url: safeNormalizeScysUrl(payload.pageUrl || ''),
        raw_url: safeNormalizeScysUrl(payload.pageUrl || ''),
        updated_at_text: cleanText(payload.updatedAtText),
        copyright_text: cleanText(payload.copyrightText),
        prev_chapter: cleanText(payload.prevChapter),
        next_chapter: cleanText(payload.nextChapter),
        participant_count: parseParticipantCount(cleanText(payload.participantText)),
        discussion_hint: cleanText(payload.discussionHint),
        links,
        images,
        image_count: images.length,
        content_images: contentImages,
        content_image_count: contentImages.length,
        image_dir: '',
    };
}
