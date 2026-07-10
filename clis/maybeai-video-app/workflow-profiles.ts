import { CliError } from '@jackwener/opencli/errors';

function directWorkflowProfile(app: string, artifactId: string) {
  return {
    app,
    mode: 'direct',
    artifactId,
    service: 'e-commerce',
  } as const;
}

function threeStepWorkflowProfile(app: string, storyboardArtifactId: string, clipArtifactId: string, concatArtifactId: string) {
  return {
    app,
    mode: 'three-step',
    storyboardArtifactId,
    clipArtifactId,
    concatArtifactId,
    service: 'e-commerce',
  } as const;
}

export const WORKFLOW_PROFILES = {
  'video-remake': {
    app: 'video-remake',
    mode: 'tool-chain',
    service: 'e-commerce',
  },
  'product-ad-video': threeStepWorkflowProfile('product-ad-video', '6968a73c165033d5172b0f3c', '6968a817b35049b72546cc2c', '6968a7ebb35049b72546c7e3'),
  'listing-video': threeStepWorkflowProfile('listing-video', '6968a73c165033d5172b0f3c', '6968a817b35049b72546cc2c', '6968a7ebb35049b72546c7e3'),
  'ugc-ad-video': threeStepWorkflowProfile('ugc-ad-video', '6968a73c165033d5172b0f3c', '6968a817b35049b72546cc2c', '6968a7ebb35049b72546c7e3'),
  'image-to-video': directWorkflowProfile('image-to-video', '6968a817b35049b72546cc2c'),
} as const;

export function getWorkflowProfile(appId: string) {
  const profile = WORKFLOW_PROFILES[appId as keyof typeof WORKFLOW_PROFILES];
  if (!profile) throw new CliError('ARGUMENT', `No workflow profile for maybeai-video-app app: ${appId}`);
  return profile;
}
