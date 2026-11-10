import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { absoluteResumeUrl, postForm, requiredText, valueFrom } from './utils.js';

const RESUME_PATH = '/api/com.liepin.rresume.usere.pc.resume-view';

function mapResume(payload, requestedId) {
    const data = payload?.data;
    const resume = data?.resumeData ?? data?.resumeInfo ?? data?.resume ?? data;
    if (!resume || typeof resume !== 'object') {
        throw new CommandExecutionError('Liepin resume response did not include resume data');
    }
    const basic = resume.basicInfo ?? resume.baseInfo ?? resume;
    const wanted = resume.jobWant ?? resume.expectInfo ?? {};
    const current = resume.workExpList?.[0] ?? resume.workExperienceList?.[0] ?? {};
    const resumeId = valueFrom([resume, basic], ['resIdEncode', 'enresId', 'resumeId']) ?? requestedId;
    return {
        resume_id: resumeId,
        opposite_im_id: valueFrom([resume, basic], ['oppositeImId', 'imId', 'usercImId']),
        name: valueFrom([basic, resume], ['showName', 'name', 'resumeName']),
        age: valueFrom([basic, resume], ['showAge', 'age']),
        work_years: valueFrom([basic, resume], ['workYearsShow', 'workyears', 'workYears']),
        degree: valueFrom([basic, resume], ['eduLevelShow', 'eduLevelName', 'degree']),
        location: valueFrom([basic, resume], ['dqName', 'cityName', 'location']),
        desired_title: valueFrom([wanted, resume], ['wantTitle', 'wantJobTitle', 'desiredTitle']),
        desired_salary: valueFrom([wanted, resume], ['wantSalary', 'desiredSalary']),
        latest_company: valueFrom([current, resume], ['rwdCompname', 'compName', 'latestCompany']),
        latest_title: valueFrom([current, resume], ['rwdsTitle', 'jobTitle', 'latestTitle']),
        url: absoluteResumeUrl(valueFrom([resume], ['resumeUrl', 'url']), resumeId),
    };
}

cli({
    site: 'liepin',
    name: 'resume',
    access: 'read',
    description: '读取猎聘人才简历摘要',
    domain: 'api-lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'resumeId', type: 'string', required: true, positional: true, help: '加密简历 ID' },
        { name: 'jobId', type: 'string', default: '', help: '关联招聘职位 ID（可选）' },
    ],
    columns: [
        'resume_id', 'opposite_im_id', 'name', 'age', 'work_years', 'degree',
        'location', 'desired_title', 'desired_salary', 'latest_company', 'latest_title', 'url',
    ],
    func: async (page, args) => {
        const resumeId = requiredText(args.resumeId, 'resumeId');
        const payload = await postForm(page, RESUME_PATH, {
            pageParamVo: JSON.stringify({
                resIdEncode: resumeId,
                ...(args.jobId ? { ejobId: String(args.jobId) } : {}),
            }),
        }, `https://lpt.liepin.com/resume/detail?resIdEncode=${encodeURIComponent(resumeId)}`);
        return [mapResume(payload, resumeId)];
    },
});

export const __test__ = { mapResume };
