import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  assertBudget,
  buildEffectivePrompt,
  normalizeWeight,
  resolveGenerationPlan,
} from './capabilities.js';
import {
  COMPOSER_SELECTOR,
  MIDJOURNEY_IMAGINE_URL,
  assertGenerationEntitlement,
  clearImagePrompts,
  closeImagePanel,
  creditsToFastMinutes,
  displayPath,
  downloadOriginals,
  ensureImageComposer,
  fetchHistory,
  getMidjourneyAccount,
  getVisibleJobIds,
  jobUrl,
  normalizeBoolean,
  normalizePositiveInt,
  normalizePrompt,
  parseImageIndices,
  parseReferenceArgument,
  readSiteSettings,
  recordQuotaSnapshot,
  resolveOutputDir,
  submittedJobIdsFromCaptures,
  uploadReferencesToSlot,
  validateLocalReferences,
  waitForCompletedJob,
  waitForSubmittedJobsAfter,
  toggleSettingsPanel,
} from './utils.js';

function byKind(refs, kind) {
  return refs.filter((ref) => ref.kind === kind).map((ref) => ref.value);
}

function observedMinutes(before, after) {
  const beforeMinutes = creditsToFastMinutes(before?.total_credits ?? before?.credits_total);
  const afterMinutes = creditsToFastMinutes(after?.total_credits ?? after?.credits_total);
  if (beforeMinutes == null || afterMinutes == null) return null;
  return Number(Math.max(0, beforeMinutes - afterMinutes).toFixed(2));
}

function resultBase(plan, values = {}) {
  return {
    job_id: values.jobId ?? null,
    parent_job_id: null,
    status: values.status,
    operation: 'generate',
    requested_model: plan.requestedModel,
    effective_model: plan.effectiveModel,
    routing_reason: plan.routingReason,
    estimated_minutes: plan.estimatedMinutes,
    observed_minutes: values.observedMinutes ?? null,
    index: values.index ?? null,
    file: values.file ?? null,
    url: values.url ?? null,
  };
}

cli({
  site: 'midjourney',
  name: 'generate',
  access: 'write',
  description: 'Generate Midjourney images with references, model routing, cost guards, recovery, and optional download',
  example: 'opencli midjourney generate "a blue ceramic teapot --ar 1:1" --dry-run',
  domain: 'www.midjourney.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: MIDJOURNEY_IMAGINE_URL,
  defaultWindowMode: 'background',
  defaultFormat: 'plain',
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Prompt with any native Midjourney --parameters' },
    { name: 'model', default: 'auto', help: 'auto, v8.2, v8.1, v7, v6.1, v6, niji7, or niji6' },
    { name: 'resolution', default: 'auto', help: 'auto, sd, or hd' },
    { name: 'speed', default: 'auto', help: 'auto, fast, relax, or turbo' },
    { name: 'image-ref', help: 'Local path, HTTPS URL, job URL, or JSON array' },
    { name: 'style-ref', help: 'Local path, HTTPS URL, job URL, style code, or JSON array' },
    { name: 'omni-ref', help: 'Exactly one local path, HTTPS URL, or job URL; auto routes to V7' },
    { name: 'image-weight', help: 'Image Prompt weight, 0..3' },
    { name: 'style-weight', help: 'Style Reference weight, 0..1000' },
    { name: 'omni-weight', help: 'Omni Reference weight, 0..1000' },
    { name: 'profile', help: 'Personalization profile or Moodboard ID' },
    { name: 'repeat', type: 'int', help: 'Repeat/permutation job count; defaults to 1 (plan limit applies)' },
    { name: 'wait', type: 'boolean', default: true, help: 'Wait for completion; false returns after unique job association' },
    { name: 'index', default: 'all', help: 'Download candidate 1..4 or all' },
    { name: 'output', default: '~/Pictures/Midjourney', help: 'Output directory' },
    { name: 'skip-download', type: 'boolean', default: false, help: 'Do not write completed images' },
    { name: 'timeout', type: 'int', default: 300, help: 'Maximum submission/generation seconds (1..900)' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Validate and estimate without uploading or submitting' },
    { name: 'max-minutes', default: 2, help: 'Maximum estimated Fast GPU minutes allowed' },
    { name: 'reserve-minutes', default: 0, help: 'Minimum Fast GPU minutes to keep after this command' },
    { name: 'force', type: 'boolean', default: false, help: 'Overwrite existing non-empty output files' },
  ],
  columns: [
    'job_id', 'parent_job_id', 'status', 'operation', 'requested_model', 'effective_model', 'routing_reason',
    'estimated_minutes', 'observed_minutes', 'index', 'file', 'url',
  ],
  func: async (page, kwargs) => {
    const prompt = normalizePrompt(kwargs.prompt);
    const timeout = normalizePositiveInt(kwargs.timeout, 300, 900, '--timeout');
    const imageRefs = await validateLocalReferences(
      parseReferenceArgument(kwargs['image-ref'], '--image-ref'),
      '--image-ref',
    );
    const styleRefs = await validateLocalReferences(
      parseReferenceArgument(kwargs['style-ref'], '--style-ref', { allowStyleCode: true }),
      '--style-ref',
    );
    const omniRefs = await validateLocalReferences(
      parseReferenceArgument(kwargs['omni-ref'], '--omni-ref', { multiple: false }),
      '--omni-ref',
    );
    kwargs['image-weight'] = normalizeWeight(kwargs['image-weight'], 0, 3, '--image-weight');
    kwargs['style-weight'] = normalizeWeight(kwargs['style-weight'], 0, 1000, '--style-weight');
    kwargs['omni-weight'] = normalizeWeight(kwargs['omni-weight'], 0, 1000, '--omni-weight');

    const account = await getMidjourneyAccount(page);
    assertGenerationEntitlement(account);
    await ensureImageComposer(page);
    const settings = await readSiteSettings(page);
    await toggleSettingsPanel(page).catch(() => {});
    const plan = resolveGenerationPlan({
      prompt,
      args: kwargs,
      hasOmniReference: omniRefs.length > 0,
      account,
      siteModel: settings.model,
      siteResolution: settings.imageResolution,
      siteSpeed: settings.speed,
    });
    assertBudget(account, plan.estimatedMinutes, kwargs['max-minutes'], kwargs['reserve-minutes'], creditsToFastMinutes);

    const remoteReferences = {
      image: byKind(imageRefs, 'url'),
      style: [...byKind(styleRefs, 'url'), ...byKind(styleRefs, 'styleCode')],
      omni: byKind(omniRefs, 'url'),
    };
    const effectivePrompt = buildEffectivePrompt(prompt, plan, kwargs, remoteReferences);
    if (normalizeBoolean(kwargs['dry-run'])) {
      return [resultBase(plan, { status: 'planned' })];
    }

    const commandStartedAt = Date.now();
    await recordQuotaSnapshot(account, 'generate-before');
    const recent = await fetchHistory(page, account.user_id, 30);
    const baselineIds = new Set(recent.map((job) => String(job.id || '').toLowerCase()).filter(Boolean));
    for (const id of await getVisibleJobIds(page).catch(() => [])) baselineIds.add(id);

    try {
      await page.wait({ selector: COMPOSER_SELECTOR, timeout: 12 });
    } catch {
      throw new CommandExecutionError(
        'Midjourney Imagine composer was not found.',
        `Open ${MIDJOURNEY_IMAGINE_URL} in Chrome and confirm the signed-in composer is visible.`,
      );
    }

    const localImageRefs = byKind(imageRefs, 'local');
    const localStyleRefs = byKind(styleRefs, 'local');
    const localOmniRefs = byKind(omniRefs, 'local');
    // The persistent web composer may contain references staged manually or
    // left by an interrupted command. Clear it for every paid submission so
    // an argument-free generation cannot inherit hidden browser state.
    await clearImagePrompts(page);
    if (localImageRefs.length || localStyleRefs.length || localOmniRefs.length) {
      await uploadReferencesToSlot(page, localImageRefs, 'image');
      await uploadReferencesToSlot(page, localStyleRefs, 'style');
      await uploadReferencesToSlot(page, localOmniRefs, 'omni');
    }
    await closeImagePanel(page);

    let captureReady = false;
    if (typeof page.installInterceptor === 'function' && typeof page.getInterceptedRequests === 'function') {
      try {
        await page.installInterceptor('/api/submit-jobs');
        await page.getInterceptedRequests();
        captureReady = true;
      } catch {}
    }

    const submittedAt = Date.now();
    try {
      const filled = await page.fillText(COMPOSER_SELECTOR, effectivePrompt);
      if (!filled?.filled || !filled?.verified) throw new Error('composer fill was not verified');
      await page.pressKey('Enter');
    } catch (error) {
      throw new CommandExecutionError(`Could not submit the Midjourney prompt: ${error instanceof Error ? error.message : String(error)}`);
    }

    const remainingForSubmission = Math.floor(timeout - (Date.now() - commandStartedAt) / 1000);
    if (remainingForSubmission < 1) throw new TimeoutError('Midjourney job submission', timeout);
    const submitTimeout = Math.min(remainingForSubmission, 75);
    let jobIds = [];
    if (captureReady && typeof page.waitForCapture === 'function') {
      try {
        await page.waitForCapture(Math.min(submitTimeout, 20));
        jobIds = submittedJobIdsFromCaptures(await page.getInterceptedRequests(), plan.repeat, baselineIds);
      } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
      }
    }
    if (!jobIds.length) {
      jobIds = await waitForSubmittedJobsAfter(
        page,
        account.user_id,
        effectivePrompt,
        baselineIds,
        submitTimeout,
        submittedAt,
        plan.repeat,
      );
    }

    if (!normalizeBoolean(kwargs.wait, true)) {
      const after = await getMidjourneyAccount(page);
      await recordQuotaSnapshot(after, 'generate-after-submit');
      return jobIds.map((jobId) => resultBase(plan, {
        jobId,
        status: 'submitted',
        observedMinutes: observedMinutes(account, after),
        url: jobUrl(jobId),
      }));
    }

    const jobs = [];
    for (const jobId of jobIds) {
      const remainingSeconds = Math.floor(timeout - (Date.now() - commandStartedAt) / 1000);
      if (remainingSeconds < 1) {
        throw new TimeoutError(
          'Midjourney generation',
          timeout,
          `Submitted job ${jobId}; check it with \`opencli midjourney status ${jobId}\`.`,
        );
      }
      jobs.push(await waitForCompletedJob(page, jobId, remainingSeconds));
    }
    const after = await getMidjourneyAccount(page);
    await recordQuotaSnapshot(after, 'generate-after');
    const observed = observedMinutes(account, after);

    if (normalizeBoolean(kwargs['skip-download'])) {
      return jobIds.map((jobId) => resultBase(plan, {
        jobId,
        status: 'completed',
        observedMinutes: observed,
        url: jobUrl(jobId),
      }));
    }

    const outputDir = resolveOutputDir(kwargs.output);
    const rows = [];
    for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
      const jobId = jobIds[jobIndex];
      const indices = parseImageIndices(kwargs.index, Number(jobs[jobIndex].batch_size || 4));
      const files = await downloadOriginals(page, jobId, indices, outputDir, normalizeBoolean(kwargs.force));
      rows.push(...files.map((item) => resultBase(plan, {
        jobId,
        status: 'completed',
        observedMinutes: observed,
        index: item.index + 1,
        file: displayPath(item.filePath),
        url: item.url,
      })));
    }
    return rows;
  },
});
