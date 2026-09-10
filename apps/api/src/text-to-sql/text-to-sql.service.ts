import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, createHmac, timingSafeEqual } from 'crypto'

import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { AuditService } from '../audit/audit.service'
import { requirePermission } from '../common/guards/permission-check'
import { PrismaService } from '../prisma/prisma.service'
import { TextToSqlExecuteDto } from './dto/text-to-sql-execute.dto'
import { GoogleAiStudioClient } from './google-ai-studio.client'
import { SALES_ASSISTANT_SUMMARY_PROMPT, TEXT_TO_SQL_SYSTEM_PROMPT } from './sales-schema'
import { SqlPreviewValidationError, validateSqlPreview } from './sql-preview-validator'
import {
  SALES_QUERY_INTENTS,
  type GeneratedSalesQuery,
  type SalesQueryIntent,
  type AssistantSummary,
  type TextToSqlExecution,
  type TextToSqlPreview,
} from './text-to-sql.types'

const REQUIRED_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['CONTACT', 'READ'],
  ['TASK', 'READ'],
  ['INBOX', 'READ'],
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSalesQueryIntent(value: unknown): value is SalesQueryIntent {
  return typeof value === 'string' && (SALES_QUERY_INTENTS as readonly string[]).includes(value)
}

function parseGeneratedQuery(content: string): GeneratedSalesQuery {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    throw new BadRequestException('Text-to-SQL provider did not return valid JSON')
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.sql !== 'string' ||
    typeof parsed.explanation !== 'string' ||
    !isSalesQueryIntent(parsed.intent)
  ) {
    throw new BadRequestException('Text-to-SQL provider returned an invalid query shape')
  }

  return {
    sql: parsed.sql,
    explanation: parsed.explanation.trim(),
    intent: parsed.intent,
  }
}

function parseAssistantSummary(content: string): AssistantSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    throw new BadRequestException('Text-to-SQL provider did not return a valid assistant response')
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.answer !== 'string' ||
    !Array.isArray(parsed.suggestedNextSteps) ||
    !parsed.suggestedNextSteps.every((step) => typeof step === 'string')
  ) {
    throw new BadRequestException('Text-to-SQL provider returned an invalid assistant response')
  }

  return {
    answer: parsed.answer.trim(),
    suggestedNextSteps: parsed.suggestedNextSteps.slice(0, 3).map((step) => step.trim()),
  }
}

function serialiseRows(rows: unknown[]): Array<Record<string, unknown>> {
  return JSON.parse(
    JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as Array<Record<string, unknown>>
}

@Injectable()
export class TextToSqlService {
  constructor(
    private readonly googleAiStudioClient: GoogleAiStudioClient,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async generatePreview(user: JwtPayload, question: string): Promise<TextToSqlPreview> {
    const questionHash = createHash('sha256').update(question).digest('hex')

    try {
      await Promise.all(
        REQUIRED_PERMISSIONS.map(([resource, action]) =>
          requirePermission({ user }, resource, action),
        ),
      )

      const generated = await this.googleAiStudioClient.generateJson(
        TEXT_TO_SQL_SYSTEM_PROMPT,
        question,
      )
      const query = parseGeneratedQuery(generated.content)
      const sql = validateSqlPreview(query.sql)

      await this.audit(user, 'TEXT_TO_SQL_GENERATED', questionHash, {
        intent: query.intent,
        model: generated.model,
      })

      return {
        ...query,
        sql,
        model: generated.model,
        executionToken: this.createExecutionToken(user, sql, query.intent),
        status: 'preview',
      }
    } catch (error) {
      await this.audit(user, 'TEXT_TO_SQL_REJECTED', questionHash, {
        reason: error instanceof Error ? error.name : 'UnknownError',
      })

      if (error instanceof SqlPreviewValidationError) {
        throw new BadRequestException('Generated query did not pass safety validation')
      }
      throw error
    }
  }

  async executePreview(user: JwtPayload, input: TextToSqlExecuteDto): Promise<TextToSqlExecution> {
    const questionHash = createHash('sha256').update(input.question).digest('hex')

    try {
      await Promise.all(
        REQUIRED_PERMISSIONS.map(([resource, action]) =>
          requirePermission({ user }, resource, action),
        ),
      )
      if (!isSalesQueryIntent(input.intent)) {
        throw new BadRequestException('Unsupported sales query intent')
      }

      const sql = validateSqlPreview(input.sql)
      this.assertExecutionToken(user, sql, input.intent, input.executionToken)
      const rows = await this.runReadOnlyQuery(sql, user.tenantId)
      const assistantSummary = await this.summariseResults(input.question, rows)

      await this.audit(user, 'TEXT_TO_SQL_EXECUTED', questionHash, {
        intent: input.intent,
        rowCount: String(rows.length),
      })

      return {
        ...assistantSummary,
        rows,
        rowCount: rows.length,
        status: 'completed',
      }
    } catch (error) {
      await this.audit(user, 'TEXT_TO_SQL_REJECTED', questionHash, {
        reason: error instanceof Error ? error.name : 'UnknownError',
      })

      if (error instanceof SqlPreviewValidationError) {
        throw new BadRequestException('Query did not pass safety validation')
      }
      if (error instanceof HttpException) throw error
      throw new BadRequestException('Unable to run the query safely')
    }
  }

  private async runReadOnlyQuery(
    sql: string,
    tenantId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const executableSql = sql.replaceAll(':tenantId', '$1')

    const rows = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await transaction.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'")
        return transaction.$queryRawUnsafe<unknown[]>(executableSql, tenantId)
      },
      { maxWait: 2_000, timeout: 4_000 },
    )

    return serialiseRows(rows)
  }

  private async summariseResults(
    question: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<AssistantSummary> {
    const fallback: AssistantSummary =
      rows.length === 0
        ? {
            answer: 'I could not find any matching CRM records for that question.',
            suggestedNextSteps: ['Try a broader date range or a different pipeline status.'],
          }
        : {
            answer: `I found ${rows.length} matching CRM record${rows.length === 1 ? '' : 's'}.`,
            suggestedNextSteps: [
              'Review the matching records and prioritize the most time-sensitive follow-up.',
            ],
          }

    try {
      const generated = await this.googleAiStudioClient.generateJson(
        SALES_ASSISTANT_SUMMARY_PROMPT,
        JSON.stringify({ question, resultCount: rows.length, rows: rows.slice(0, 20) }),
      )
      return parseAssistantSummary(generated.content)
    } catch {
      return fallback
    }
  }

  private createExecutionToken(user: JwtPayload, sql: string, intent: SalesQueryIntent): string {
    const signingSecret = this.configService.get<string>('JWT_SECRET')
    if (!signingSecret) {
      throw new BadRequestException('Text-to-SQL execution is not configured')
    }

    return createHmac('sha256', signingSecret)
      .update(`${user.tenantId}\u0000${user.userId}\u0000${intent}\u0000${sql}`)
      .digest('base64url')
  }

  private assertExecutionToken(
    user: JwtPayload,
    sql: string,
    intent: SalesQueryIntent,
    executionToken: string,
  ): void {
    const expected = this.createExecutionToken(user, sql, intent)
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(executionToken)

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new ForbiddenException('This query preview cannot be executed by the current user')
    }
  }

  private async audit(
    user: JwtPayload,
    action: 'TEXT_TO_SQL_GENERATED' | 'TEXT_TO_SQL_REJECTED' | 'TEXT_TO_SQL_EXECUTED',
    questionHash: string,
    details: Record<string, string>,
  ): Promise<void> {
    try {
      await this.auditService.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action,
        entity: 'TEXT_TO_SQL',
        entityId: questionHash,
        details,
      })
    } catch {
      // Auditing must not change the user-facing outcome if the audit store is unavailable.
    }
  }
}
