/**
 * dongchedi specs — key configuration overview (配置概览) of a car series.
 *
 * Reads `pageProps.overviewData` from the SSR series page: body dimensions,
 * powertrain (engine / gearbox / 0-100), drivetrain + suspension, and
 * airbags. This is the unsigned SSR overview — the full per-trim parameter
 * sheet sits behind a ByteDance-signed XHR and is deliberately not faked.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    SPECS_COLUMNS,
    assertPlainObject,
    clean,
    dcdFetchPageProps,
    normalizeSeriesId,
} from './utils.js';

/** Distinct, cleaned, non-empty values for a key across an array of objects. */
function uniqueVals(arr, key) {
    const out = [];
    for (const o of (Array.isArray(arr) ? arr : [])) {
        const v = clean(o?.[key]);
        if (v && !out.includes(v)) out.push(v);
    }
    return out;
}

/** Build a min-max range string from a numeric field across rows ("6.4-7.2s"). */
function rangeOf(arr, key, suffix = '') {
    const nums = (Array.isArray(arr) ? arr : [])
        .map((o) => parseFloat(String(o?.[key]).replace(/[^\d.]/g, '')))
        .filter((n) => Number.isFinite(n));
    if (nums.length === 0) return '';
    const lo = Math.min(...nums); const hi = Math.max(...nums);
    return lo === hi ? `${lo}${suffix}` : `${lo}-${hi}${suffix}`;
}

/** Summarize airbag coverage into a readable list. */
function summarizeAirbags(airbagArr) {
    const a = (Array.isArray(airbagArr) ? airbagArr : []);
    if (a.length === 0) return '';
    const any = (key) => a.some((x) => x?.[key]);
    const labels = [
        ['main_airbag', '主'], ['vice_airbag', '副'], ['front_airbag', '前'],
        ['rear_airbag', '后'], ['side_air_curtain', '侧气帘'],
        ['main_knee_airbag', '主膝部'], ['vice_knee_airbag', '副膝部'],
    ];
    const present = labels.filter(([k]) => any(k)).map(([, label]) => label);
    return present.length ? present.join('/') + '气囊' : '';
}

/**
 * Pure parser: overviewData → field/value rows. Exported for unit tests.
 */
export function parseSpecs(overviewData, seriesId) {
    const ov = assertPlainObject(overviewData, 'dongchedi overviewData');
    const space0 = (Array.isArray(ov.space) && ov.space[0]) || {};
    const power = ov.power || {};
    const powerItems = power.power_item || [];
    const manip0 = (Array.isArray(ov.manipulation) && ov.manipulation[0]) || {};

    const dims = (space0.length && space0.width && space0.height)
        ? `${space0.length} × ${space0.width} × ${space0.height} mm`
        : '';
    const drivetrain = [clean(manip0.driver_form), clean(manip0.fourwheel_drive_type)]
        .filter(Boolean).join(' · ');
    const suspension = (manip0.front_suspension_form || manip0.rear_suspension_form)
        ? `前 ${clean(manip0.front_suspension_form) || '?'} / 后 ${clean(manip0.rear_suspension_form) || '?'}`
        : '';

    const fields = [
        ['series_id', String(seriesId)],
        ['dimensions', dims],
        ['wheelbase', space0.wheelbase ? `${space0.wheelbase} mm` : ''],
        ['power', clean(power.overview)],
        ['engine', uniqueVals(powerItems, 'engine_description').join(' / ')],
        ['gearbox', uniqueVals(powerItems, 'gearbox_description').join(' / ')],
        ['energy', uniqueVals(powerItems, 'fuel_form').join(' / ')],
        ['acceleration', rangeOf(powerItems, 'acceleration_time', 's')],
        ['drivetrain', drivetrain],
        ['suspension', suspension],
        ['airbags', summarizeAirbags(ov.airbag)],
    ];
    return fields.map(([field, value]) => ({ field, value }));
}

cli({
    site: 'dongchedi',
    name: 'specs',
    access: 'read',
    aliases: ['config'],
    description: '懂车帝车系配置概览（尺寸 / 动力 / 发动机 / 变速箱 / 四驱 / 悬挂 / 气囊）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 search 的 series_id，或 /auto/series/<id> URL）' },
    ],
    columns: SPECS_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const pp = await dcdFetchPageProps(`/auto/series/${seriesId}`, `specs ${seriesId}`);
        const rows = parseSpecs(pp.overviewData, seriesId);
        // Every series has at least dimensions/power; an all-empty sheet means
        // the overview block was absent (layout drift) — don't emit a blank sheet.
        if (rows.every((r) => r.field === 'series_id' || !r.value)) {
            throw new CommandExecutionError(
                `dongchedi specs ${seriesId}`,
                'No spec overview found for this series (layout may have changed).',
            );
        }
        return rows;
    },
});
