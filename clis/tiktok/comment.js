import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'comment',
    access: 'write',
    description: 'Comment on a TikTok video',
    domain: 'www.tiktok.com',
    args: [
        { name: 'url', required: true, positional: true, help: 'TikTok video URL' },
        { name: 'text', required: true, positional: true, help: 'Comment text' },
    ],
    columns: ['status', 'url', 'text'],
    pipeline: [
        { navigate: { url: '${{ args.url }}', settleMs: 6000 } },
        { evaluate: `(async () => {
  const url = \${{ args.url | json }};
  const commentText = \${{ args.text | json }};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // Click comment icon to expand comment section
  const commentIcon = document.querySelector('[data-e2e="comment-icon"]');
  if (commentIcon) {
    const cBtn = commentIcon.closest('button') || commentIcon.closest('[role="button"]') || commentIcon;
    cBtn.click();
    await wait(3000);
  }

  // Count existing comments for verification
  const beforeCount = document.querySelectorAll('[data-e2e="comment-level-1"]').length;

  // Find comment input
  const input = document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]') ||
                document.querySelector('[contenteditable="true"]');
  if (!input) throw new Error('Comment input not found - make sure you are logged in');

  input.focus();
  document.execCommand('insertText', false, commentText);
  await wait(1000);

  // Click post button
  const btns = Array.from(document.querySelectorAll('[data-e2e="comment-post"], button'));
  const postBtn = btns.find(function(b) {
    var t = b.textContent.trim();
    return t === 'Post' || t === '发布' || t === '发送';
  });
  if (!postBtn) throw new Error('Post button not found');
  postBtn.click();
  await wait(3000);

  // Verify comment was posted by checking if comment count increased
  const afterCount = document.querySelectorAll('[data-e2e="comment-level-1"]').length;
  const posted = afterCount > beforeCount;

  return [{ status: posted ? 'Commented' : 'Comment may have failed', url: url, text: commentText }];
})()
` },
    ],
});
