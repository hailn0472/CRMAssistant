import { parseWidgetConfig, validateWidgetConfig, DEFAULT_WIDGET_CONFIG } from '../widget-config'

describe('widget-config', () => {
  // ─── AC 34 ──────────────────────────────────────────────────────
  describe('parseWidgetConfig', () => {
    it('returns defaults for null', () => {
      expect(parseWidgetConfig(null)).toEqual(DEFAULT_WIDGET_CONFIG)
    })

    it('returns defaults for {}', () => {
      expect(parseWidgetConfig({})).toEqual(DEFAULT_WIDGET_CONFIG)
    })

    it('returns defaults for [] (array)', () => {
      expect(parseWidgetConfig([])).toEqual(DEFAULT_WIDGET_CONFIG)
    })

    it('returns defaults for a plain string', () => {
      expect(parseWidgetConfig('hello')).toEqual(DEFAULT_WIDGET_CONFIG)
    })

    it('returns defaults for unknown key without throwing', () => {
      const result = parseWidgetConfig({ unknownKey: 1 })
      expect(result).toEqual(DEFAULT_WIDGET_CONFIG)
    })

    it('parses a valid source', () => {
      const result = parseWidgetConfig({ source: 'LEAD_FUNNEL' })
      expect(result.source).toBe('LEAD_FUNNEL')
    })

    it('falls back to default source for invalid source string', () => {
      const result = parseWidgetConfig({ source: 'NOPE' })
      expect(result.source).toBe(DEFAULT_WIDGET_CONFIG.source)
    })

    it('parses dateRangeDays within bounds', () => {
      const result = parseWidgetConfig({ dateRangeDays: 7 })
      expect(result.dateRangeDays).toBe(7)
    })

    it('falls back to default dateRangeDays for zero', () => {
      const result = parseWidgetConfig({ dateRangeDays: 0 })
      expect(result.dateRangeDays).toBe(DEFAULT_WIDGET_CONFIG.dateRangeDays)
    })

    it('falls back to default dateRangeDays for > 365', () => {
      const result = parseWidgetConfig({ dateRangeDays: 400 })
      expect(result.dateRangeDays).toBe(DEFAULT_WIDGET_CONFIG.dateRangeDays)
    })

    it('falls back to default dateRangeDays for negative', () => {
      const result = parseWidgetConfig({ dateRangeDays: -5 })
      expect(result.dateRangeDays).toBe(DEFAULT_WIDGET_CONFIG.dateRangeDays)
    })

    it('falls back to default dateRangeDays for NaN', () => {
      const result = parseWidgetConfig({ dateRangeDays: NaN })
      expect(result.dateRangeDays).toBe(DEFAULT_WIDGET_CONFIG.dateRangeDays)
    })

    it('parses stageId and ownerId', () => {
      const result = parseWidgetConfig({ stageId: 'stage-1', ownerId: 'user-1' })
      expect(result.stageId).toBe('stage-1')
      expect(result.ownerId).toBe('user-1')
    })

    it('nullifies empty-string stageId and ownerId', () => {
      const result = parseWidgetConfig({ stageId: '', ownerId: '' })
      expect(result.stageId).toBeNull()
      expect(result.ownerId).toBeNull()
    })

    it('parses limit within bounds', () => {
      const result = parseWidgetConfig({ limit: 3 })
      expect(result.limit).toBe(3)
    })

    it('falls back to default limit for out-of-bounds', () => {
      const result = parseWidgetConfig({ limit: 100 })
      expect(result.limit).toBe(DEFAULT_WIDGET_CONFIG.limit)
    })

    it('never throws at read time for any input', () => {
      expect(() => parseWidgetConfig(undefined)).not.toThrow()
      expect(() => parseWidgetConfig(42)).not.toThrow()
      expect(() => parseWidgetConfig(true)).not.toThrow()
      expect(() => parseWidgetConfig(new Date())).not.toThrow()
    })
  })

  // ─── AC 34 write-path ───────────────────────────────────────────
  describe('validateWidgetConfig', () => {
    it('throws when source is missing', () => {
      expect(() => validateWidgetConfig({})).toThrow('widget config source is required')
    })

    it('throws on a null config (not silently defaulted)', () => {
      expect(() => validateWidgetConfig(null)).toThrow('widget config must be an object')
    })

    it('throws on an array config', () => {
      expect(() => validateWidgetConfig([])).toThrow('widget config must be an object')
    })

    it('throws on a primitive config', () => {
      expect(() => validateWidgetConfig('hello')).toThrow('widget config must be an object')
    })

    it('throws when source is invalid', () => {
      expect(() => validateWidgetConfig({ source: 'NOPE' })).toThrow(
        'widget config source is required',
      )
    })

    it('accepts a valid source-only object', () => {
      const result = validateWidgetConfig({ source: 'LEAD_FUNNEL' })
      expect(result.source).toBe('LEAD_FUNNEL')
    })

    it('throws on invalid dateRangeDays', () => {
      expect(() => validateWidgetConfig({ source: 'TASK_STATS', dateRangeDays: 0 })).toThrow(
        'dateRangeDays must be a number between 1 and 365',
      )
    })

    it('throws on invalid limit', () => {
      expect(() => validateWidgetConfig({ source: 'TASK_STATS', limit: 100 })).toThrow(
        'limit must be a number between 1 and 5',
      )
    })

    it('accepts a fully valid config', () => {
      const result = validateWidgetConfig({
        source: 'LEAD_FUNNEL',
        dateRangeDays: 90,
        stageId: 'stage-x',
        ownerId: 'user-x',
        limit: 3,
      })
      expect(result).toEqual({
        source: 'LEAD_FUNNEL',
        dateRangeDays: 90,
        stageId: 'stage-x',
        ownerId: 'user-x',
        limit: 3,
      })
    })
  })
})
