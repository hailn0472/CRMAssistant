/**
 * Comment length limit and @mention token grammar (Story 3.6).
 *
 * Mentions use the explicit token `@[Display Name](userId)` — NOT bare `@name`
 * matching. Bare-name matching has to guess: two people named Nguyen, a name
 * typed with different diacritics, a name that is a prefix of another. Embedding
 * the id at insertion time makes the parse total and server-side validation
 * trivial (filter extracted ids against the tenant's active users).
 */

export const MAX_COMMENT_LENGTH = 5000

export const MENTION_TOKEN_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g

/**
 * Extracts the user ids embedded in `@[Display Name](userId)` tokens,
 * deduplicated and order-preserving. Unknown or malformed ids are simply not
 * extracted — the caller decides what to do with survivors.
 */
export function extractMentionedUserIds(comment: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of comment.matchAll(MENTION_TOKEN_PATTERN)) {
    const id = match[2]
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
