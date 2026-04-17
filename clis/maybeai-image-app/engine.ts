import { CliError } from '@jackwener/opencli/errors';
import { getApp } from './catalog.js';
import { readWorkflowOptions } from './common.js';
import { resolveImageAppInput } from './resolver.js';
import { buildSecondStepVariablesV2, extractGeneratedImages, filterWorkflowVariables, WorkflowClient } from './workflow-client.js';
import { getWorkflowProfile } from './workflow-profiles.js';

export async function executeGenerate(appId: string, input: Record<string, unknown>, kwargs: Record<string, unknown>, debug = false) {
  const app = getApp(appId);
  const workflow = getWorkflowProfile(appId);
  const resolved = resolveImageAppInput(appId, input);
  const client = new WorkflowClient(readWorkflowOptions(kwargs));
  let debugData: Record<string, unknown> = {};
  let rawResults: unknown[];

  if (workflow.mode === 'direct') {
    ({ rawResults, debugData } = await runDirectWorkflow(client, app, workflow, resolved.variables, typeof kwargs['task-id'] === 'string' ? kwargs['task-id'] : undefined, debug));
  } else {
    ({ rawResults, debugData } = await runTwoStepWorkflow(client, app, workflow, resolved.variables, typeof kwargs['task-id'] === 'string' ? kwargs['task-id'] : undefined, debug));
  }

  const images = extractGeneratedImages(rawResults, app.output.backendFields);
  const result: Record<string, unknown> = {
    app: app.id,
    title: app.title,
    mode: workflow.mode,
    images,
    resolvedInput: resolved.input,
    modelProfile: resolved.modelProfile,
    warnings: resolved.warnings,
  };
  if (debug) {
    result.debug = {
      workflow,
      resolvedVariables: resolved.variables,
      outputFields: app.output.backendFields,
      ...debugData,
    };
  }
  if (images.length === 0 && !debug) {
    throw new CliError('WORKFLOW_RUN', 'Workflow completed but no generated image URL was found', JSON.stringify(rawResults).slice(0, 1000));
  }
  if (images.length === 0) result.warning = 'Workflow completed but no generated image URL was found';
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
  if (debug) {
    const workflowDetail = await client.fetchWorkflowDetail(workflow.resultArtifactId);
    debugData = {
      request: {
        taskId,
        artifactId: workflow.resultArtifactId,
        workflowId: workflowDetail.id,
        variablesBeforeFilter: variables,
        variablesAfterFilter: filterWorkflowVariables(workflowDetail, variables),
        service: workflow.service,
      },
    };
  }
  const rawResults = await client.run({
    artifactId: workflow.resultArtifactId,
    variables,
    appId: app.id,
    title: app.title,
    taskId,
    service: workflow.service,
  });
  if (debug) debugData.rawResults = rawResults;
  return { rawResults, debugData };
}

async function runTwoStepWorkflow(
  client: WorkflowClient,
  app: ReturnType<typeof getApp>,
  workflow: ReturnType<typeof getWorkflowProfile>,
  variables: Array<{ name: string; default_value: unknown }>,
  taskId: string | undefined,
  debug: boolean,
) {
  const promptTaskId = crypto.randomUUID();
  const debugData: Record<string, any> = {};

  if (debug) {
    const promptWorkflowDetail = await client.fetchWorkflowDetail(workflow.promptArtifactId);
    debugData.promptStep = {
      request: {
        taskId: promptTaskId,
        artifactId: workflow.promptArtifactId,
        workflowId: promptWorkflowDetail.id,
        variablesBeforeFilter: variables,
        variablesAfterFilter: filterWorkflowVariables(promptWorkflowDetail, variables),
        service: workflow.service,
        useSystemAuth: false,
      },
    };
  }

  const promptConfigs = await client.run({
    artifactId: workflow.promptArtifactId,
    variables,
    appId: app.id,
    title: app.title,
    taskId: promptTaskId,
    useSystemAuth: false,
    service: workflow.service,
  });
  if (promptConfigs.length === 0) throw new CliError('WORKFLOW_RUN', 'Prompt workflow returned no prompt configs', `App: ${app.id}, task_id: ${promptTaskId}`);
  const promptConfigDicts = promptConfigs.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  if (promptConfigDicts.length === 0) throw new CliError('WORKFLOW_RUN', 'Prompt workflow returned no structured prompt configs', JSON.stringify(promptConfigs).slice(0, 1000));

  const includeLlmModel = app.fields.some(field => field.backendVariable === 'variable:scalar:llm_model');
  const secondStepVariables = buildSecondStepVariablesV2(promptConfigDicts, variables, app.id, includeLlmModel);

  if (debug) {
    const resultWorkflowDetail = await client.fetchWorkflowDetail(workflow.resultArtifactId);
    debugData.promptStep.rawResults = promptConfigs;
    debugData.promptStep.promptConfigDicts = promptConfigDicts;
    debugData.resultStep = {
      request: {
        taskId,
        prevTaskId: promptTaskId,
        artifactId: workflow.resultArtifactId,
        workflowId: resultWorkflowDetail.id,
        variablesBeforeFilter: secondStepVariables,
        variablesAfterFilter: filterWorkflowVariables(resultWorkflowDetail, secondStepVariables),
        service: workflow.service,
      },
    };
  }

  try {
    const rawResults = await client.run({
      artifactId: workflow.resultArtifactId,
      variables: secondStepVariables,
      appId: app.id,
      title: app.title,
      taskId,
      prevTaskId: promptTaskId,
      service: workflow.service,
    });
    if (debug) {
      debugData.resultStep.rawResults = rawResults;
      debugData.secondStepVariables = secondStepVariables;
    }
    return { rawResults, debugData };
  } catch (error) {
    if (error instanceof CliError) throw new CliError(error.code, error.message, [error.hint, `promptTaskId: ${promptTaskId}`].filter(Boolean).join(' | '));
    throw error;
  }
}
