import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xiaoe',
  name: 'detail',
  description: '小鹅通课程详情（名称、价格、学员数、店铺）',
  domain: 'h5.xet.citv.cn',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, positional: true, help: '课程页面 URL' },
  ],
  columns: ['name', 'price', 'original_price', 'user_count', 'shop_name'],
  pipeline: [
    { navigate: '${{ args.url }}' },
    { wait: 5 },
    { evaluate: `(() => {
  var vm = (document.querySelector('#app') || {}).__vue__;
  if (!vm || !vm.$store) return [];
  var core = vm.$store.state.coreInfo || {};
  var goods = vm.$store.state.goodsInfo || {};
  var shop = ((vm.$store.state.compositeInfo || {}).shop_conf) || {};
  return [{
    name: core.resource_name || '',
    resource_id: core.resource_id || '',
    resource_type: core.resource_type || '',
    cover: core.resource_img || '',
    user_count: core.user_count || 0,
    price: goods.price ? (goods.price / 100).toFixed(2) : '0',
    original_price: goods.line_price ? (goods.line_price / 100).toFixed(2) : '0',
    is_free: goods.is_free || 0,
    shop_name: shop.shop_name || '',
  }];
})()
` },
  ],
});
