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
  const h1 = document.querySelector('h1');
  let name = h1 ? h1.textContent.trim() : '';

  // Find friends/followers links
  const links = Array.from(document.querySelectorAll('a'));
  const friendsLink = links.find(a => a.href && a.href.includes('/friends'));
  const followersLink = links.find(a => a.href && a.href.includes('/followers'));

  return [{
    name: name,
    username: \${{ args.username | json }},
    friends: friendsLink ? friendsLink.textContent.trim() : '-',
    followers: followersLink ? followersLink.textContent.trim() : '-',
    url: window.location.href,
  }];
})()
` },
    ],
});
