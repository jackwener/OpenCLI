import { CliError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

const API_V2_BASE = 'https://api.pixai.art/v2';
const API_V1_BASE = 'https://api.pixai.art/v1';

const MODEL_ALIASES: Record<string, string> = {
  tsubaki2: '1983308862240288769',
  haruka: '1861558740588989558',
  hoshino: '1954632828118619567',
};

function resolveModelId(input: string): string {
  return MODEL_ALIASES[input.toLowerCase()] ?? input;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

cli({
  site: 'pixai',
  name: 'generate',
  description: 'Generate an AI image via PixAI API',
  strategy: Strategy.PUBLIC,
  browser: false,
  requiredEnv: [{ name: 'PIXAI_API_KEY', help: 'PixAI API key from https://pixai.art' }],
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Text description of the image' },
    { name: 'model', default: 'tsubaki2', help: 'Model name or ID (tsubaki2, haruka, hoshino, or custom ID)' },
    { name: 'negative-prompt', help: 'What to avoid in the image' },
    {
      name: 'aspect-ratio',
      default: '1:1',
      help: 'Image aspect ratio',
      choices: ['1:1', '3:4', '4:3', '3:5', '5:3', '9:16', '16:9', '1:3', '3:1'],
    },
    {
      name: 'mode',
      default: 'standard',
      help: 'Inference quality/speed tradeoff',
      choices: ['lite', 'standard', 'pro', 'ultra'],
    },
    { name: 'seed', type: 'int', help: 'Seed for reproducible results' },
    { name: 'poll-interval', type: 'int', default: 3, help: 'Seconds between status checks' },
  ],
  columns: ['status', 'task_id', 'model', 'media_url'],
  func: async (_page, args) => {
    const apiKey = process.env.PIXAI_API_KEY;
    if (!apiKey) throw new CliError('AUTH_REQUIRED', 'PIXAI_API_KEY not set', 'Export PIXAI_API_KEY or visit https://pixai.art to get one');

    const modelId = resolveModelId(args.model);
    const body: Record<string, unknown> = {
      modelId,
      prompt: args.prompt,
      aspectRatio: args['aspect-ratio'],
      mode: args.mode,
    };
    if (args['negative-prompt']) body.negativePrompt = args['negative-prompt'];
    if (args.seed != null) body.seed = Number(args.seed);

    // Create image task
    const createResp = await fetch(`${API_V2_BASE}/image/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!createResp.ok) {
      const text = await createResp.text();
      throw new CliError('API_ERROR', `Create task failed: HTTP ${createResp.status}`, text);
    }
    const task = (await createResp.json()) as { id: string; status: string };
    const taskId = task.id;

    // Poll for completion
    const interval = Number(args['poll-interval']) * 1000;
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(interval);
      const pollResp = await fetch(`${API_V1_BASE}/task/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!pollResp.ok) {
        throw new CliError('API_ERROR', `Poll failed: HTTP ${pollResp.status}`);
      }
      const result = (await pollResp.json()) as {
        id: string;
        status: string;
        outputs?: { mediaIds?: string[]; mediaUrls?: (string | null)[] };
      };

      if (result.status === 'completed') {
        const mediaId = result.outputs?.mediaIds?.[0];
        const mediaUrl = mediaId ? `${API_V1_BASE}/media/${mediaId}/image` : result.outputs?.mediaUrls?.[0] ?? '';
        return [
          {
            status: 'completed',
            task_id: taskId,
            model: args.model,
            media_url: mediaUrl,
          },
        ];
      }
      if (result.status === 'failed' || result.status === 'cancelled') {
        throw new CliError('TASK_FAILED', `Task ${result.status}`, `Task ID: ${taskId}`);
      }
    }

    throw new CliError('TIMEOUT', 'Task did not complete in time', `Task ID: ${taskId}`);
  },
});
