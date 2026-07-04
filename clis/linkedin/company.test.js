import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './company.js';

const { normalizeCompanyUrl } = await import('./company.js').then((m) => m.__test__);

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        // assertLinkedInAuthenticated + the extraction both call evaluate; the
        // first returns the auth-wall boolean (false = authed), the second the info.
        evaluate: vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(evaluateResult),
    };
}

describe('linkedin company', () => {
    it('normalizes bare name, path, and URL to the about page', () => {
        expect(normalizeCompanyUrl('nvidia')).toBe('https://www.linkedin.com/company/nvidia/about/');
        expect(normalizeCompanyUrl('/company/nvidia')).toBe('https://www.linkedin.com/company/nvidia/about/');
        expect(normalizeCompanyUrl('https://www.linkedin.com/company/databricks/')).toBe('https://www.linkedin.com/company/databricks/about/');
    });

    it('rejects empty or malformed company identifiers', () => {
        expect(() => normalizeCompanyUrl('')).toThrow(CommandExecutionError);
        expect(() => normalizeCompanyUrl('bad name!')).toThrow(CommandExecutionError);
        expect(() => normalizeCompanyUrl('https://www.linkedin.com/in/someone/')).toThrow(CommandExecutionError);
    });

    it('maps extracted company facts to a row', async () => {
        const cmd = getRegistry().get('linkedin/company');
        expect(cmd?.func).toBeTypeOf('function');
        const page = makePage({
            url: 'https://www.linkedin.com/company/nvidia/about/',
            name: 'NVIDIA',
            industry: 'Computer Hardware Manufacturing',
            size: '10,001+ employees',
            headquarters: 'Santa Clara, CA',
            founded: '1993',
            website: 'http://www.nvidia.com',
            specialties: 'GPU, AI',
            followers: '42040089',
            about: 'Accelerated computing.',
        });
        await expect(cmd.func(page, { company: 'nvidia' })).resolves.toEqual([
            {
                name: 'NVIDIA',
                industry: 'Computer Hardware Manufacturing',
                size: '10,001+ employees',
                headquarters: 'Santa Clara, CA',
                founded: '1993',
                website: 'http://www.nvidia.com',
                specialties: 'GPU, AI',
                followers: 42040089,
                about: 'Accelerated computing.',
                url: 'https://www.linkedin.com/company/nvidia/about/',
            },
        ]);
    });

    it('throws when no company name is found', async () => {
        const cmd = getRegistry().get('linkedin/company');
        const page = makePage({ url: 'x', name: '', industry: '' });
        await expect(cmd.func(page, { company: 'ghost' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
