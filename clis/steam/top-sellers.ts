import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'steam',
  name: 'top-sellers',
  description: 'Steam top selling games',
  domain: 'store.steampowered.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of games' },
  ],
  columns: ['rank', 'name', 'price', 'discount', 'url'],
  pipeline: [
    { fetch: { url: 'https://store.steampowered.com/api/featuredcategories/' } },
    { select: 'top_sellers.items' },
    { map: {
        rank: '${{ index + 1 }}',
        name: '${{ item.name }}',
        price: '${{ item.final_price }}',
        discount: '${{ item.discount_percent }}',
        url: 'https://store.steampowered.com/app/${{ item.id }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
