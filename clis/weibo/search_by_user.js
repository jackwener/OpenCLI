/**
 * Weibo search_by_user — fetch a user's posts in a time range and export to Markdown.
 *
 * Uses the searchProfile AJAX API for pagination, longtext API for full-text,
 * httpDownload for images, and htmlToMarkdown for HTML-to-Markdown conversion.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { httpDownload } from '@jackwener/opencli/download';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { CommandExecutionError } from '@jackwener/opencli/errors';

/** Convert YYYY-MM-DD to Unix seconds at 00:00:00 Beijing time (UTC+8). */
function dateToTimestamp(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
}

/** Default 30 days ago and today as YYYY-MM-DD. */
function defaultDates() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const ago = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const start = `${ago.getFullYear()}-${pad(ago.getMonth() + 1)}-${pad(ago.getDate())}`;
  return { start, end: today };
}

cli({
    site: 'weibo',
    name: 'search_by_user',
    access: 'read',
    description: "Download a user's posts in a time range to Markdown",
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', positional: true, required: true, help: 'User ID (numeric uid) or screen name' },
        { name: 'start', help: 'Start date (YYYY-MM-DD), default 30 days ago' },
        { name: 'end', help: 'End date (YYYY-MM-DD), default today' },
        { name: 'has-retweet', type: 'boolean', default: false, help: 'Include retweets' },
        { name: 'has-video', type: 'boolean', default: false, help: 'Include posts with video' },
        { name: 'has-music', type: 'boolean', default: false, help: 'Include posts with music' },
        { name: 'limit', type: 'int', default: 0, help: 'Maximum posts (0 = all)' },
        { name: 'output', help: 'Output directory' },
    ],
    columns: ['id', 'text', 'time', 'likes', 'comments', 'reposts', 'images', 'saved'],
    func: async (page, kwargs) => {
        const rawUid = String(kwargs.uid);
        const { start: defaultStart, end: defaultEnd } = defaultDates();
        const startDate = kwargs.start || defaultStart;
        const endDate = kwargs.end || defaultEnd;
        const hasRetweet = kwargs['has-retweet'] ? 1 : 0;
        const hasVideo = kwargs['has-video'] ? 1 : 0;
        const hasMusic = kwargs['has-music'] ? 1 : 0;
        const limit = Math.max(0, Number(kwargs.limit) || 0);
        const starttime = dateToTimestamp(startDate);
        const endtime = dateToTimestamp(endDate);

        await page.goto('https://weibo.com');
        await page.wait(2);

        // Resolve screen_name to uid if needed
        let uid = rawUid;
        if (!/^\d+$/.test(rawUid)) {
            const resolved = await page.evaluate(`
              (async () => {
                const resp = await fetch('/ajax/profile/info?screen_name=' + encodeURIComponent('${rawUid}'), {credentials: 'include'});
                if (!resp.ok) return null;
                const data = await resp.json();
                return data.ok && data.data?.user ? String(data.data.user.id) : null;
              })()
            `);
            if (!resolved) {
                throw new CommandExecutionError(`Could not resolve screen_name "${rawUid}" to a UID. Check the username and try again.`);
            }
            uid = resolved;
        }

        // Fetch posts via searchProfile API with pagination
        const allPosts = await page.evaluate(`
          (async () => {
            const uid = ${JSON.stringify(uid)};
            const starttime = ${starttime};
            const endtime = ${endtime};
            const limit = ${limit};
            const hasRetweet = ${hasRetweet};
            const hasVideo = ${hasVideo};
            const hasMusic = ${hasMusic};
            const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

            const allPosts = [];
            let page = 1;

            while (true) {
              if (limit > 0 && allPosts.length >= limit) break;

              const url = '/ajax/statuses/searchProfile?' +
                'uid=' + uid +
                '&page=' + page +
                '&starttime=' + starttime +
                '&endtime=' + endtime +
                '&hasori=1' +
                '&hasret=' + hasRetweet +
                '&hasvideo=' + hasVideo +
                '&hasmusic=' + hasMusic;

              const resp = await fetch(url, {credentials: 'include'});
              if (!resp.ok) break;
              const data = await resp.json();

              if (!data.data || !data.data.list || !Array.isArray(data.data.list)) break;
              const list = data.data.list;

              for (const s of list) {
                if (limit > 0 && allPosts.length >= limit) break;

                let textHtml = s.text || '';
                let textRaw = s.text_raw || strip(textHtml);
                if (s.isLongText || s.is_long_text) {
                  try {
                    const ltResp = await fetch('/ajax/statuses/longtext?id=' + s.idstr, {credentials: 'include'});
                    if (ltResp.ok) {
                      const lt = await ltResp.json();
                      if (lt.data?.longTextContent) {
                        textHtml = lt.data.longTextContent;
                        textRaw = strip(lt.data.longTextContent);
                      }
                    }
                  } catch {}
                }

                const images = [];
                const picInfos = s.pic_infos || {};
                for (const pid of Object.keys(picInfos)) {
                  const info = picInfos[pid];
                  const url = (info.largest && info.largest.url) || (info.large && info.large.url) || '';
                  if (url) images.push({ url, pic_id: pid });
                }

                const u = s.user || {};
                const retweeted = s.retweeted_status ? {
                  from: (s.retweeted_status.user?.screen_name || '[deleted]'),
                  text: s.retweeted_status.text_raw || strip(s.retweeted_status.text || ''),
                } : null;

                allPosts.push({
                  idstr: s.idstr || String(s.id),
                  mblogid: s.mblogid || '',
                  textHtml,
                  textRaw,
                  created_at: s.created_at || '',
                  author: u.screen_name || '',
                  authorUid: u.id || '',
                  likes: s.attitudes_count || 0,
                  comments: s.comments_count || 0,
                  reposts: s.reposts_count || 0,
                  picNum: s.pic_num || images.length,
                  images,
                  retweeted,
                  url: 'https://weibo.com/' + (u.id || '') + '/' + (s.mblogid || ''),
                });
              }

              if (list.length <= 5) break;
              page++;
            }

            return allPosts;
          })()
        `);

        if (!allPosts || allPosts.length === 0) {
            return [{
                id: '-',
                text: `No posts found for user ${uid} between ${startDate} and ${endDate}`,
                time: '-',
                likes: '-',
                comments: '-',
                reposts: '-',
                images: '-',
                saved: '-',
            }];
        }

        // Create output directory
        const outputDir = kwargs.output
            ? String(kwargs.output)
            : `./weibo_${uid}_${startDate}_${endDate}`;
        fs.mkdirSync(outputDir, { recursive: true });

        // Get cookies for image downloads
        const cookies = formatCookieHeader(await page.getCookies({ domain: 'weibo.com' }));

        const results = [];

        for (const post of allPosts) {
            const idstr = post.idstr;
            const savedPath = path.join(outputDir, `post_${idstr}.md`);
            const imgDir = path.join(outputDir, `${idstr}_images`);
            const imagePaths = [];

            if (post.images.length > 0) {
                fs.mkdirSync(imgDir, { recursive: true });
                for (let i = 0; i < post.images.length; i++) {
                    const img = post.images[i];
                    const filename = `${i + 1}.jpg`;
                    const destPath = path.join(imgDir, filename);
                    try {
                        const result = await httpDownload(img.url, destPath, {
                            cookies,
                            headers: { Referer: 'https://weibo.com/' },
                            timeout: 60000,
                        });
                        if (result.success) {
                            imagePaths.push({ index: i + 1, relative: `./${idstr}_images/${filename}`, ok: true });
                        } else {
                            imagePaths.push({ index: i + 1, relative: img.url, ok: false });
                        }
                    } catch {
                        imagePaths.push({ index: i + 1, relative: img.url, ok: false });
                    }
                }
            }

            const md = htmlToMarkdown(post.textHtml);
            let content = md;
            const sortedPaths = [...imagePaths].sort((a, b) => a.index - b.index);
            if (sortedPaths.length > 0) {
                content += '\n\n';
                for (const ip of sortedPaths) {
                    content += `![${ip.index}](${ip.relative})\n`;
                }
            }

            if (post.retweeted) {
                content = `[@ ${post.retweeted.from}]\n> ${post.retweeted.text.replace(/\n/g, '\n> ')}\n\n---\n\n${content}`;
            }

            const frontmatter = `---\nauthor: ${post.author}\nuid: ${post.authorUid}\ntime: ${post.created_at}\nurl: ${post.url}\nlikes: ${post.likes}\ncomments: ${post.comments}\nreposts: ${post.reposts}\n---\n\n`;

            fs.writeFileSync(savedPath, frontmatter + content, 'utf-8');

            results.push({
                id: idstr,
                text: post.textRaw.substring(0, 80) + (post.textRaw.length > 80 ? '...' : ''),
                time: post.created_at,
                likes: post.likes,
                comments: post.comments,
                reposts: post.reposts,
                images: post.images.length,
                saved: `post_${idstr}.md`,
            });
        }

        // Write SUMMARY.md
        const summaryLines = ['# Weibo Posts Summary', '', `**User:** ${uid}  `, `**Range:** ${startDate} ~ ${endDate}`, '', '| # | ID | Text | Time | Likes | Comments | Reposts | Images | File |', '|---|-----|------|------|-------|----------|---------|--------|------|'];
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            summaryLines.push(`| ${i + 1} | ${r.id} | ${r.text} | ${r.time} | ${r.likes} | ${r.comments} | ${r.reposts} | ${r.images} | ${r.saved} |`);
        }
        fs.writeFileSync(path.join(outputDir, 'SUMMARY.md'), summaryLines.join('\n'), 'utf-8');

        const relOut = path.relative(process.cwd(), outputDir);
        console.log(`\nSaved ${results.length} post(s) to ${relOut}/`);
        console.log(`Summary: ${relOut}/SUMMARY.md`);

        return results;
    },
});