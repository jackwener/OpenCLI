import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'profile',
    access: 'read',
    description: 'Get Facebook user/page profile info',
    domain: 'www.facebook.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Facebook username or page name',
        },
    ],
    columns: ['name', 'username', 'friends', 'followers', 'url'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/${{ args.username }}', settleMs: 3000 } },
        { evaluate: `(() => {
  const username = \${{ args.username | json }};
  const main = document.querySelector('[role="main"]') || document;
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const h1 = main.querySelector('h1');
  let name = clean(h1 && h1.textContent);

  // Facebook's current profile header no longer uses an h1. The profile-avatar
  // link carries the display name on both the link and its role=img child.
  // Scope this fallback to the requested profile path so page chrome cannot win.
  if (!name) {
    const requestedPrefix = '/' + String(username).toLowerCase() + '/';
    const profileMediaLink = Array.from(main.querySelectorAll('a[aria-label][href]')).find((link) => {
      const href = link.getAttribute('href') || '';
      let path = '';
      try { path = new URL(href, window.location.href).pathname.toLowerCase(); } catch {}
      const image = link.querySelector('[role="img"][aria-label]');
      return path.startsWith(requestedPrefix)
        && image
        && clean(link.getAttribute('aria-label')) === clean(image.getAttribute('aria-label'));
    });
    name = clean(profileMediaLink && profileMediaLink.getAttribute('aria-label'));
  }

  // Scope relationship links to the profile main region. Global navigation also
  // contains /friends and previously produced empty or generic chrome text.
  const links = Array.from(main.querySelectorAll('a[href]'));
  const hasProfilePath = (link, suffix) => {
    try {
      const path = new URL(link.getAttribute('href') || '', window.location.href).pathname
        .replace(/\\/+$/, '')
        .toLowerCase();
      return path === '/' + String(username).toLowerCase() + suffix;
    } catch { return false; }
  };
  const friendsLink = links.find((a) => hasProfilePath(a, '/friends'));
  const followersLink = links.find((a) => hasProfilePath(a, '/followers'));

  return [{
    name: name,
    username,
    friends: friendsLink ? clean(friendsLink.textContent) : '-',
    followers: followersLink ? clean(followersLink.textContent) : '-',
    url: window.location.href,
  }];
})()
` },
    ],
});
