import { cli, Strategy } from '../../registry.js';

const BUILTIN_MODELS = [
  {
    name: 'tsubaki2',
    id: '1983308862240288769',
    type: 'DIT',
    description: 'Strong prompt understanding, seamless anatomy, wide stylistic adaptability',
  },
  {
    name: 'haruka',
    id: '1861558740588989558',
    type: 'SDXL',
    description: 'Stable quality, refined details, accurate hands',
  },
  {
    name: 'hoshino',
    id: '1954632828118619567',
    type: 'SDXL',
    description: 'Popular Japanese style',
  },
];

cli({
  site: 'pixai',
  name: 'models',
  description: 'List available PixAI image generation models',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['name', 'id', 'type', 'description'],
  func: async () => {
    return BUILTIN_MODELS;
  },
});
