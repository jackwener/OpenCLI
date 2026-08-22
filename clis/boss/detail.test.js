import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__, extractRenderedJob } from './detail.js';
import './detail.js';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/detail.html'), 'utf8');
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

describe('boss detail', () => {
  const command = getRegistry().get('boss/detail');

  it('is registered as a read-only rendered-page command', () => {
    expect(command).toMatchObject({ access: 'read', strategy: Strategy.UI });
  });

  it('normalizes the rendered detail snapshot into the documented row', () => {
    const row = __test__.domSnapshotToRow({
      jobName: ' 数据分析实习生 ', salaryText: '150-200/天',
      cityText: '上海', experienceText: '在校/应届', degreeText: '本科',
      descriptionText: '负责数据分析', skillTexts: ['SQL', 'SQL'], welfareTexts: ['餐补', '餐补'],
      recruiterName: '张三', recruiterTitle: '技术负责人', recruiterActiveTime: '刚刚活跃', companyName: 'OpenCLI',
    }, 'job-id');
    // Flat scalar columns only: the table/plain/csv/markdown renderers coerce
    // each cell with String(v) (src/output.ts), so a nested object column would
    // print as [object Object] in the default output.
    expect(Object.keys(row)).toHaveLength(17);
    expect(row).toMatchObject({
      name: '数据分析实习生', city: '上海', experience: '在校/应届', degree: '本科',
      skills: 'SQL', welfare: '餐补',
      boss_name: '张三', boss_title: '技术负责人', active_time: '刚刚活跃',
      company: 'OpenCLI', url: 'https://www.zhipin.com/job_detail/job-id.html',
    });
    for (const value of Object.values(row)) {
      expect(typeof value === 'object' && value !== null).toBe(false);
    }
  });

  it('extracts current BOSS detail selectors from a sanitized live-page fixture', () => {
    const dom = new JSDOM(fixture, { url: 'https://www.zhipin.com/job_detail/job-id.html' });
    globalThis.document = dom.window.document;

    expect(extractRenderedJob()).toMatchObject({
      jobName: '供应链实习生', salaryText: '180-230元/天', cityText: '上海',
      experienceText: '5天/周 6个月', degreeText: '本科', companyName: 'OpenCLI',
      recruiterName: '张女士', recruiterActiveTime: '本周活跃', addressText: '上海示例路 8 号',
      skillTexts: ['供应链/物流类专业', '采购/供应商管理经验'],
      welfareTexts: ['五险一金', '餐补'],
    });
  });

  it('reads the rendered current job page instead of the retired detail API', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        jobName: '数据分析实习生', salaryText: '150-200/天', cityText: '上海', experienceText: '在校/应届', degreeText: '本科',
        descriptionText: '负责数据分析', skillTexts: ['SQL'], welfareTexts: ['餐补'], companyName: 'OpenCLI',
      }),
    };
    const rows = await command.func(page, { 'security-id': 'job-id' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.zhipin.com/web/geek/jobs');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.zhipin.com/job_detail/job-id.html');
    expect(rows[0]).toMatchObject({ name: '数据分析实习生', company: 'OpenCLI' });
  });

  it('rejects malformed detail ids before navigation', async () => {
    await expect(command.func({ goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn() }, {
      'security-id': '../write-action',
    })).rejects.toThrow(ArgumentError);
  });
});
