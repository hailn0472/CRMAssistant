import { insertMentionToken, parseCommentSegments } from '../mention-parse'

describe('mention-parse', () => {
  const users = [
    { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 'user-2', firstName: 'Grace', lastName: 'Hopper' },
  ]

  describe('parseCommentSegments', () => {
    it('splits plain text and known mentions into segments', () => {
      const segments = parseCommentSegments('cc @[Grace Hopper](user-2) please review', users)
      expect(segments).toEqual([
        { type: 'text', text: 'cc ' },
        { type: 'mention', userId: 'user-2', displayName: 'Grace Hopper', text: '@Grace Hopper' },
        { type: 'text', text: ' please review' },
      ])
    })

    it('returns a single text segment for a comment without mentions', () => {
      expect(parseCommentSegments('just text', users)).toEqual([
        { type: 'text', text: 'just text' },
      ])
    })

    it('renders the raw token for a mention id with no matching user', () => {
      const segments = parseCommentSegments('hi @[Ghost](unknown-id)', users)
      expect(segments).toEqual([
        { type: 'text', text: 'hi ' },
        {
          type: 'mention',
          userId: 'unknown-id',
          displayName: 'Ghost',
          text: '@[Ghost](unknown-id)',
        },
      ])
    })

    it('handles adjacent mentions and trailing text', () => {
      const segments = parseCommentSegments(
        '@[Ada Lovelace](user-1)@[Grace Hopper](user-2) done',
        users,
      )
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({
        type: 'mention',
        userId: 'user-1',
        displayName: 'Ada Lovelace',
        text: '@Ada Lovelace',
      })
      expect(segments[1]).toEqual({
        type: 'mention',
        userId: 'user-2',
        displayName: 'Grace Hopper',
        text: '@Grace Hopper',
      })
      expect(segments[2]).toEqual({ type: 'text', text: ' done' })
    })

    it('does not treat a bare @name as a mention', () => {
      const segments = parseCommentSegments('hey @ada', users)
      expect(segments).toEqual([{ type: 'text', text: 'hey @ada' }])
    })
  })

  describe('insertMentionToken', () => {
    it('replaces the mention attempt range with the explicit token', () => {
      const result = insertMentionToken('Hello @gr', 6, 9, {
        id: 'user-2',
        firstName: 'Grace',
        lastName: 'Hopper',
      })
      expect(result.text).toBe('Hello @[Grace Hopper](user-2) ')
      expect(result.caret).toBe('Hello @[Grace Hopper](user-2) '.length)
    })

    it('inserts at the caret when the range is empty', () => {
      const result = insertMentionToken('Hi ', 3, 3, {
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      expect(result.text).toBe('Hi @[Ada Lovelace](user-1) ')
      expect(result.caret).toBe('Hi @[Ada Lovelace](user-1) '.length)
    })

    it('keeps text after the replaced range', () => {
      const result = insertMentionToken('@gr please', 0, 3, {
        id: 'user-2',
        firstName: 'Grace',
        lastName: 'Hopper',
      })
      expect(result.text).toBe('@[Grace Hopper](user-2)  please')
    })
  })
})
