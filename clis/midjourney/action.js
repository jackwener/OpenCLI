import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ACTION_CHOICES,
  assertActionPlan,
  assertBudget,
  estimateAction,
  normalizeChoice,
} from './capabilities.js';
import {
  MIDJOURNEY_IMAGINE_URL,
  COMPOSER_SELECTOR,
  clickCreationAction,
  clickComposerSubmit,
  clickVisibleControl,
  cancelMidjourneyJob,
  creditsToFastMinutes,
  fetchHistory,
  fetchJobStatus,
  getMidjourneyAccount,
  inferJobModel,
  inferJobResolution,
  isSettingsPanelVisible,
  isVideoJob,
  jobUrl,
  normalizeBoolean,
  normalizePositiveInt,
  parseImageIndices,
  parseJobId,
  parseReferenceArgument,
  readSiteSettings,
  recordQuotaSnapshot,
  selectSiteSetting,
  submittedJobIdsFromCaptures,
  uploadReferencesToSlot,
  validateLocalReferences,
  waitForCompletedJob,
  waitForDerivedJob,
  toggleSettingsPanel,
  unwrapEvaluateResult,
} from './utils.js';

const IMAGE_ACTIONS = new Set([
  'rerun', 'rerun-hd', 'vary-subtle', 'vary-strong', 'upscale-subtle', 'upscale-creative',
  'open-editor', 'animate-low', 'animate-high', 'loop-low', 'loop-high', 'cancel',
]);
const VIDEO_ACTIONS = new Set(['rerun', 'extend-low', 'extend-high', 'cancel']);
const VIDEO_GENERATION_ACTIONS = new Set([
  'animate-low', 'animate-high', 'loop-low', 'loop-high', 'extend-low', 'extend-high',
]);

const BUTTONS = Object.freeze({
  rerun: ['Rerun', 0],
  'rerun-hd': ['Run batch as HD', 0],
  'vary-subtle': ['Subtle', 0],
  'vary-strong': ['Strong', 0],
  'upscale-subtle': ['Subtle', 1],
  'upscale-creative': ['Creative', 0],
  'open-editor': ['Edit', 0],
  'animate-low': ['Low Motion', 0],
  'animate-high': ['High Motion', 0],
  'loop-low': ['Low Motion', 1],
  'loop-high': ['High Motion', 1],
  'extend-low': ['Low Motion', 0],
  'extend-high': ['High Motion', 0],
});

function actionResult(source, operation, estimatedMinutes, values = {}) {
  const videoAction = VIDEO_GENERATION_ACTIONS.has(operation) || (operation === 'rerun' && isVideoJob(source));
  const parentJobId = Object.prototype.hasOwnProperty.call(values, 'parentJobId')
    ? values.parentJobId
    : source.id ?? null;
  return {
    job_id: values.jobId ?? null,
    parent_job_id: parentJobId,
    status: values.status,
    operation,
    requested_model: inferJobModel(source),
    effective_model: operation === 'open-editor' ? 'v6.1-editor' : videoAction ? 'video' : inferJobModel(source),
    routing_reason: operation === 'open-editor' ? 'editor_uses_v6.1_engine' : null,
    estimated_minutes: estimatedMinutes,
    observed_minutes: values.observedMinutes ?? null,
    index: values.index ?? null,
    file: null,
    url: values.url ?? null,
  };
}

function observedMinutes(before, after) {
  const beforeMinutes = creditsToFastMinutes(before?.total_credits ?? before?.credits_total);
  const afterMinutes = creditsToFastMinutes(after?.total_credits ?? after?.credits_total);
  return beforeMinutes == null || afterMinutes == null ? null : Number(Math.max(0, beforeMinutes - afterMinutes).toFixed(2));
}

async function restoreVideoSettings(page, original, changedResolution, changedBatch) {
  if (!changedResolution && !changedBatch) return;
  await page.goto(MIDJOURNEY_IMAGINE_URL);
  if (changedResolution && original.videoResolution) {
    await selectSiteSetting(page, 'Video Resolution', ['SD', 'HD'], original.videoResolution.toUpperCase());
  }
  if (changedBatch && original.videoBatchSize) {
    await selectSiteSetting(page, 'Video Batch Size', ['1', '2', '4'], String(original.videoBatchSize));
  }
  if (await isSettingsPanelVisible(page).catch(() => false)) {
    await toggleSettingsPanel(page).catch(() => {});
  }
}

async function closeSettingsPanel(page) {
  if (await isSettingsPanelVisible(page).catch(() => false)) {
    await toggleSettingsPanel(page);
  }
}

cli({
  site: 'midjourney',
  name: 'action',
  access: 'write',
  description: 'Run a typed Creation Action: vary, upscale, rerun, edit, animate, loop, extend, or cancel',
  example: 'opencli midjourney action <job> vary-subtle --index 1 --dry-run',
  domain: 'www.midjourney.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: MIDJOURNEY_IMAGINE_URL,
  defaultWindowMode: 'foreground',
  defaultFormat: 'plain',
  args: [
    { name: 'job', positional: true, required: true, help: 'Source job UUID or /jobs/<uuid> URL' },
    { name: 'operation', positional: true, required: true, help: ACTION_CHOICES.join(', ') },
    { name: 'index', default: 1, help: 'Source candidate 1..4' },
    { name: 'video-resolution', default: 'auto', help: 'auto, sd, or hd' },
    { name: 'batch-size', default: 'auto', help: 'auto, 1, 2, or 4' },
    { name: 'prompt', help: 'Manual motion/extension prompt' },
    { name: 'end-frame', help: 'One local path, HTTPS image URL, or Midjourney job URL' },
    { name: 'wait', type: 'boolean', default: true, help: 'Wait for a derived job to complete' },
    { name: 'timeout', type: 'int', default: 300, help: 'Maximum submission/generation seconds (1..900)' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Validate and estimate without clicking the action' },
    { name: 'max-minutes', default: 2, help: 'Maximum estimated Fast GPU minutes allowed' },
    { name: 'reserve-minutes', default: 0, help: 'Minimum Fast GPU minutes to keep after this command' },
  ],
  columns: [
    'job_id', 'parent_job_id', 'status', 'operation', 'requested_model', 'effective_model', 'routing_reason',
    'estimated_minutes', 'observed_minutes', 'index', 'file', 'url',
  ],
  func: async (page, kwargs) => {
    const sourceId = parseJobId(kwargs.job);
    const operation = normalizeChoice(kwargs.operation, '', ACTION_CHOICES, 'operation');
    const timeout = normalizePositiveInt(kwargs.timeout, 300, 900, '--timeout');
    const source = await fetchJobStatus(page, sourceId);
    const sourceVideo = isVideoJob(source);
    if (!(sourceVideo ? VIDEO_ACTIONS : IMAGE_ACTIONS).has(operation)) {
      throw new ArgumentError(`${operation} is not available for a ${sourceVideo ? 'video' : 'image'} job`);
    }
    const sourceStatus = String(source.current_status || source.status || '').toLowerCase();
    if (operation === 'cancel') {
      if (!['queued', 'running', 'in_progress', 'pending'].includes(sourceStatus)) {
        throw new ArgumentError(`Job ${sourceId} is ${sourceStatus || 'not cancellable'}; cancel only applies to active jobs`);
      }
    } else if (sourceStatus !== 'completed') {
      throw new ArgumentError(`${operation} requires a completed source job; current status is ${sourceStatus || 'missing'}`);
    }
    if (kwargs.prompt && !VIDEO_GENERATION_ACTIONS.has(operation)) {
      throw new ArgumentError('--prompt only applies to animate, loop, or extend actions');
    }
    const endFrameRefs = await validateLocalReferences(
      parseReferenceArgument(kwargs['end-frame'], '--end-frame', { multiple: false }),
      '--end-frame',
    );
    if (endFrameRefs.length && !VIDEO_GENERATION_ACTIONS.has(operation)) {
      throw new ArgumentError('--end-frame only applies to animate, loop, or extend actions');
    }

    const index = parseImageIndices(kwargs.index, Number(source.batch_size || 4));
    if (index.length !== 1) throw new ArgumentError('action --index must select exactly one candidate from 1..4');
    if (['upscale-subtle', 'upscale-creative'].includes(operation) && inferJobResolution(source) === 'hd') {
      throw new ArgumentError('HD image jobs do not offer an additional Upscale action');
    }
    const sourceModel = inferJobModel(source);
    const sourceUsesOmni = /(?:^|\s)--oref\s+/i.test(String(source.full_command || ''));
    if (operation === 'rerun-hd' && !['v8.1', 'v8.2'].includes(sourceModel)) {
      throw new ArgumentError('Run batch as HD is only available for V8.1/V8.2 image jobs');
    }

    if (operation === 'cancel') {
      if (normalizeBoolean(kwargs['dry-run'])) {
        return [actionResult(source, operation, 0, { status: 'planned', index: index[0] + 1 })];
      }
      await cancelMidjourneyJob(page, sourceId);
      let current = source;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.wait(0.25);
        current = await fetchJobStatus(page, sourceId);
        const status = String(current.current_status || current.status || '').toLowerCase();
        if (['cancelled', 'canceled', 'failed', 'error'].includes(status)) break;
      }
      const status = String(current.current_status || current.status || '').toLowerCase();
      const reportedStatus = ['failed', 'error', 'cancelled', 'canceled'].includes(status)
        ? 'cancelled'
        : ['queued', 'running', 'in_progress', 'pending'].includes(status)
          ? 'cancel_requested'
          : status;
      return [actionResult(source, operation, 0, {
        jobId: sourceId,
        parentJobId: source.parent_id || null,
        status: reportedStatus,
        index: index[0] + 1,
        url: jobUrl(sourceId, index[0]),
      })];
    }

    const account = await getMidjourneyAccount(page);
    const originalSettings = await readSiteSettings(page);
    await closeSettingsPanel(page);
    const videoResolution = normalizeChoice(
      kwargs['video-resolution'],
      'auto',
      ['auto', 'sd', 'hd'],
      '--video-resolution',
    );
    const effectiveVideoResolution = videoResolution === 'auto' ? (originalSettings.videoResolution || 'sd') : videoResolution;
    let batchSize = kwargs['batch-size'];
    if (batchSize == null || batchSize === '' || String(batchSize).toLowerCase() === 'auto') {
      batchSize = originalSettings.videoBatchSize || 1;
    } else {
      batchSize = Number(batchSize);
      if (![1, 2, 4].includes(batchSize)) throw new ArgumentError('--batch-size must be auto, 1, 2, or 4');
    }
    const touchesVideoSettings = VIDEO_GENERATION_ACTIONS.has(operation) || (operation === 'rerun' && sourceVideo);
    if (touchesVideoSettings && (
      !['sd', 'hd'].includes(originalSettings.videoResolution)
      || ![1, 2, 4].includes(originalSettings.videoBatchSize)
    )) {
      throw new CommandExecutionError(
        'Midjourney video settings could not be read safely; refusing to mutate account-wide defaults without a restorable baseline.',
      );
    }
    const capabilities = assertActionPlan(account, operation, { videoResolution: effectiveVideoResolution });
    if (effectiveVideoResolution === 'hd' && !capabilities.canHdVideo && sourceVideo && operation === 'rerun') {
      throw new ArgumentError(`${capabilities.plan || 'current'} plan does not support HD video`);
    }
    const estimated = estimateAction(operation, {
      videoResolution: effectiveVideoResolution,
      batchSize,
      sourceIsVideo: sourceVideo,
      sourceUsesOmni,
    });
    assertBudget(account, estimated, kwargs['max-minutes'], kwargs['reserve-minutes'], creditsToFastMinutes);

    if (normalizeBoolean(kwargs['dry-run'])) {
      return [actionResult(source, operation, estimated, { status: 'planned', index: index[0] + 1 })];
    }

    let changedResolution = false;
    let changedBatch = false;
    let childId = null;
    let submittedAt = null;
    let primaryError = null;
    try {
      if (VIDEO_GENERATION_ACTIONS.has(operation) || (operation === 'rerun' && sourceVideo)) {
        // Mark restoration from the observed baseline before attempting either
        // click. A click can mutate the account-wide value and still fail its
        // post-click verification, so assigning only after success would skip
        // the finally-path restoration precisely when it is most needed.
        changedResolution = videoResolution !== 'auto'
          && originalSettings.videoResolution !== effectiveVideoResolution;
        changedBatch = String(kwargs['batch-size']).toLowerCase() !== 'auto'
          && originalSettings.videoBatchSize !== batchSize;
        if (videoResolution !== 'auto') {
          await selectSiteSetting(page, 'Video Resolution', ['SD', 'HD'], effectiveVideoResolution.toUpperCase());
        }
        if (String(kwargs['batch-size']).toLowerCase() !== 'auto') {
          await selectSiteSetting(page, 'Video Batch Size', ['1', '2', '4'], String(batchSize));
        }
      }
      await closeSettingsPanel(page);
      if (estimated > 0) await recordQuotaSnapshot(account, 'action-before');
      const recent = await fetchHistory(page, account.user_id, 50);
      const baselineIds = new Set(recent.map((job) => String(job.id || '').toLowerCase()).filter(Boolean));
      await page.goto(jobUrl(sourceId, index[0]));
      await page.wait(1);

      let captureReady = false;
      if (operation !== 'open-editor'
        && typeof page.installInterceptor === 'function'
        && typeof page.getInterceptedRequests === 'function') {
        try {
          await page.installInterceptor('/api/submit-jobs');
          await page.getInterceptedRequests();
          captureReady = true;
        } catch {}
      }

      // Loop/Extend shortcuts have intermittently accepted a native click
      // without sending /api/submit-jobs. The manual composer is deterministic
      // and lets us explicitly verify every relevant option.
      const manual = operation.startsWith('loop-') || operation.startsWith('extend-')
        || (VIDEO_GENERATION_ACTIONS.has(operation) && (Boolean(kwargs.prompt) || endFrameRefs.length > 0));
      const [buttonText, occurrence] = manual
        ? [operation.startsWith('extend-') ? 'Extend Manually' : 'Animate Manually', 0]
        : BUTTONS[operation];
      submittedAt = Date.now();
      try {
        await clickCreationAction(page, buttonText, occurrence);
        if (manual) {
          await page.wait(0.6);
          let manualPrompt = String(kwargs.prompt || '').trim();
          if (!manualPrompt) {
            manualPrompt = String(await page.evaluate(() => document.querySelector('#desktop_input_bar')?.value || '')).trim();
          }
          const remoteEnd = endFrameRefs.find((ref) => ref.kind === 'url')?.value;
          if (remoteEnd && !/(?:^|\s)--end\s+/i.test(manualPrompt)) manualPrompt = `${manualPrompt} --end ${remoteEnd}`.trim();
          if (manualPrompt) {
            const filled = await page.fillText(COMPOSER_SELECTOR, manualPrompt);
            if (!filled?.filled || !filled?.verified) throw new Error('manual video prompt fill was not verified');
          }
          const localEnd = endFrameRefs.filter((ref) => ref.kind === 'local').map((ref) => ref.value);
          if (localEnd.length) await uploadReferencesToSlot(page, localEnd, 'end');
          if (operation.startsWith('loop-')) {
            const loopChecked = await page.evaluate(() => Boolean(document.querySelector('input[type="checkbox"]')?.checked));
            if (!loopChecked) await clickVisibleControl(page, 'Loop');
          }
          await clickVisibleControl(page, operation.endsWith('-high') ? 'High' : 'Low');
          await clickComposerSubmit(page);
        }
      } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        throw new CommandExecutionError(`Could not run Midjourney action ${operation}: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (operation === 'open-editor') {
        await page.wait(0.5);
        const editorUrl = String(unwrapEvaluateResult(await page.evaluate(() => location.href)) || '');
        if (!editorUrl.startsWith(`${MIDJOURNEY_IMAGINE_URL.replace('/imagine', '/edit/')}${sourceId}`)) {
          throw new CommandExecutionError(`Midjourney editor did not open for job ${sourceId}`);
        }
        return [actionResult(source, operation, estimated, {
          jobId: sourceId,
          parentJobId: source.parent_id || null,
          status: 'opened',
          index: index[0] + 1,
          url: editorUrl,
        })];
      }
      if (captureReady && typeof page.waitForCapture === 'function') {
        try {
          await page.waitForCapture(Math.min(timeout, 20));
          [childId] = submittedJobIdsFromCaptures(await page.getInterceptedRequests(), 1, baselineIds);
        } catch (error) {
          if (error instanceof CommandExecutionError) throw error;
        }
      }
      if (!childId) {
        childId = await waitForDerivedJob(
          page,
          account.user_id,
          sourceId,
          baselineIds,
          Math.min(timeout, 90),
          submittedAt,
        );
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      // Video actions temporarily mutate account-wide defaults. Always put
      // them back, including when preparation, submission, or correlation fails.
      try {
        await restoreVideoSettings(page, originalSettings, changedResolution, changedBatch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Once a paid child id is known, surfacing restoration as command
        // failure would encourage an accidental duplicate. Preserve the job
        // result and make the account-wide setting risk explicit instead.
        if (childId || primaryError) {
          log.warn(`Could not restore Midjourney video defaults: ${message}`);
        } else {
          throw error;
        }
      }
    }
    if (!normalizeBoolean(kwargs.wait, true)) {
      const afterSubmit = await getMidjourneyAccount(page);
      await recordQuotaSnapshot(afterSubmit, 'action-after-submit');
      return [actionResult(source, operation, estimated, {
        jobId: childId,
        status: 'submitted',
        observedMinutes: observedMinutes(account, afterSubmit),
        index: index[0] + 1,
        url: jobUrl(childId),
      })];
    }

    const elapsedSeconds = (Date.now() - submittedAt) / 1000;
    const remainingSeconds = Math.floor(timeout - elapsedSeconds);
    if (remainingSeconds < 1) {
      throw new TimeoutError(
        `Midjourney action ${operation}`,
        timeout,
        `The child job ${childId} was submitted; check it with \`opencli midjourney status ${childId}\`.`,
      );
    }
    await waitForCompletedJob(page, childId, remainingSeconds);
    const after = await getMidjourneyAccount(page);
    await recordQuotaSnapshot(after, 'action-after');
    return [actionResult(source, operation, estimated, {
      jobId: childId,
      status: 'completed',
      observedMinutes: observedMinutes(account, after),
      index: index[0] + 1,
      url: jobUrl(childId),
    })];
  },
});
