/**
 * JSON shape inference for browser network response previews.
 *
 * Produces a flat path → type descriptor map so agents can understand
 * response structure without paying the token cost of the full body.
 *
 * Descriptors:
 *   string | number | boolean | null              primitives
 *   string(len=N)                                 strings longer than sampleStringLen
 *   array(0) | array(N)                           array at depth cap or summarized
 *   object | object(empty)                        objects at depth cap or summarized
 *   (truncated)                                   output size budget exceeded
 */

export interface InferShapeOptions {
    /** Max path depth to descend into (default 6) */
    maxDepth?: number;
    /** Byte budget for the serialized output; truncates when exceeded (default 2048) */
    maxBytes?: number;
    /** Strings longer than this get summarized as `string(len=N)` (default 80) */
    sampleStringLen?: number;
}

export type Shape = Record<string, string>;

const ROOT = '$';

export function inferShape(value: unknown, opts: InferShapeOptions = {}): Shape {
    const maxDepth = opts.maxDepth ?? 6;
    const maxBytes = opts.maxBytes ?? 2048;
    const sampleStringLen = opts.sampleStringLen ?? 80;

    const out: Shape = {};
    let bytes = 2; // account for `{}` braces when serialized
    let truncated = false;

    const add = (path: string, desc: string): boolean => {
        if (truncated) return false;
        const entryBytes = JSON.stringify(path).length + JSON.stringify(desc).length + 2; // ":" + ","
        if (bytes + entryBytes > maxBytes) {
            out['(truncated)'] = `reached ${maxBytes}B budget`;
            truncated = true;
            return false;
        }
        out[path] = desc;
        bytes += entryBytes;
        return true;
    };

    const walk = (node: unknown, path: string, depth: number): void => {
        if (truncated) return;

        if (node === null) { add(path, 'null'); return; }
        const t = typeof node;
        if (t === 'string') {
            const s = node as string;
            add(path, s.length > sampleStringLen ? `string(len=${s.length})` : 'string');
            return;
        }
        if (t === 'number' || t === 'boolean') { add(path, t); return; }
        if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
            add(path, t);
            return;
        }

        if (Array.isArray(node)) {
            if (node.length === 0) { add(path, 'array(0)'); return; }
            if (depth >= maxDepth) { add(path, `array(${node.length})`); return; }
            if (!add(path, `array(${node.length})`)) return;
            walk(node[0], `${path}[0]`, depth + 1);
            return;
        }

        // plain object
        const obj = node as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.length === 0) { add(path, 'object(empty)'); return; }
        if (depth >= maxDepth) { add(path, `object(keys=${keys.length})`); return; }
        if (!add(path, 'object')) return;
        for (const k of keys) {
            if (truncated) return;
            const childPath = isSafeIdent(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
            walk(obj[k], childPath, depth + 1);
        }
    };

    walk(value, ROOT, 0);
    return out;
}

function isSafeIdent(key: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(key);
}
