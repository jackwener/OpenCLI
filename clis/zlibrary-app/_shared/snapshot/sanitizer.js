/**
 * Snapshot sanitization helpers.
 *
 * Shared across doctor commands so each probe can define own redaction policy
 * without duplicating recursive clone/mask logic.
 */

function normalizeReplacementMap (entries = {}) {
  return new Map(Object.entries(entries).map(function ([key, value]) {
    return [String(key).toLowerCase(), value]
  }))
}

function cloneReplacementValue (value) {
  if (!value || typeof value !== 'object') return value
  return structuredClone(value)
}

/**
 * Build sanitizer that masks selected keys/paths while preserving shape.
 *
 * @param {{ valueByKey?: Record<string, unknown>, valueByPath?: Record<string, unknown> }} [options]
 * @returns {(data: unknown) => unknown}
 */
export function createSnapshotSanitizer (options = {}) {
  const valueByKey = normalizeReplacementMap(options.valueByKey || {})
  const valueByPath = normalizeReplacementMap(options.valueByPath || {})

  function walk (value, path = '') {
    if (!value || typeof value !== 'object') return value

    if (Array.isArray(value)) {
      return value.map(function (item, index) {
        const nextPath = path ? path + '[' + index + ']' : '[' + index + ']'
        return walk(item, nextPath)
      })
    }

    const sanitized = {}
    for (const [key, child] of Object.entries(value)) {
      const lowerKey = key.toLowerCase()
      const childPath = path ? path + '.' + key : key

      if (valueByPath.has(childPath)) {
        sanitized[key] = cloneReplacementValue(valueByPath.get(childPath))
        continue
      }

      if (valueByKey.has(lowerKey)) {
        sanitized[key] = cloneReplacementValue(valueByKey.get(lowerKey))
        continue
      }

      sanitized[key] = walk(child, childPath)
    }

    return sanitized
  }

  return function sanitizeSnapshot (data) {
    if (!data || typeof data !== 'object') return data
    return walk(structuredClone(data))
  }
}
