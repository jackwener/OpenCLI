import { describe, expect, it } from 'vitest';
import { __test__ } from './greet-search-results.js';

describe('liepin greet-search-results state helpers', () => {
    it('allows only the job-selection dialog to proceed automatically', () => {
        expect(__test__.classifyDialog('请选择开聊职位\n生鲜价格策略专家')).toBe('job_selection');
    });

    it('requires a human for the paid contact-information dialog', () => {
        expect(__test__.classifyDialog('意向人选简历提示\n获取人选联系方式')).toBe('needs_human');
    });

    it('does not plan a duplicate greeting for an already-contacted card', () => {
        expect(__test__.planCandidateAction('继续沟通')).toBe('already_contacted');
    });

    it('plans without clicking in dry-run mode', () => {
        expect(__test__.planCandidateAction('立即沟通', true)).toBe('planned');
    });
});
