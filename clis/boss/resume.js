/**
 * BOSS直聘 resume — view candidate resume/profile via chat page UI scraping (boss side).
 *
 * Flow: navigate to chat page → click on candidate → scrape the right panel info.
 *
 * Right panel HTML structure:
 *  .base-info-single-detial → name, gender, age, experience, degree
 *  .experience-content.time-list → time ranges (icon-base-info-work / icon-base-info-edu)
 *  .experience-content.detail-list → details (company·position / school·major·degree)
 *  .position-content → job being discussed + expectation
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, navigateToChat, findFriendByUid, clickCandidateInList } from './utils.js';
cli({
    site: 'boss',
    name: 'resume',
    description: 'BOSS直聘查看候选人简历（招聘端）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'uid', required: true, positional: true, help: 'Encrypted UID of the candidate (from chatlist)' },
    ],
    columns: [
        'name', 'gender', 'age', 'experience', 'degree', 'active_time',
        'work_history', 'education',
        'job_chatting', 'expect',
    ],
    func: async (page, kwargs) => {
        requirePage(page);
        await navigateToChat(page, 3);
        const friend = await findFriendByUid(page, kwargs.uid, { maxPages: 5 });
        if (!friend)
            throw new Error('未找到该候选人，请确认 uid 是否正确');
        const numericUid = friend.uid;
        const clicked = await clickCandidateInList(page, numericUid);
        if (!clicked) {
            throw new Error('无法在聊天列表中找到该用户，请确认聊天列表中有此人');
        }
        await page.wait({ time: 2 });
        // Scrape the right panel
        const resumeInfo = await page.evaluate(`
      (() => {
        const container = document.querySelector('.base-info-single-container') || document.querySelector('.base-info-content');
        if (!container) return { error: 'no container found' };

        const nameEl = container.querySelector('.base-name');
        const name = nameEl ? nameEl.textContent.trim() : '';

        let gender = '';
        const detailDiv = container.querySelector('.base-info-single-detial');
        if (detailDiv) {
          const uses = detailDiv.querySelectorAll('use');
          for (const u of uses) {
            const href = u.getAttribute('xlink:href') || u.getAttribute('href') || '';
            if (href.includes('icon-men')) { gender = '男'; break; }
            if (href.includes('icon-women')) { gender = '女'; break; }
          }
        }

        const activeEl = container.querySelector('.active-time');
        const activeTime = activeEl ? activeEl.textContent.trim() : '';

        let age = '', experience = '', degree = '';
        if (detailDiv) {
          for (const el of detailDiv.children) {
            if (el.classList.contains('name-contet') || el.classList.contains('high-light-orange') ||
                el.classList.contains('resume-btn-content') || el.classList.contains('label-remark-content') ||
                el.classList.contains('base-info-item')) continue;
            const text = el.textContent.trim();
            if (!text) continue;
            if (text.match(/\\d+岁/)) age = text;
            else if (text.match(/年|经验|应届/)) experience = text;
            else if (['博士', '硕士', '本科', '大专', '高中', '中专', '中技', '初中'].some(d => text.includes(d))) degree = text;
          }
        }

        const workTimes = [], eduTimes = [], workDetails = [], eduDetails = [];

        const timeList = container.querySelector('.experience-content.time-list');
        if (timeList) {
          for (const li of timeList.querySelectorAll('li')) {
            const useEl = li.querySelector('use');
            const href = useEl ? (useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '') : '';
            const timeSpan = li.querySelector('.time');
            const timeText = timeSpan ? timeSpan.textContent.trim() : li.textContent.trim();
            if (href.includes('base-info-edu')) eduTimes.push(timeText);
            else workTimes.push(timeText);
          }
        }

        const detailList = container.querySelector('.experience-content.detail-list');
        if (detailList) {
          for (const li of detailList.querySelectorAll('li')) {
            const useEl = li.querySelector('use');
            const href = useEl ? (useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '') : '';
            const valueSpan = li.querySelector('.value');
            const valueText = valueSpan ? valueSpan.textContent.trim() : li.textContent.trim();
            if (href.includes('base-info-edu')) eduDetails.push(valueText);
            else workDetails.push(valueText);
          }
        }

        const workHistory = [];
        for (let i = 0; i < Math.max(workTimes.length, workDetails.length); i++) {
          const parts = [];
          if (workTimes[i]) parts.push(workTimes[i]);
          if (workDetails[i]) parts.push(workDetails[i]);
          if (parts.length) workHistory.push(parts.join('  '));
        }

        const education = [];
        for (let i = 0; i < Math.max(eduTimes.length, eduDetails.length); i++) {
          const parts = [];
          if (eduTimes[i]) parts.push(eduTimes[i]);
          if (eduDetails[i]) parts.push(eduDetails[i]);
          if (parts.length) education.push(parts.join('  '));
        }

        const positionContent = container.querySelector('.position-content');
        let jobChatting = '', expect = '';
        if (positionContent) {
          const posNameEl = positionContent.querySelector('.position-name');
          if (posNameEl) jobChatting = posNameEl.textContent.trim();
          const expectEl = positionContent.querySelector('.position-item.expect .value');
          if (expectEl) expect = expectEl.textContent.trim();
        }

        return { name, gender, age, experience, degree, activeTime, workHistory, education, jobChatting, expect };
      })()
    `);
        if (resumeInfo.error) {
            throw new Error('无法获取简历面板: ' + resumeInfo.error);
        }
        return [{
                name: resumeInfo.name || friend.name || '',
                gender: resumeInfo.gender || '',
                age: resumeInfo.age || '',
                experience: resumeInfo.experience || '',
                degree: resumeInfo.degree || '',
                active_time: resumeInfo.activeTime || '',
                work_history: (resumeInfo.workHistory || []).join('\\n') || '(未获取到)',
                education: (resumeInfo.education || []).join('\\n') || '(未获取到)',
                job_chatting: resumeInfo.jobChatting || '',
                expect: resumeInfo.expect || '',
            }];
    },
});
