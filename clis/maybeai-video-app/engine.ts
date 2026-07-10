import { CliError } from '@jackwener/opencli/errors';
import { getApp } from './catalog.js';
import { resolveVideoAppInput } from './resolver.js';
import { getWorkflowProfile } from './workflow-profiles.js';
import { readWorkflowOptions } from '../maybeai/shared/options.js';
import { extractGeneratedVideos, filterWorkflowVariables, WorkflowClient } from '../maybeai/shared/workflow-client.js';
import { parseMCPImageUrl, parseMCPVideoUrl, readToolClientOptions, type ScriptShot, ToolClient } from '../maybeai/shared/tool-client.js';

const IMAGE_TOOL_ID = 'maybe_image_generation__generate_image_from_images';
const VIDEO_TOOL_ID = 'maybe_text2video_generation__generate_video_from_reference_image';
const CONCAT_VIDEO_TOOL_ID = 'audio_toolkit__concat_videos';

export async function executeGenerate(appId: string, input: Record<string, unknown>, kwargs: Record<string, unknown>, debug = false) {
  const app = getApp(appId);
  const workflow = getWorkflowProfile(appId);
  const resolved = resolveVideoAppInput(appId, input);
  if (workflow.mode === 'tool-chain') {
    return executeVideoRemakeToolChain(appId, resolved.input, kwargs, debug);
  }
  const client = new WorkflowClient(readWorkflowOptions(kwargs));
  let debugData: Record<string, unknown> = {};
  let rawResults: unknown[];
  let storyboardRows: Record<string, unknown>[] = [];
  let clipRows: Record<string, unknown>[] = [];

  if (workflow.mode === 'direct') {
    ({ rawResults, debugData } = await runDirectWorkflow(client, app, workflow, resolved.variables, typeof kwargs['task-id'] === 'string' ? kwargs['task-id'] : undefined, debug));
  } else if (workflow.mode === 'three-step') {
    ({ rawResults, storyboardRows, clipRows, debugData } = await runThreeStepWorkflow(client, app, workflow, resolved, typeof kwargs['task-id'] === 'string' ? kwargs['task-id'] : undefined, debug));
  } else {
    throw new CliError('ARGUMENT', 'Unsupported workflow mode');
  }

  const videos = extractGeneratedVideos(rawResults, app.output.backendFields);
  const result: Record<string, unknown> = {
    app: app.id,
    title: app.title,
    mode: workflow.mode,
    videos,
    resolvedInput: resolved.input,
    modelProfile: resolved.modelProfile,
    warnings: resolved.warnings,
  };
  if (storyboardRows.length > 0) result.storyboard = storyboardRows;
  if (clipRows.length > 0) result.clips = clipRows;
  if (debug) {
    result.debug = {
      workflow,
      resolvedVariables: resolved.variables,
      outputFields: app.output.backendFields,
      ...debugData,
    };
  }
  if (videos.length === 0 && !debug) {
    throw new CliError('WORKFLOW_RUN', 'Workflow completed but no generated video URL was found', JSON.stringify(rawResults).slice(0, 1000));
  }
  if (videos.length === 0) result.warning = 'Workflow completed but no generated video URL was found';
  return result;
}

async function executeVideoRemakeToolChain(appId: string, input: Record<string, unknown>, kwargs: Record<string, unknown>, debug: boolean) {
  const app = getApp(appId);
  const taskId = typeof kwargs['task-id'] === 'string' && kwargs['task-id'].trim() ? kwargs['task-id'].trim() : crypto.randomUUID();
  const client = new ToolClient(readToolClientOptions(kwargs, 'video-analysis-and-replication'));
  const ratio = String(input.ratio ?? '9:16');
  const duration = Math.max(1, Math.round(Number(input.duration ?? 5)));
  const productImages = [String(input.product)].filter(Boolean);
  const referenceImages = typeof input.person === 'string' && input.person ? [input.person] : [];
  const referenceVideos = [String(input.reference_video)].filter(Boolean);
  const generateAudio = Boolean(kwargs['generate-audio']);
  const debugData: Record<string, unknown> = {};

  if (referenceVideos.length !== 1) {
    throw new CliError('ARGUMENT', 'video-remake requires exactly one reference_video', 'Pass --reference-video or include reference_video in --input JSON.');
  }

  const scriptInput = buildScriptGenerationUserInput(String(input.prompt ?? ''), ratio, referenceImages.length > 0);
  const script = await client.generateVideoScript({
    taskId,
    productImages,
    referenceImages,
    referenceVideos,
    userInput: scriptInput,
    seconds: duration,
    mode: 'copy',
  });
  if (script.shots.length === 0) throw new CliError('WORKFLOW_RUN', 'Video script API returned no shots', JSON.stringify(script).slice(0, 1000));
  if (debug) debugData.script = script;

  const mainImageResult = await client.callMcpTool(taskId, IMAGE_TOOL_ID, {
    prompt: referenceImages.length > 0 ? buildMainImagePromptWithModel(script.main_image_prompt, ratio) : buildMainImagePromptWithoutModel(script.main_image_prompt, ratio),
    image_urls: [...productImages, ...referenceImages],
    aspect_ratio: ratio,
  });
  const mainImage = parseMCPImageUrl(mainImageResult);
  if (debug) debugData.mainImage = { url: mainImage, raw: mainImageResult };

  const shotResults: Array<Record<string, unknown>> = [];
  for (const shot of script.shots) {
    const hasStoryboardReference = isRemoteUrl(shot.technical_specs?.consistency_anchor);
    const shotImageResult = await client.callMcpTool(taskId, IMAGE_TOOL_ID, {
      prompt: buildShotImagePrompt(shot, script.main_image_prompt, ratio, referenceImages.length > 0, hasStoryboardReference),
      image_urls: buildReferenceUrls([...productImages, mainImage], shot.technical_specs?.consistency_anchor),
      aspect_ratio: ratio,
    });
    const shotImage = parseMCPImageUrl(shotImageResult);
    const shotVideoResult = await client.callMcpTool(taskId, VIDEO_TOOL_ID, {
      model: input.engine,
      prompt: buildShotVideoPrompt(shot, ratio),
      image_urls: [shotImage],
      aspect_ratio: ratio,
      duration: Math.max(1, Math.round(Number(shot.duration_sec ?? duration))),
      generate_audio: generateAudio,
      elements: buildVideoElements(productImages, mainImage),
    });
    const shotVideo = parseMCPVideoUrl(shotVideoResult);
    shotResults.push({
      shot_id: shot.shot_id,
      sequence: shot.sequence,
      duration_sec: shot.duration_sec,
      image_url: shotImage,
      video_url: shotVideo,
      source_reference: shot.technical_specs?.consistency_anchor,
    });
  }

  const shotVideoUrls = shotResults.map(item => item.video_url).filter((url): url is string => typeof url === 'string' && url.length > 0);
  const finalVideo = shotVideoUrls.length === 1
    ? shotVideoUrls[0]
    : parseMCPVideoUrl(await client.callMcpTool(taskId, CONCAT_VIDEO_TOOL_ID, {
        video_urls: shotVideoUrls,
        output_format: 'mp4',
        aspect_ratio: ratio,
        speed_preset: 'faster',
        quality_crf: 23,
      }));

  const result: Record<string, unknown> = {
    app: app.id,
    title: app.title,
    mode: 'tool-chain',
    videos: [{ type: 'video', url: finalVideo, raw: { shotVideos: shotVideoUrls } }],
    mainImage,
    script: script.script,
    shots: shotResults,
    resolvedInput: input,
    warnings: [],
  };
  if (debug) result.debug = debugData;
  return result;
}

async function runDirectWorkflow(
  client: WorkflowClient,
  app: ReturnType<typeof getApp>,
  workflow: ReturnType<typeof getWorkflowProfile>,
  variables: Array<{ name: string; default_value: unknown }>,
  taskId: string | undefined,
  debug: boolean,
) {
  let debugData: Record<string, unknown> = {};
  if (debug && workflow.mode === 'direct') {
    const workflowDetail = await client.fetchWorkflowDetail(workflow.artifactId);
    debugData = {
      request: {
        taskId,
        artifactId: workflow.artifactId,
        workflowId: workflowDetail.id,
        variablesBeforeFilter: variables,
        variablesAfterFilter: filterWorkflowVariables(workflowDetail, variables),
        service: workflow.service,
      },
    };
  }
  if (workflow.mode !== 'direct') throw new CliError('ARGUMENT', `Expected direct workflow mode, got ${workflow.mode}`);
  const rawResults = await client.run({
    artifactId: workflow.artifactId,
    variables,
    appId: app.id,
    title: app.title,
    taskId,
    service: workflow.service,
  });
  if (debug) debugData.rawResults = rawResults;
  return { rawResults, debugData };
}

async function runThreeStepWorkflow(
  client: WorkflowClient,
  app: ReturnType<typeof getApp>,
  workflow: ReturnType<typeof getWorkflowProfile>,
  resolved: ReturnType<typeof resolveVideoAppInput>,
  taskId: string | undefined,
  debug: boolean,
) {
  if (workflow.mode !== 'three-step') throw new CliError('ARGUMENT', `Expected three-step workflow mode, got ${workflow.mode}`);
  const storyboardTaskId = crypto.randomUUID();
  const clipTaskId = crypto.randomUUID();
  const finalTaskId = taskId || crypto.randomUUID();
  const debugData: Record<string, any> = {};

  if (debug) {
    const storyboardDetail = await client.fetchWorkflowDetail(workflow.storyboardArtifactId);
    debugData.storyboardStep = {
      request: {
        taskId: storyboardTaskId,
        artifactId: workflow.storyboardArtifactId,
        workflowId: storyboardDetail.id,
        variablesBeforeFilter: resolved.variables,
        variablesAfterFilter: filterWorkflowVariables(storyboardDetail, resolved.variables),
        service: workflow.service,
      },
    };
  }

  const storyboardResults = await client.run({
    artifactId: workflow.storyboardArtifactId,
    variables: resolved.variables,
    appId: app.id,
    title: `${app.title} storyboard`,
    taskId: storyboardTaskId,
    service: workflow.service,
  });
  const storyboardRows = toRecordRows(storyboardResults);
  if (storyboardRows.length === 0) throw new CliError('WORKFLOW_RUN', 'Storyboard workflow returned no structured shot rows', JSON.stringify(storyboardResults).slice(0, 1000));

  const clipVariables = buildClipStepVariables(app.id, storyboardRows, resolved.input);
  if (debug) {
    const clipDetail = await client.fetchWorkflowDetail(workflow.clipArtifactId);
    debugData.storyboardStep.rawResults = storyboardRows;
    debugData.clipStep = {
      request: {
        taskId: clipTaskId,
        prevTaskId: storyboardTaskId,
        artifactId: workflow.clipArtifactId,
        workflowId: clipDetail.id,
        variablesBeforeFilter: clipVariables,
        variablesAfterFilter: filterWorkflowVariables(clipDetail, clipVariables),
        service: workflow.service,
      },
    };
  }

  const clipResults = await client.run({
    artifactId: workflow.clipArtifactId,
    variables: clipVariables,
    appId: app.id,
    title: `${app.title} clips`,
    taskId: clipTaskId,
    prevTaskId: storyboardTaskId,
    service: workflow.service,
  });
  const clipRows = toRecordRows(clipResults);
  if (clipRows.length === 0) throw new CliError('WORKFLOW_RUN', 'Clip workflow returned no structured video rows', JSON.stringify(clipResults).slice(0, 1000));

  const concatVariables = buildConcatStepVariables(app.id, clipRows);
  if (debug) {
    const concatDetail = await client.fetchWorkflowDetail(workflow.concatArtifactId);
    debugData.clipStep.rawResults = clipRows;
    debugData.concatStep = {
      request: {
        taskId: finalTaskId,
        prevTaskId: clipTaskId,
        artifactId: workflow.concatArtifactId,
        workflowId: concatDetail.id,
        variablesBeforeFilter: concatVariables,
        variablesAfterFilter: filterWorkflowVariables(concatDetail, concatVariables),
        service: workflow.service,
      },
    };
  }

  const rawResults = await client.run({
    artifactId: workflow.concatArtifactId,
    variables: concatVariables,
    appId: app.id,
    title: `${app.title} concat`,
    taskId: finalTaskId,
    prevTaskId: clipTaskId,
    service: workflow.service,
  });

  if (debug) debugData.concatStep.rawResults = rawResults;
  return { rawResults, storyboardRows, clipRows, debugData };
}

export function buildClipStepVariables(appId: string, storyboardRows: Record<string, unknown>[], input: Record<string, unknown>) {
  return [
    { name: 'variable:scalar:case', default_value: appId },
    { name: 'variable:dataframe:input_data', default_value: storyboardRows },
    { name: 'variable:scalar:aspect_ratio', default_value: input.ratio },
    { name: 'variable:scalar:duration', default_value: Math.max(1, Math.round(Number(input.duration ?? 5))) },
    { name: 'variable:scalar:llm_model', default_value: input.engine },
  ];
}

export function buildConcatStepVariables(appId: string, clipRows: Record<string, unknown>[]) {
  return [
    { name: 'variable:scalar:case', default_value: appId },
    { name: 'variable:dataframe:input_data', default_value: clipRows },
  ];
}

function toRecordRows(results: unknown[]) {
  return results.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function buildScriptGenerationUserInput(userDescription: string, ratio: string, hasModelReference: boolean) {
  const markerInstruction = hasModelReference
    ? 'Use @model for the reference person/model and @product for the product when writing shot descriptions.'
    : 'Do not output @model. Use @product only for the product, and preserve any person already implied by the reference video.';
  return [
    userDescription,
    markerInstruction,
    'Mode: copy the reference video structure, timing, camera language, rhythm, and storyboard intent while replacing the product with the supplied product references.',
    `All shots must be designed for aspect ratio ${ratio}. Set shots.technical_specs.aspect_ratio to exactly "${ratio}" for every shot.`,
    'Keep each storyboard field concise and production-ready.',
  ].filter(Boolean).join('\n\n');
}

function buildMainImagePromptWithModel(mainImagePrompt: string, ratio: string) {
  return [
    mainImagePrompt || 'Show the reference model and product naturally in the same frame.',
    'Full-body main image. The entire person must be visible from head to toe, including both feet.',
    'Use a seamless pure white studio background only.',
    `Generate the final image in ${ratio}.`,
  ].join('\n');
}

function buildMainImagePromptWithoutModel(mainImagePrompt: string, ratio: string) {
  return [
    mainImagePrompt || 'Create a clean product-only main image on a seamless pure white background using only the supplied product reference images.',
    'Do not add any model, person, mannequin, hands, or body parts unless the reference video shot itself requires preserving an existing human subject later.',
    'Keep product identity, silhouette, material, texture, color, print, logo, hardware, and construction faithful to the supplied references.',
    `Generate the final image in ${ratio}.`,
  ].join('\n');
}

function buildShotImagePrompt(shot: ScriptShot, mainImagePrompt: string, ratio: string, hasModelReference: boolean, hasStoryboardReference: boolean) {
  const visual = shot.visual_prompt ?? {};
  return [
    hasModelReference ? 'Use the fused main image as the source of truth for the model/person and product identity.' : 'Use the product main image as the source of truth for product identity.',
    mainImagePrompt,
    hasStoryboardReference
      ? 'Preserve the original storyboard reference layout, camera angle, framing, pose, scene structure, background, lighting direction, and action intent. Replace only the product/model identity as requested.'
      : 'No original storyboard reference image is provided. Compose the shot from the text below.',
    `Shot: ${shot.sequence ?? shot.shot_id}`,
    shot.narrative_context,
    `Subject: ${visual.subject ?? ''}`,
    `Environment: ${visual.environment ?? ''}`,
    `Action: ${visual.action ?? ''}`,
    `Camera angle: ${visual.angle ?? ''}`,
    `Camera movement: ${visual.camera_movement ?? ''}`,
    `Lighting: ${visual.lighting ?? ''}`,
    visual.physics_simulation ? `Physics: ${visual.physics_simulation}` : '',
    `Aspect ratio: ${ratio}`,
    'Do not render visible shot IDs, subtitles, labels, captions, watermarks, or explanatory text.',
  ].filter(Boolean).join('\n');
}

function buildShotVideoPrompt(shot: ScriptShot, ratio: string) {
  const visual = shot.visual_prompt ?? {};
  return [
    `Shot: ${shot.sequence ?? shot.shot_id}`,
    shot.narrative_context,
    `Subject: ${visual.subject ?? ''}`,
    `Environment: ${visual.environment ?? ''}`,
    `Action: ${visual.action ?? ''}`,
    `Camera movement: ${visual.camera_movement ?? ''}`,
    `Camera angle: ${visual.angle ?? ''}`,
    `Lighting: ${visual.lighting ?? ''}`,
    `Aspect ratio: ${ratio}`,
    shot.audio_prompt ? `Audio mood: ${shot.audio_prompt}` : '',
  ].filter(Boolean).join('\n').replace(/@product/g, '@Element1').replace(/@model/g, '@Element2');
}

function buildVideoElements(productImages: string[], mainImage: string) {
  const extraProductImages = productImages.slice(1);
  return [
    {
      frontal_image_url: productImages[0] || '',
      reference_image_urls: extraProductImages.length > 0 ? extraProductImages : productImages[0] ? [productImages[0]] : [],
    },
    {
      frontal_image_url: mainImage || '',
      reference_image_urls: mainImage ? [mainImage] : [],
    },
  ];
}

function buildReferenceUrls(baseUrls: string[], storyboardReference?: string) {
  const urls = baseUrls.filter(isRemoteUrl);
  if (isRemoteUrl(storyboardReference)) urls.push(storyboardReference);
  return urls;
}

function isRemoteUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value.trim());
}
