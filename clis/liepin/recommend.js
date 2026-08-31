/**
 * Liepin recruiter — recommended candidate listing.
 *
 * The production recruiter page loads the active job with the init endpoint,
 * then posts a JSON-encoded query to get-recommend-resumes. Both endpoints
 * require the user's existing Liepin browser cookies.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    LPT_ORIGIN,
    absoluteResumeUrl,
    postForm,
    textOrNull,
} from './utils.js';

const INIT_PATH = '/api/com.liepin.recruitbff.lpt.recommend.init';
const RECOMMEND_PATH = '/api/com.liepin.recruitbff.lpt.recommend.get-recommend-resumes';
const DEFAULT_FILTER = {
    requireWorkYear: ['0'],
    requireDegree: ['000'],
    seekWill: ['000'],
    schoolTag: ['0'],
    graduateRanges: ['-1'],
    jobFrequency: '000',
    industries: ['000'],
    salarys: { name: '不限', code: '0', salaryHigh: 0, salaryLow: 0 },
    minAge: '',
    maxAge: '',
    gender: '000',
};

function normalizeLimit(raw) {
    const limit = raw === undefined || raw === null || raw === '' ? 20 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ArgumentError('liepin limit must be a positive integer');
    }
    if (limit > 20) {
        throw new ArgumentError('liepin limit must be <= 20');
    }
    return limit;
}

function normalizeJobId(raw) {
    const jobId = textOrNull(raw);
    if (jobId && !/^\d+$/.test(jobId)) {
        throw new ArgumentError('liepin jobId must contain digits only');
    }
    return jobId;
}

function resumeIdFromUrl(url) {
    const value = textOrNull(url);
    if (!value) return null;
    try {
        return textOrNull(new URL(value, LPT_ORIGIN).searchParams.get('resIdEncode'));
    } catch {
        return null;
    }
}

function mapCandidate(item, index) {
    const resume = item?.resume;
    if (!resume || typeof resume !== 'object') return null;

    const resumeId = textOrNull(item.resIdEncode)
        ?? resumeIdFromUrl(resume.url)
        ?? textOrNull(resume.enresId);
    const latestWork = Array.isArray(resume.workExpList) ? resume.workExpList[0] : null;
    const desired = resume.jobWant && typeof resume.jobWant === 'object' ? resume.jobWant : {};
    const labels = Array.isArray(resume.label)
        ? textOrNull(resume.label.map(textOrNull).filter(Boolean).join(', '))
        : textOrNull(resume.label);

    return {
        rank: index + 1,
        resume_id: resumeId,
        name: textOrNull(resume.showName),
        active_status: textOrNull(resume.activeStatus),
        age: textOrNull(resume.showAge),
        work_years: textOrNull(resume.workYearsShow),
        degree: textOrNull(resume.eduLevelShow),
        location: textOrNull(resume.cityName),
        desired_location: textOrNull(desired.wantDqName),
        desired_title: textOrNull(desired.wantTitle),
        desired_salary: textOrNull(desired.wantSalary),
        skills: labels,
        latest_company: textOrNull(latestWork?.rwdCompname),
        latest_title: textOrNull(latestWork?.rwdsTitle),
        url: absoluteResumeUrl(resume.url, resumeId),
    };
}

function recommendInput(jobId) {
    return {
        pageSize: 20,
        ejobId: jobId,
        siftConditionVo: DEFAULT_FILTER,
        queryKind: '5',
        operateKind: 'LOGIN',
    };
}

cli({
    site: 'liepin',
    name: 'recommend',
    access: 'read',
    description: '猎聘企业版当前职位的推荐人才（只读）',
    domain: 'api-lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'jobId', type: 'string', default: '', help: '招聘职位 ID；默认使用页面当前职位' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量（1-20）' },
    ],
    columns: [
        'rank', 'resume_id', 'name', 'active_status', 'age', 'work_years', 'degree',
        'location', 'desired_location', 'desired_title', 'desired_salary', 'skills',
        'latest_company', 'latest_title', 'url',
    ],
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit);
        const requestedJobId = normalizeJobId(args.jobId);
        const initPayload = await postForm(page, INIT_PATH, requestedJobId ? { ejobId: requestedJobId } : {});
        const jobId = requestedJobId ?? textOrNull(initPayload?.data?.ejobId);
        if (!jobId) {
            throw new EmptyResultError('liepin recommend', '当前猎聘账号没有可用于推荐的招聘职位');
        }

        const payload = await postForm(page, RECOMMEND_PATH, {
            lpRecommendQueryInputVo: JSON.stringify(recommendInput(jobId)),
        });
        if (!Array.isArray(payload?.data?.list)) {
            throw new CommandExecutionError('Liepin recommend response did not include data.list');
        }

        const rows = payload.data.list
            .map((item, index) => mapCandidate(item, index))
            .filter(Boolean)
            .slice(0, limit);
        if (rows.length === 0) {
            throw new EmptyResultError('liepin recommend', `职位 ${jobId} 暂无推荐人才`);
        }
        return rows;
    },
});

export const __test__ = {
    DEFAULT_FILTER,
    mapCandidate,
    normalizeJobId,
    normalizeLimit,
    recommendInput,
};
