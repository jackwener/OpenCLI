import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './detail.js';
import './detail.js';

describe('boss detail', () => {
  it('normalizes the rendered detail snapshot into the documented row', () => {
    expect(__test__.domSnapshotToRow({
      name: ' 数据分析实习生 ', salary: '150-200/天',
      city: '上海', experience: '在校/应届', degree: '本科',
      description: '负责数据分析', skills: ['SQL', 'SQL'], welfare: ['餐补', '餐补'],
      boss_name: '张三', boss_title: '技术负责人', active_time: '刚刚活跃', company: 'OpenCLI',
    }, 'job-id')).toMatchObject({
      name: '数据分析实习生', city: '上海', experience: '在校/应届', degree: '本科',
      skills: 'SQL', welfare: '餐补', boss_name: '张三', active_time: '刚刚活跃',
      company: 'OpenCLI', url: 'https://www.zhipin.com/job_detail/job-id.html',
    });
  });

  it('reads the rendered current job page instead of the retired detail API', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        name: '数据分析实习生', salary: '150-200/天', city: '上海', experience: '在校/应届', degree: '本科',
        description: '负责数据分析', skills: ['SQL'], welfare: ['餐补'], company: 'OpenCLI',
      }),
    };
    const command = getRegistry().get('boss/detail');
    const rows = await command.func(page, { 'security-id': 'job-id' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.zhipin.com/web/geek/jobs');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.zhipin.com/job_detail/job-id.html');
    expect(rows[0]).toMatchObject({ name: '数据分析实习生', company: 'OpenCLI' });
  });
});
