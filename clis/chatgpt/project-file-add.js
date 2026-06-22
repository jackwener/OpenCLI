import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    parseChatGPTProjectId,
    uploadChatGPTProjectFiles,
} from './utils.js';

function parseFilePaths(value) {
    if (Array.isArray(value)) {
        return value.flatMap(item => parseFilePaths(item));
    }
    return String(value ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export const projectFileAddCommand = cli({
    site: 'chatgpt',
    name: 'project-file-add',
    access: 'write',
    description: 'Upload files to a ChatGPT project as project knowledge (not just conversation attachments)',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'file', positional: true, required: true, help: 'Local file path(s) to upload; comma-separated paths are supported' },
        { name: 'id', required: true, help: 'Project ID or /g/g-p-<id> URL' },
    ],
    columns: ['Status', 'File'],
    func: async (page, kwargs) => {
        const filePaths = parseFilePaths(kwargs.file);
        if (!filePaths.length) {
            throw new ArgumentError(
                'chatgpt project-file-add requires at least one file path',
                'Example: opencli chatgpt project-file-add report.pdf --id 12345678',
            );
        }

        const projectId = parseChatGPTProjectId(kwargs.id);

        let upload;
        try {
            upload = await uploadChatGPTProjectFiles(page, projectId, filePaths);
        } catch (err) {
            throw new CommandExecutionError(
                `Failed to upload file to ChatGPT project knowledge: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        if (upload?.inputError) {
            throw new ArgumentError(
                upload.reason || 'Invalid project file path',
                'Provide an existing local file path that ChatGPT project knowledge can upload.',
            );
        }

        if (!upload?.ok) {
            throw new CommandExecutionError(
                upload?.reason || 'Failed to upload file to ChatGPT project knowledge',
                `Open ${CHATGPT_URL}/g/g-p-${projectId} and verify the project accepts file uploads. If your browser needs a proxy, configure it outside this command.`,
            );
        }

        return upload.files.map(file => ({
            Status: '📄 uploaded to project knowledge',
            File: file,
        }));
    },
});
