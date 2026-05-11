import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'collection-delete',
    access: 'write',
    description: 'Delete an Instagram saved-posts collection (folder) by name or id',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'target',
            required: true,
            positional: true,
            help: 'Collection name (case-insensitive) or numeric collection_id',
        },
    ],
    columns: ['status', 'collectionId', 'collectionName'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const target = \${{ args.target | json }};
  if (!target || !String(target).trim()) {
    throw new Error('Collection target (name or id) cannot be empty');
  }
  const raw = String(target).trim();
  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  if (!csrf) {
    throw new Error('csrftoken cookie missing - make sure you are logged in to Instagram');
  }
  const headers = { 'X-IG-App-ID': '936619743392459' };

  // Resolve name -> id via /collections/list/. Always go through this path so we can
  // surface an explicit error on duplicate names or unknown names instead of relying
  // on a 404.
  const listRes = await fetch('https://www.instagram.com/api/v1/collections/list/?collection_types=%5B%22MEDIA%22%5D', {
    credentials: 'include',
    headers,
  });
  if (!listRes.ok) {
    throw new Error('Failed to list collections: HTTP ' + listRes.status + ' - make sure you are logged in to Instagram');
  }
  const listData = await listRes.json();
  const collections = listData?.items || [];
  const isNumericId = /^\\d{6,}$/.test(raw);
  let id = '';
  let resolvedName = '';
  if (isNumericId) {
    const hit = collections.find((c) => String(c?.collection_id) === raw);
    if (!hit) {
      throw new Error('Collection id not found in your account: ' + raw);
    }
    id = String(hit.collection_id);
    resolvedName = String(hit.collection_name || '');
  } else {
    const wanted = raw.toLowerCase();
    const matches = collections.filter((c) => String(c?.collection_name || '').trim().toLowerCase() === wanted);
    if (matches.length === 0) {
      const names = collections.map((c) => c?.collection_name).filter(Boolean);
      throw new Error('Collection not found: ' + raw + '. Available: ' + (names.length ? names.join(', ') : '(none)'));
    }
    if (matches.length > 1) {
      const ids = matches.map((c) => c.collection_id).join(', ');
      throw new Error('Multiple collections share the name "' + raw + '" (ids: ' + ids + '). Pass the numeric collection_id explicitly to disambiguate.');
    }
    id = String(matches[0].collection_id);
    resolvedName = String(matches[0].collection_name || raw);
  }

  const fd = new FormData();
  fd.append('module_name', 'collection_settings');
  const res = await fetch('https://www.instagram.com/api/v1/collections/' + encodeURIComponent(id) + '/delete/', {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Failed to delete collection: HTTP ' + res.status + (body ? ' - ' + body.slice(0, 200) : ''));
  }
  const d = await res.json().catch(() => ({}));
  if (d?.status && d.status !== 'ok') {
    throw new Error('Instagram returned non-ok status: ' + JSON.stringify(d).slice(0, 300));
  }
  return [{
    status: 'Deleted',
    collectionId: id,
    collectionName: resolvedName,
  }];
})()
` },
    ],
});
