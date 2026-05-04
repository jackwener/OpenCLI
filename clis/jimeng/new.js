import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'jimeng',
    name: 'new',
    access: 'write',
    description: '即梦AI 新建会话（workspace）',
    domain: 'jimeng.jianying.com',
    strategy: Strategy.COOKIE,
    browser: true,
    columns: ['workspace_id', 'workspace_url'],
    pipeline: [
        { navigate: 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0' },
        { evaluate: `(async () => {
  const resp = await fetch('/mweb/v1/workspace/create?aid=513695', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(r => r.json());

  if (resp.ret === '1014' || resp.ret === 1014) {
    throw new Error('Not logged in — open jimeng.jianying.com in Chrome and sign in first');
  }
  if (resp.ret !== '0' && resp.ret !== 0) {
    throw new Error('workspace/create failed: ret=' + resp.ret + ' errmsg=' + (resp.errmsg || ''));
  }

  const wsId = resp.data?.workspace_id;
  if (!wsId) {
    throw new Error('workspace/create returned no workspace_id: ' + JSON.stringify(resp).substring(0, 200));
  }

  return [{
    workspace_id: String(wsId),
    workspace_url: 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=' + wsId,
  }];
})()
` },
        { map: {
                workspace_id: '${{ item.workspace_id }}',
                workspace_url: '${{ item.workspace_url }}',
            } },
    ],
});
