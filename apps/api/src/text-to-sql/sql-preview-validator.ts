const MAX_SQL_LENGTH = 8_000
const MAX_RESULT_LIMIT = 100

const DISALLOWED_TOKENS =
  /\b(?:insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|execute|union|intersect|except|returning|into|for\s+update|lock|set_config|pg_catalog|information_schema|pg_sleep|dblink|pg_[a-z_]+|lo_[a-z_]+)\b/i
const ALLOWED_TABLES = new Set(['Contact', 'Task', 'Conversation', 'Activity'])

export class SqlPreviewValidationError extends Error {}

function quotedIdentifier(identifier: string): string {
  return `"${identifier}"`
}

function extractReferencedTables(sql: string): string[] {
  const tables: string[] = []
  const tablePattern = /\b(?:from|join)\s+"([A-Za-z]+)"/gi
  let match: RegExpExecArray | null

  while ((match = tablePattern.exec(sql)) !== null) {
    tables.push(match[1])
  }

  return tables
}

/**
 * A defence-in-depth validator for generated previews. A future executor must
 * still parse the SQL into an AST and apply row-level authorization before any
 * database connection is used.
 */
export function validateSqlPreview(candidate: string): string {
  let sql = candidate.trim()

  // Models commonly include a conventional final semicolon even when asked
  // not to. One terminal delimiter does not create another statement, so
  // normalise it before applying the multi-statement guard below.
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim()

  if (!sql || sql.length > MAX_SQL_LENGTH) {
    throw new SqlPreviewValidationError('Generated SQL has an invalid length')
  }
  if (!/^select\b/i.test(sql)) {
    throw new SqlPreviewValidationError('Only a single SELECT statement is allowed')
  }
  if (sql.includes(';') || sql.includes('--') || sql.includes('/*') || sql.includes('*/')) {
    throw new SqlPreviewValidationError('Comments and multiple statements are not allowed')
  }
  if (DISALLOWED_TOKENS.test(sql)) {
    throw new SqlPreviewValidationError('Generated SQL contains a prohibited operation')
  }
  if (/select\s+\*/i.test(sql)) {
    throw new SqlPreviewValidationError('SELECT * is not allowed')
  }

  const tables = extractReferencedTables(sql)
  if (tables.length === 0 || tables.some((table) => !ALLOWED_TABLES.has(table))) {
    throw new SqlPreviewValidationError('Generated SQL references an unsupported table')
  }

  const uniqueTables = new Set(tables)
  const requiresQualifiedTenantPredicate = uniqueTables.size > 1

  for (const table of uniqueTables) {
    const tenantPredicate = new RegExp(
      `${requiresQualifiedTenantPredicate ? quotedIdentifier(table) + '\\.' : '(?:' + quotedIdentifier(table) + '\\.)?'}"tenantId"\\s*=\\s*:tenantId`,
      'i',
    )
    if (!tenantPredicate.test(sql)) {
      throw new SqlPreviewValidationError(`Generated SQL is missing tenant protection for ${table}`)
    }
  }

  const limitMatch = /\blimit\s+(\d+)\s*$/i.exec(sql)
  if (!limitMatch) {
    return `${sql} LIMIT ${MAX_RESULT_LIMIT}`
  }
  if (Number(limitMatch[1]) < 1 || Number(limitMatch[1]) > MAX_RESULT_LIMIT) {
    throw new SqlPreviewValidationError(`Generated SQL must use LIMIT 1-${MAX_RESULT_LIMIT}`)
  }

  return sql
}
