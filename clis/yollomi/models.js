import { cli, Strategy } from '@jackwener/opencli/registry';
import { IMAGE_MODELS, VIDEO_MODELS, TOOL_MODELS } from './utils.js';
cli({
    site: 'yollomi',
    name: 'models',
    access: 'read',
    description: 'List available Yollomi AI models (image, video, tools)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'type', default: 'all', choices: ['all', 'image', 'video', 'tool'], help: 'Filter by model type' },
    ],
    columns: ['type', 'model', 'credits', 'description'],
    func: async (kwargs) => {
        const filter = kwargs.type;
        const rows = [];
        if (filter === 'all' || filter === 'image') {
            for (const [id, info] of Object.entries(IMAGE_MODELS)) {
                rows.push({ type: 'image', model: id, credits: info.credits, description: info.description });
            }
        }
        if (filter === 'all' || filter === 'video') {
            for (const [id, info] of Object.entries(VIDEO_MODELS)) {
                rows.push({ type: 'video', model: id, credits: info.credits, description: info.description });
            }
        }
        if (filter === 'all' || filter === 'tool') {
            for (const [id, info] of Object.entries(TOOL_MODELS)) {
                rows.push({ type: 'tool', model: id, credits: info.credits, description: info.description });
            }
        }
        return rows;
    },
});
