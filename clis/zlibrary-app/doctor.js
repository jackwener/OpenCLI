import { cli, Strategy } from '@jackwener/opencli/registry'
import { DOCTOR_OUTPUT_COLUMNS } from './_shared/snapshot/rows.js'
import { ArgumentError } from '@jackwener/opencli/errors'

import { doctorApiUserCommand } from './doctor-api-user.js'
import { doctorBooklistCommand } from './doctor-booklist.js'
import { doctorDomDetailCommand } from './doctor-dom-detail.js'
import { doctorDomProfileCommand } from './doctor-dom-profile.js'
import { doctorDomQuotaCommand } from './doctor-dom-quota.js'
import { doctorDomSearchCommand } from './doctor-dom-search.js'
import { runDoctorDownload } from './doctor-download-v2.js'
import { runDoctorBooklistManage } from './doctor-booklist-manage.js'
const MODE_COMMANDS = {
  'booklist': doctorBooklistCommand,
  'api-user': doctorApiUserCommand,
  'dom-search': doctorDomSearchCommand,
  'dom-profile': doctorDomProfileCommand,
  'dom-quota': doctorDomQuotaCommand,
  'dom-book-detail': doctorDomDetailCommand,
  'download': { func: function doctorDownloadCommand (_page, kwargs) { return runDoctorDownload(kwargs) } },
  'booklist-manage': { func: function doctorBooklistManageCommand (_page, kwargs) { return runDoctorBooklistManage(kwargs) } },
}

const MODE_FLAGS = Object.keys(MODE_COMMANDS)

const DOCTOR_COLUMNS = DOCTOR_OUTPUT_COLUMNS

const DOCTOR_ARGS = [
  { name: 'booklist', type: 'boolean', default: false, required: false, help: 'Merged booklist diagnosis: API current-user + DOM bookcard extraction' },
  { name: 'api-user', type: 'boolean', default: false, required: false, help: 'Probe /eapi/user/* endpoints' },
  { name: 'dom-search', type: 'boolean', default: false, required: false, help: 'Probe search result selectors on a live search page' },
  { name: 'dom-profile', type: 'boolean', required: false, help: 'Probe profile selectors on the /profileEdit page' },
  { name: 'dom-quota', type: 'boolean', required: false, help: 'Probe quota selectors on the /users/downloads page' },
  { name: 'dom-book-detail', type: 'boolean', required: false, help: 'Probe book detail page selectors' },
  { name: 'download', type: 'boolean', required: false, default: false, help: 'Validate local CDP download fixtures from download --fixture output' },
  { name: 'booklist-manage', type: 'boolean', required: false, default: false, help: 'Analyze booklist-manage mutation traces from --fixture output' },
  { name: 'save-fixture', type: 'boolean', required: false, default: false, help: 'Save fixture for selected doctor mode' },
  { name: 'dir', type: 'string', required: false, help: 'Fixture directory for --download / --booklist-manage mode' },
]
function selectDoctorMode (args) {
  const selected = MODE_FLAGS.filter(function (flag) { return Boolean(args[flag]) })
  if (selected.length !== 1) {
    throw new ArgumentError('Select exactly one mode: --booklist, --api-user, --dom-search, --dom-profile, --dom-quota, --dom-book-detail, --download, or --booklist-manage')
  }
  return selected[0]
}

function runSelectedDoctor (page, args) {
  const mode = selectDoctorMode(args)
  const command = MODE_COMMANDS[mode]
  return command.func(page, args)
}

function validateDoctorArgs (args) {
  selectDoctorMode(args)
}

export const doctorCommand = cli({
  site: 'zlibrary-app',
  name: 'doctor',
  access: 'read',
  description: 'Run adapter diagnostics: probe API/DOM selectors or validate local fixtures',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: DOCTOR_ARGS,
  columns: DOCTOR_COLUMNS,
  validateArgs: validateDoctorArgs,
  func: runSelectedDoctor,
})
