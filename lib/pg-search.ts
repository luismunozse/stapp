/**
 * Sanitizes a user-provided search term for safe use inside a PostgREST
 * `.or("col.ilike.%term%,...")` filter string.
 *
 * Two problems are handled:
 *  1. PostgREST parses `,` as a filter separator and `()` as grouping, so an
 *     unescaped term can break the query or inject extra filter conditions.
 *  2. `%` and `_` are SQL LIKE wildcards; a literal substring search should
 *     treat them as literals.
 *
 * We neutralize the structural characters and escape the LIKE wildcards. The
 * result is always safe to interpolate as the value part of an ilike filter.
 */
export function escapeOrIlikeTerm(term: string): string {
  return term
    .replace(/[\\%_]/g, (m) => `\\${m}`) // escape LIKE wildcards + backslash
    .replace(/[(),*]/g, " ") // neutralize PostgREST structural chars
    .replace(/\s+/g, " ")
    .trim()
}
