/**
 * ONES filters/peek 响应解析（tasks / my-tasks 共用）
 */
import { CliError } from '@jackwener/opencli/errors';
/** ONES task 里 field_values 常为 [{ field_uuid, value }, ...] */
function pickTitleFromFieldValuesArray(fv) {
    if (!Array.isArray(fv))
        return '';
    for (const item of fv) {
        if (!item || typeof item !== 'object')
            continue;
        const row = item;
        const fu = String(row.field_uuid ?? '');
        if (!fu.startsWith('field'))
            continue;
        const v = row.value;
        if (typeof v === 'string' && v.trim())
            return v.trim();
        if (Array.isArray(v) && v.length && typeof v[0] === 'string' && v[0].trim())
            return v[0].trim();
    }
    return '';
}
export function pickTaskTitle(e) {
    for (const k of ['summary', 'name', 'title', 'subject']) {
        const v = e[k];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    const fromArr = pickTitleFromFieldValuesArray(e.field_values);
    if (fromArr)
        return fromArr;
    const fv = e.field_values;
    if (fv && typeof fv === 'object' && !Array.isArray(fv)) {
        const o = fv;
        for (const k of ['field001', 'field002', 'field003']) {
            const v = o[k];
            if (typeof v === 'string' && v.trim())
                return v.trim();
        }
    }
    return '';
}
/** 表格里标题别撑爆终端 */
export function ellipsizeCell(s, max = 64) {
    const t = s.trim();
    if (t.length <= max)
        return t;
    return `${t.slice(0, max - 1)}…`;
}
/** 辅助列：长 uuid 缩略，完整值见 -f json */
export function briefUuid(id, head = 6, tail = 4) {
    if (!id)
        return '';
    if (id.length <= head + tail + 1)
        return id;
    return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
export function formatStamp(v) {
    if (v == null || v === '')
        return '';
    const n = Number(v);
    if (Number.isNaN(n))
        return String(v);
    const ms = n > 1e14 ? Math.floor(n / 1000) : n > 1e12 ? n : n * 1000;
    try {
        return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    }
    catch {
        return String(v);
    }
}
export function flattenPeekGroups(parsed, limit) {
    if (!Array.isArray(parsed.groups)) {
        throw new CliError('FETCH_ERROR', 'Unexpected filters/peek response (missing groups)', 'Try -f json; check team UUID and API version.');
    }
    const groups = parsed.groups;
    const rows = [];
    for (const g of groups) {
        const entries = Array.isArray(g.entries) ? g.entries : [];
        for (const e of entries) {
            rows.push(e);
            if (rows.length >= limit)
                break;
        }
        if (rows.length >= limit)
            break;
    }
    return rows.slice(0, limit);
}
function fieldArrayFirstString(fv, fieldUuid) {
    if (!Array.isArray(fv))
        return '';
    for (const item of fv) {
        if (!item || typeof item !== 'object')
            continue;
        const row = item;
        if (String(row.field_uuid ?? '') !== fieldUuid)
            continue;
        const v = row.value;
        if (typeof v === 'string')
            return v;
        if (Array.isArray(v) && v[0] != null)
            return String(v[0]);
    }
    return '';
}
function fvRecord(e) {
    const fv = e.field_values;
    return fv && typeof fv === 'object' && !Array.isArray(fv) ? fv : null;
}
/** 工作项状态 uuid（用于查 task_statuses 得中文名） */
export function getTaskStatusRawId(e) {
    const fv = e.field_values;
    const fvObj = fvRecord(e);
    if (typeof e.status_uuid === 'string')
        return e.status_uuid;
    return fieldArrayFirstString(fv, 'field016') || (fvObj ? String(fvObj.field016 ?? '') : '');
}
/** 项目 uuid */
export function getTaskProjectRawId(e) {
    const fv = e.field_values;
    const fvObj = fvRecord(e);
    if (typeof e.project_uuid === 'string')
        return e.project_uuid;
    return fieldArrayFirstString(fv, 'field006') || (fvObj ? String(fvObj.field006 ?? '') : '');
}
/**
 * Project API 里 assess/total/remaining_manhour 多为**定点整数**（与 Web 上「小时」不一致）；
 * 常见换算：raw / 1e5 ≈ 小时。若你方实例不同，可设 `ONES_MANHOUR_SCALE`（默认 100000）。
 */
export function onesManhourScale() {
    const raw = Number(process.env.ONES_MANHOUR_SCALE?.trim());
    if (Number.isFinite(raw) && raw > 0)
        return raw;
    return 1e5;
}
/** 界面/h 小数 → API 内 manhour 整数（与列表「工时」列同一刻度） */
export function hoursToOnesManhourRaw(hours) {
    if (!Number.isFinite(hours) || hours <= 0)
        return 0;
    return Math.max(1, Math.round(hours * onesManhourScale()));
}
function formatHoursShort(hours) {
    if (!Number.isFinite(hours))
        return '';
    const snapped = Math.round(hours * 1e6) / 1e6;
    const near = Math.round(snapped);
    if (Math.abs(snapped - near) < 1e-5)
        return `${near}h`;
    const t = Math.round(snapped * 10) / 10;
    return Number.isInteger(t) ? `${t}h` : `${t.toFixed(1)}h`;
}
function formatManhourSegment(label, v) {
    if (v == null || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n))
        return null;
    const hours = n / onesManhourScale();
    return `${label}${formatHoursShort(hours)}`;
}
export function formatTaskManhourSummary(e) {
    const parts = [];
    const a = formatManhourSegment('估', e.assess_manhour);
    const t = formatManhourSegment('登', e.total_manhour);
    const r = formatManhourSegment('余', e.remaining_manhour);
    if (a)
        parts.push(a);
    if (t)
        parts.push(t);
    if (r)
        parts.push(r);
    return parts.length ? parts.join(' ') : '—';
}
export function mapTaskEntry(e, labels) {
    const statusId = getTaskStatusRawId(e);
    const projectId = getTaskProjectRawId(e);
    const fullUuid = String(e.uuid ?? '');
    const title = ellipsizeCell(pickTaskTitle(e));
    const briefIfLong = (s) => (s.length > 14 ? briefUuid(s) : s);
    const statusLabel = labels?.statusByUuid?.get(statusId) ?? briefIfLong(statusId);
    const projectLabel = labels?.projectByUuid?.get(projectId) ?? briefIfLong(projectId);
    return {
        title,
        status: ellipsizeCell(statusLabel, 20),
        project: ellipsizeCell(projectLabel, 40),
        uuid: fullUuid,
        updated: formatStamp(e.server_update_stamp),
        工时: ellipsizeCell(formatTaskManhourSummary(e), 36),
    };
}
export function defaultPeekBody(query) {
    return {
        with_boards: false,
        boards: null,
        query,
        group_by: '',
        sort: [{ create_time: { order: 'desc' } }],
        include_subtasks: false,
        include_status_uuid: true,
        include_issue_type: false,
        include_project_uuid: true,
        is_show_derive: false,
    };
}
export function parsePeekLimit(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.max(1, Math.min(500, parsed));
}
