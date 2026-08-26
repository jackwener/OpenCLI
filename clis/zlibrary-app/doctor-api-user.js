import { Strategy } from '@jackwener/opencli/registry'

export const doctorApiUserCommand = {
  site: 'zlibrary-app',
  name: 'doctor-api-user',
  access: 'read',
  description: 'API diagnosis — user API mode; --save-fixture unsupported',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'save-fixture',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Unsupported; no stable read-only snapshot exists for this mode',
    },
  ],
  columns: ['probe', 'endpoint', 'httpStatus', 'shape', 'required', 'observed', 'status', 'message'],
  func: async (_page, args) => {
    if (args['save-fixture']) {
      process.stderr.write('WARN: doctor-api-user does not support --save-fixture; no stable read-only probes exist for /eapi/user/*.\n')
      return []
    }
    return [{
      probe: 'api-user-disabled',
      endpoint: '/eapi/user/update',
      httpStatus: '',
      shape: '',
      required: '',
      observed: '',
      status: 'na',
      message: 'No read-only real probes defined for /eapi/user/update; POST mutation probes forbidden by doctor spec',
    }]
  },
}
