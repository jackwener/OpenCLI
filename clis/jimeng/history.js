import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'jimeng',
    name: 'history',
    access: 'read',
    description: '即梦AI 查看最近生成的作品',
    domain: 'jimeng.jianying.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 5 },
    ],
    columns: ['prompt', 'model', 'status', 'image_url', 'created_at'],
    pipeline: [
        { navigate: 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0' },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const res = await fetch('/mweb/v1/get_history?aid=513695&device_platform=web&region=cn&da_version=3.3.11&web_version=7.5.0&aigc_features=app_lip_sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cursor: '', count: limit, need_page_item: true, need_aigc_data: true, aigc_mode_list: ['workbench'] })
  });
  const data = await res.json();
  const items = data?.data?.history_list || [];
  return items.slice(0, limit).map(item => {
    const params = item.aigc_image_params?.text2image_params || {};
    const images = item.image?.large_images || [];
    return {
      prompt: params.prompt || item.common_attr?.title || 'N/A',
      model: params.model_config?.model_name || 'unknown',
      status: item.common_attr?.status === 102 ? 'completed' : 'pending',
      image_url: images[0]?.image_url || '',
      created_at: new Date((item.common_attr?.create_time || 0) * 1000).toLocaleString('zh-CN'),
    };
  });
})()
` },
        { map: {
                prompt: '${{ item.prompt }}',
                model: '${{ item.model }}',
                status: '${{ item.status }}',
                image_url: '${{ item.image_url }}',
                created_at: '${{ item.created_at }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
