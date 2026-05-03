import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'collection-create',
    description: 'Create a new Instagram saved-posts collection (folder)',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'name',
            required: true,
            positional: true,
            help: 'Name of the collection to create',
        },
    ],
    columns: ['status', 'collectionId', 'collectionName', 'mediaCount'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const name = \${{ args.name | json }};
  if (!name || !String(name).trim()) {
    throw new Error('Collection name cannot be empty');
  }
  const trimmed = String(name).trim();
  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  if (!csrf) {
    throw new Error('csrftoken cookie missing - make sure you are logged in to Instagram');
  }
  const fd = new FormData();
  fd.append('name', trimmed);
  fd.append('module_name', 'collection_create');
  const res = await fetch('https://www.instagram.com/api/v1/collections/create/', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-IG-App-ID': '936619743392459',
      'X-CSRFToken': csrf,
    },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Failed to create collection: HTTP ' + res.status + (body ? ' - ' + body.slice(0, 200) : ''));
  }
  const d = await res.json();
  if (d?.status && d.status !== 'ok') {
    throw new Error('Instagram returned non-ok status: ' + JSON.stringify(d).slice(0, 300));
  }
  return [{
    status: 'Created',
    collectionId: String(d?.collection_id ?? ''),
    collectionName: String(d?.collection_name ?? trimmed),
    mediaCount: d?.collection_media_count ?? 0,
  }];
})()
` },
    ],
});
