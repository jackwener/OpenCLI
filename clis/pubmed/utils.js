import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const SEARCH_COLUMNS = ['rank', 'pmid', 'title', 'authors', 'journal', 'year', 'article_type', 'doi', 'url'];
export const LINK_COLUMNS = ['rank', 'pmid', 'title', 'authors', 'journal', 'year', 'article_type', 'doi', 'url'];
export const RELATED_COLUMNS = ['rank', 'pmid', 'title', 'authors', 'journal', 'year', 'article_type', 'score', 'doi', 'url'];

let lastRequestAt = 0;

export function requireText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new ArgumentError(`pubmed ${label} cannot be empty`);
    }
    return text;
}

export function requirePmid(value, label = 'pmid') {
    const pmid = requireText(value, label);
    if (!/^\d+$/.test(pmid)) {
        throw new ArgumentError(`pubmed ${label} must be a numeric PMID`, 'Example: 37780221');
    }
    return pmid;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) {
        throw new ArgumentError(`pubmed ${label} must be a positive integer`);
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < 1) {
        throw new ArgumentError(`pubmed ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`pubmed ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireYear(value, label) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const year = requireBoundedInt(value, 1900, 3000, label);
    if (year < 1800) {
        throw new ArgumentError(`pubmed ${label} must be >= 1800`);
    }
    return year;
}

export function requireChoice(value, choices, label, defaultValue) {
    const text = String(value ?? defaultValue).trim();
    if (!choices.includes(text)) {
        throw new ArgumentError(`pubmed ${label} must be one of: ${choices.join(', ')}`);
    }
    return text;
}

export function buildEutilsUrl(tool, params = {}) {
    const searchParams = new URLSearchParams();
    searchParams.set('db', 'pubmed');
    if (!params.retmode) {
        searchParams.set('retmode', 'json');
    }
    if (process.env.NCBI_API_KEY) {
        searchParams.set('api_key', process.env.NCBI_API_KEY);
    }
    if (process.env.NCBI_EMAIL) {
        searchParams.set('email', process.env.NCBI_EMAIL);
    }
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    }
    return `${EUTILS_BASE}/${tool}.fcgi?${searchParams.toString()}`;
}

async function waitForRateLimit() {
    if (process.env.NODE_ENV === 'test') {
        return;
    }
    const delayMs = process.env.NCBI_API_KEY ? 110 : 360;
    const now = Date.now();
    const waitMs = Math.max(0, lastRequestAt + delayMs - now);
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
}

export async function eutilsFetch(tool, params = {}, { retmode = 'json', label = 'PubMed E-utilities' } = {}) {
    const url = buildEutilsUrl(tool, { ...params, retmode });
    await waitForRateLimit();
    let response;
    try {
        response = await fetch(url);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`${label} request failed`, detail);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`${label} HTTP ${response.status}`, 'Check NCBI availability, request parameters, and optional NCBI_API_KEY.');
    }
    if (retmode === 'xml') {
        return response.text();
    }
    try {
        const json = await response.json();
        assertNoEutilsError(json, label);
        return json;
    }
    catch (error) {
        if (error instanceof CommandExecutionError) {
            throw error;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`${label} returned invalid JSON`, detail);
    }
}

export function assertNoEutilsError(json, label = 'PubMed E-utilities') {
    const error = json?.error
        || json?.esearchresult?.errorlist?.phrasesnotfound?.join(', ')
        || json?.esearchresult?.errorlist?.fieldsnotfound?.join(', ');
    if (error) {
        throw new CommandExecutionError(`${label} returned an error`, String(error));
    }
}

export function buildPubMedUrl(pmid) {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

export function decodeXmlEntities(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

export function cleanText(value) {
    return decodeXmlEntities(value).replace(/\s+/g, ' ').trim();
}

export function truncateText(value, maxLength) {
    const text = cleanText(value);
    if (!text || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 3)}...`;
}

export function extractFirst(xml, tag) {
    const match = String(xml ?? '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? cleanText(match[1].replace(/<[^>]+>/g, ' ')) : '';
}

export function extractAll(xml, tag) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const out = [];
    let match;
    while ((match = re.exec(String(xml ?? ''))) !== null) {
        out.push(cleanText(match[1].replace(/<[^>]+>/g, ' ')));
    }
    return out;
}

export function extractAttribute(xml, tag, attr) {
    const match = String(xml ?? '').match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i'));
    return match ? decodeXmlEntities(match[1]) : '';
}

export function extractAuthors(authorList, maxAuthors = 3) {
    if (!Array.isArray(authorList) || authorList.length === 0) {
        return '';
    }
    const names = authorList.map(author => author?.name || author?.collectivename || [author?.lastname, author?.initials].filter(Boolean).join(' ')).filter(Boolean);
    const shown = names.slice(0, maxAuthors);
    if (names.length > maxAuthors) {
        shown.push('et al.');
    }
    return shown.join(', ');
}

export function extractDoi(articleIds) {
    if (!Array.isArray(articleIds)) {
        return '';
    }
    const doi = articleIds.find(id => String(id?.idtype ?? '').toLowerCase() === 'doi');
    return String(doi?.value ?? '').trim();
}

export function articleTypeFromList(types) {
    const values = Array.isArray(types)
        ? types.map(type => typeof type === 'string' ? type : type?.value).filter(Boolean)
        : [];
    const priority = ['Systematic Review', 'Meta-Analysis', 'Review', 'Randomized Controlled Trial', 'Clinical Trial', 'Case Reports', 'Journal Article'];
    for (const wanted of priority) {
        const found = values.find(type => type.toLowerCase() === wanted.toLowerCase());
        if (found) {
            return found;
        }
    }
    return values[0] || 'Journal Article';
}

export function summaryToRow(article, rank, pmid = article?.uid) {
    const id = String(pmid ?? article?.uid ?? '').trim();
    return {
        rank,
        pmid: id,
        title: truncateText(String(article?.title ?? '').replace(/\.$/, ''), 120),
        authors: extractAuthors(article?.authors, 3),
        journal: truncateText(article?.fulljournalname || article?.source || '', 60),
        year: String(article?.pubdate ?? '').split(' ')[0] || '',
        article_type: articleTypeFromList(article?.pubtype),
        doi: extractDoi(article?.articleids),
        url: buildPubMedUrl(id),
    };
}

export function ensureCompleteSummaryRows(pmids, result, commandLabel) {
    if (!result || typeof result !== 'object' || !result.result || typeof result.result !== 'object') {
        throw new CommandExecutionError(`${commandLabel} returned an unreadable summary payload`);
    }
    const rows = pmids.map((pmid, index) => {
        const article = result.result[pmid];
        if (!article) {
            return null;
        }
        return summaryToRow(article, index + 1, pmid);
    });
    if (rows.some(row => row === null)) {
        throw new CommandExecutionError(`${commandLabel} omitted summaries for one or more PMIDs`, 'Refusing to return a partial result set.');
    }
    return rows;
}

export function buildSearchQuery(query, filters = {}) {
    const terms = [requireText(query, 'query')];
    if (filters.author) terms.push(`${requireText(filters.author, 'author')}[Author]`);
    if (filters.journal) terms.push(`${requireText(filters.journal, 'journal')}[Journal]`);
    if (filters.yearFrom || filters.yearTo) {
        const from = filters.yearFrom || 1800;
        const to = filters.yearTo || new Date().getFullYear();
        if (from > to) {
            throw new ArgumentError('pubmed year-from must be <= year-to');
        }
        terms.push(`${from}:${to}[PDAT]`);
    }
    if (filters.articleType) terms.push(`${requireText(filters.articleType, 'article-type')}[PT]`);
    if (filters.hasAbstract) terms.push('hasabstract[text]');
    if (filters.hasFullText) terms.push('free full text[sb]');
    if (filters.humanOnly) terms.push('humans[mesh]');
    if (filters.englishOnly) terms.push('english[lang]');
    return terms.join(' AND ');
}

export function parseArticleXml(xml, pmid) {
    const text = String(xml ?? '');
    if (!text || /<ERROR\b/i.test(text) || !/<PubmedArticle\b/i.test(text)) {
        return null;
    }
    const articleBlock = text.match(/<Article\b[^>]*>([\s\S]*?)<\/Article>/i)?.[1] || text;
    const journalBlock = articleBlock.match(/<Journal\b[^>]*>([\s\S]*?)<\/Journal>/i)?.[1] || '';
    const journalIssue = journalBlock.match(/<JournalIssue\b[^>]*>([\s\S]*?)<\/JournalIssue>/i)?.[1] || '';
    const pubDate = journalIssue.match(/<PubDate\b[^>]*>([\s\S]*?)<\/PubDate>/i)?.[1] || '';
    const authorBlocks = [...text.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/gi)].map(match => match[1]);
    const authors = authorBlocks.map(block => {
        const name = extractFirst(block, 'CollectiveName') || [extractFirst(block, 'LastName'), extractFirst(block, 'ForeName') || extractFirst(block, 'Initials')].filter(Boolean).join(' ');
        return name;
    }).filter(Boolean);
    const abstract = extractAll(articleBlock, 'AbstractText').join(' ');
    const pubTypes = extractAll(articleBlock, 'PublicationType');
    const meshTerms = extractAll(text, 'DescriptorName');
    const keywords = extractAll(text, 'Keyword');
    const doi = text.match(/<ArticleId\b[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/i)?.[1] || '';
    const pmc = text.match(/<ArticleId\b[^>]*IdType="pmc"[^>]*>([\s\S]*?)<\/ArticleId>/i)?.[1] || '';
    return {
        pmid,
        title: extractFirst(articleBlock, 'ArticleTitle'),
        abstract,
        authors,
        journal: extractFirst(journalBlock, 'Title') || extractFirst(journalBlock, 'ISOAbbreviation'),
        year: extractFirst(pubDate, 'Year') || extractFirst(text, 'MedlineDate').slice(0, 4),
        date: [extractFirst(pubDate, 'Year'), extractFirst(pubDate, 'Month'), extractFirst(pubDate, 'Day')].filter(Boolean).join(' '),
        doi: cleanText(doi),
        pmc: cleanText(pmc),
        article_type: articleTypeFromList(pubTypes),
        language: extractFirst(articleBlock, 'Language'),
        mesh_terms: meshTerms.slice(0, 10).join(', '),
        keywords: keywords.slice(0, 10).join(', '),
        url: buildPubMedUrl(pmid),
    };
}

export async function fetchSummaryRows(pmids, commandLabel) {
    const result = await eutilsFetch('esummary', { id: pmids.join(',') }, { label: commandLabel });
    return ensureCompleteSummaryRows(pmids, result, commandLabel);
}
