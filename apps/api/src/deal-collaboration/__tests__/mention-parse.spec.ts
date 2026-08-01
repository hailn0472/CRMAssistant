import {
  MAX_COMMENT_LENGTH,
  MENTION_TOKEN_PATTERN,
  extractMentionedUserIds,
} from '../mention-parse'

describe('mention-parse', () => {
  it('exports a 5000 character comment limit', () => {
    expect(MAX_COMMENT_LENGTH).toBe(5000)
  })

  describe('MENTION_TOKEN_PATTERN', () => {
    it('matches @[Display Name](uuid) tokens', () => {
      const match = '@[Nguyen Van A](123e4567-e89b-12d3-a456-426614174000)'.match(
        MENTION_TOKEN_PATTERN,
      )
      expect(match).not.toBeNull()
    })

    it('does not match bare @names', () => {
      expect('hello @nguyen'.match(MENTION_TOKEN_PATTERN)).toBeNull()
    })
  })

  describe('extractMentionedUserIds', () => {
    it('extracts ids in order', () => {
      expect(extractMentionedUserIds('cc @[Alice](user-a) and @[Bob](user-b)')).toEqual([
        'user-a',
        'user-b',
      ])
    })

    it('deduplicates repeated ids', () => {
      expect(extractMentionedUserIds('@[Alice](user-a) then @[Alice](user-a) again')).toEqual([
        'user-a',
      ])
    })

    it('returns an empty array for a comment without mentions', () => {
      expect(extractMentionedUserIds('just a plain comment')).toEqual([])
    })

    it('extracts multiple mentions of different users', () => {
      expect(extractMentionedUserIds('@[A](u1) @[B](u2) @[C](u3)')).toEqual(['u1', 'u2', 'u3'])
    })
  })
})
