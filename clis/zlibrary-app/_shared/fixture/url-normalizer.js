/**
 * Fixture URL Normalization  -  convert absolute URLs to relative paths in snapshots.
 *
 * This helper is ONLY used during --save-fixture to make snapshots mirror-agnostic.
 * Production extraction (extractBooklistBookRows, extractSearchResults) and CLI
 * output continue to use absolute URLs.
 *
 * Z-Library uses multiple mirror domains (spanish-books.sk, z-lib.fm, frenchbooks.sk...).
 * The domain is session routing info, not DOM behavior. Fixtures store relative paths
 * so drift detection isn't triggered by mirror changes.
 *
 * @module url-normalizer
 */

import { URL } from 'node:url'

/**
 * Normalize URL fields in fixture data from absolute to relative path,
 * renaming keys per project convention (url → url_path).
 * Used for ALL fixture-domain snapshot construction (both drift comparison
 * and --save-fixture). NOT used in production extraction or CLI output.
 *
 * Normalize ONCE before building the snapshot, then reuse for both
 * compare and save  -  never normalize raw production output and
 * unnormalized output in the same doctor.
 *
 * @param {object|array} data - fixture data (raw extraction output)
 * @param {object<string,string>} renameMap - field rename mapping,
 *   e.g. { url: 'url_path' }. Source keys have their values converted
 *   to relative paths AND renamed to the target key.
 * @returns {object|array} - new data with url values converted to path
 * @private
 */
export function normalizeFixtureUrls (data, renameMap) {
  if (!data || typeof data !== 'object') return data

  function convertUrl (value) {
    if (typeof value !== 'string' || value === '') return ''
    try {
      const u = new URL(value)
      // Only convert http(s) URLs; return empty for other protocols
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
      // Return pathname + search + hash (relative URL)
      return u.pathname + u.search + u.hash
    } catch {
      // Parse failed  -  return empty for mapped URL fields
      return ''
    }
  }

  function walk (obj) {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(walk)

    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      const isUrlField = key in renameMap
      const targetKey = isUrlField ? renameMap[key] : key
      if (isUrlField) {
        result[targetKey] = convertUrl(value)
      } else if (typeof value === 'object' && value !== null) {
        result[targetKey] = walk(value)
      } else {
        result[targetKey] = value
      }
    }
    return result
  }

  return walk(data)
}