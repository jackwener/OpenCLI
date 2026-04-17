import { CliError } from '@jackwener/opencli/errors';

function workflowProfile(app: string, promptArtifactId: string, resultArtifactId: string) {
  return {
    app,
    mode: promptArtifactId === resultArtifactId ? 'direct' : 'two-step-v2',
    promptArtifactId,
    resultArtifactId,
    service: 'e-commerce',
  } as const;
}

export const WORKFLOW_PROFILES = {
  'try-on': workflowProfile('try-on', '69d4d48587747a74ba79d84e', '694e206fc1c0b24dc831ad8b'),
  'change-model': workflowProfile('change-model', '694caf01b7c2c3990ca7b8bf', '694e206fc1c0b24dc831ad8b'),
  'mix-match': workflowProfile('mix-match', '694e437fb7c2c3990cab8603', '695b4b0a1189bc43eb96a480'),
  'change-action': workflowProfile('change-action', '69cb41fbd03ef955b10c1d9a', '694e206fc1c0b24dc831ad8b'),
  'change-product': workflowProfile('change-product', '694cb498c1c0b24dc82f4264', '694e206fc1c0b24dc831ad8b'),
  'change-background': workflowProfile('change-background', '69cb69222a1008a8834cfe60', '694e206fc1c0b24dc831ad8b'),
  'gen-main': workflowProfile('gen-main', '694cb52eb7c2c3990ca7e9b7', '694e206fc1c0b24dc831ad8b'),
  'replica-listing-image': workflowProfile('replica-listing-image', '69785a42a065c9922a4b5e5f', '69785a42a065c9922a4b5e5f'),
  'gen-scene': workflowProfile('gen-scene', '694cb7f4b7c2c3990ca7f709', '694e206fc1c0b24dc831ad8b'),
  'gen-details': workflowProfile('gen-details', '694e63e8c1c0b24dc8337f72', '694e7d10c83c43d81d214a92'),
  'details-selling-points': workflowProfile('details-selling-points', '694e47f0b7c2c3990cabaadb', '694e7d10c83c43d81d214a92'),
  'add-selling-points': workflowProfile('add-selling-points', '694cbce8b7c2c3990ca8053a', '694e7d10c83c43d81d214a92'),
  'gen-multi-angles': workflowProfile('gen-multi-angles', '694e671eb7c2c3990cac9972', '69899d16de11a7737bfac704'),
  'gen-size-compare': workflowProfile('gen-size-compare', '694e6591b7c2c3990cac8f24', '694e7d10c83c43d81d214a92'),
  'gen-reference': workflowProfile('gen-reference', '6942333aabc626bb4bb9b7ca', '69424cd0abc626bb4bba8c03'),
  'creative-image-generation': workflowProfile('creative-image-generation', '6981b9fb92f155d6c596b031', '6981b9fb92f155d6c596b031'),
  'pattern-extraction': workflowProfile('pattern-extraction', '698066d65c435e0365a509df', '698066d65c435e0365a509df'),
  'pattern-fission': workflowProfile('pattern-fission', '69807f235c435e0365a5ab75', '69807f235c435e0365a5ab75'),
  'scene-fission': workflowProfile('scene-fission', '69818dbc641f9ed0ce150361', '69818dbc641f9ed0ce150361'),
  '3d-from-2d': workflowProfile('3d-from-2d', '698083725c435e0365a5bc20', '698083725c435e0365a5bc20'),
  'product-modification': workflowProfile('product-modification', '698084bf23591ba38ae6321f', '698084bf23591ba38ae6321f'),
  'change-color': workflowProfile('change-color', '694cb9e2b7c2c3990ca7f9f1', '694e206fc1c0b24dc831ad8b'),
  'remove-background': workflowProfile('remove-background', '694cbafeb7c2c3990ca7fc41', '694e206fc1c0b24dc831ad8b'),
  'remove-watermark': workflowProfile('remove-watermark', '694cbba1b7c2c3990ca7fe83', '694e206fc1c0b24dc831ad8b'),
  'remove-face': workflowProfile('remove-face', '694cbc2db7c2c3990ca7ff29', '694e206fc1c0b24dc831ad8b'),
} as const;

export function getWorkflowProfile(appId: string) {
  const profile = WORKFLOW_PROFILES[appId as keyof typeof WORKFLOW_PROFILES];
  if (!profile) throw new CliError('ARGUMENT', `No workflow profile for maybeai-image-app app: ${appId}`);
  return profile;
}
