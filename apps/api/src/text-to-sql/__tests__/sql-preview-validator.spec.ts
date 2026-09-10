import { SqlPreviewValidationError, validateSqlPreview } from '../sql-preview-validator'

describe('validateSqlPreview', () => {
  const validContactQuery =
    'SELECT "id", email FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL LIMIT 25'

  it('accepts a tenant-scoped, bounded query against an approved table', () => {
    expect(validateSqlPreview(`  ${validContactQuery}  `)).toBe(validContactQuery)
  })

  it('normalises a terminal semicolon and adds the bounded default limit', () => {
    const aggregate =
      'SELECT COUNT("id") AS "contactCount" FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL;'

    expect(validateSqlPreview(aggregate)).toBe(
      'SELECT COUNT("id") AS "contactCount" FROM "Contact" WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL LIMIT 100',
    )
  })

  it.each([
    ['a mutating statement', 'UPDATE "Contact" SET email = \'x\''],
    ['a comment', `${validContactQuery} -- ignore the tenant`],
    ['select star', 'SELECT * FROM "Contact" WHERE "tenantId" = :tenantId LIMIT 10'],
    ['an unsupported table', 'SELECT id FROM "User" WHERE "tenantId" = :tenantId LIMIT 10'],
    ['no tenant predicate', 'SELECT id FROM "Contact" WHERE "deletedAt" IS NULL LIMIT 10'],
    ['an excessive limit', 'SELECT id FROM "Contact" WHERE "tenantId" = :tenantId LIMIT 101'],
  ])('rejects %s', (_label, sql) => {
    expect(() => validateSqlPreview(sql)).toThrow(SqlPreviewValidationError)
  })

  it('requires tenant protection for every joined tenant-scoped table', () => {
    const sql = [
      'SELECT "Task"."id", "Contact".email',
      'FROM "Task"',
      'JOIN "Contact" ON "Contact".id = "Task"."contactId"',
      'WHERE "Contact"."tenantId" = :tenantId',
      'LIMIT 20',
    ].join(' ')

    expect(() => validateSqlPreview(sql)).toThrow('Task')
  })
})
