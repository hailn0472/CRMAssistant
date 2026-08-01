/**
 * Pure @mention parsing/rendering helpers for deal comments (Story 3.6).
 * No React — unit-testable in isolation.
 *
 * Mention tokens are explicit: `@[Display Name](userId)`. `parseCommentSegments`
 * splits a stored comment into plain-text and mention segments; the comment
 * thread renders segments as plain text with mention spans — never as HTML
 * (AC 26: no markdown, no dangerouslySetInnerHTML).
 */

export type MentionSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; userId: string; displayName: string; text: string }

const MENTION_TOKEN_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g

export function parseCommentSegments(
  comment: string,
  mentionedUsers: Array<{ id: string; firstName: string; lastName: string }>,
): MentionSegment[] {
  const segments: MentionSegment[] = []
  const userMap = new Map(mentionedUsers.map((user) => [user.id, user]))

  let lastIndex = 0
  MENTION_TOKEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MENTION_TOKEN_PATTERN.exec(comment)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: comment.slice(lastIndex, match.index) })
    }
    const userId = match[2]!
    const displayName = match[1]!
    const user = userMap.get(userId)
    segments.push({
      type: 'mention',
      userId,
      displayName,
      // Resolved display name when the user is known; the raw token otherwise
      // (the rendering falls back to plain text for an unknown id).
      text: user ? `@${user.firstName} ${user.lastName}` : match[0],
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < comment.length) {
    segments.push({ type: 'text', text: comment.slice(lastIndex) })
  }

  return segments
}

/**
 * Replaces the mention attempt at `[rangeStart, rangeEnd)` with the explicit
 * token and returns the new text plus the caret position after the token.
 * The trailing space keeps the token separated from whatever follows.
 */
export function insertMentionToken(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  user: { id: string; firstName: string; lastName: string },
): { text: string; caret: number } {
  const token = `@[${user.firstName} ${user.lastName}](${user.id}) `
  const next = text.slice(0, rangeStart) + token + text.slice(rangeEnd)
  return { text: next, caret: rangeStart + token.length }
}
