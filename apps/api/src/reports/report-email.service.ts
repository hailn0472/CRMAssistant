/**
 * Story 6.5 (Contract D20, D22): injectable SMTP email service over Nodemailer.
 *
 * Environment contract: SMTP_HOST, SMTP_PORT, SMTP_SECURE, optional
 * SMTP_USER/SMTP_PASSWORD, REPORT_EMAIL_FROM, CRM_WEB_BASE_URL. Required
 * configuration is validated lazily and produces a typed, non-retryable
 * configuration error. Tests inject a fake/stream transport — never a real
 * server. Credentials are never logged.
 */
import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import nodemailer from 'nodemailer'

export type MailAddress = string

export type SendMailOptions = {
  to: MailAddress[]
  subject: string
  html: string
  text: string
  attachments: { filename: string; contentType: string; content: Buffer }[]
  messageId: string
}

export type SendMailResult = {
  providerMessageId: string | null
}

/** Minimal transport surface so tests can inject fakes (stream/JSON). */
export type MailTransport = {
  sendMail(options: unknown): Promise<{ messageId?: string | null }>
}

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigurationError'
  }
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly kind: 'RETRYABLE' | 'TERMINAL',
  ) {
    super(message)
    this.name = 'EmailSendError'
  }
}

export const EMAIL_SEND_TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Classifies transport failures as retryable (network/timeout/SMTP 4xx) or
 * terminal (invalid config/address, SMTP 5xx). Unknown errors default to
 * retryable so a transient hiccup consumes the persisted retry budget rather
 * than failing silently.
 */
export function classifyEmailError(error: unknown): 'RETRYABLE' | 'TERMINAL' {
  if (error instanceof EmailSendError) return error.kind
  if (error instanceof EmailConfigurationError) return 'TERMINAL'
  if (!isRecord(error)) return 'RETRYABLE'
  const code = typeof error.code === 'string' ? error.code : ''
  const retryableCodes = [
    'ECONNECTION',
    'ETIMEDOUT',
    'ESOCKET',
    'ECONNRESET',
    'EAI_AGAIN',
    'EDNS',
    'ENOTFOUND',
  ]
  if (retryableCodes.includes(code)) return 'RETRYABLE'
  const responseCode = typeof error.responseCode === 'number' ? error.responseCode : null
  if (responseCode !== null) {
    return responseCode >= 400 && responseCode < 500 ? 'RETRYABLE' : 'TERMINAL'
  }
  return 'RETRYABLE'
}

export function loadEmailConfig(configService: ConfigService): {
  host: string
  port: number
  secure: boolean
  user: string | null
  password: string | null
  from: string
  baseUrl: string
} {
  const host = configService.get<string>('SMTP_HOST')?.trim() ?? ''
  const portRaw = configService.get<string | number>('SMTP_PORT')
  const port = typeof portRaw === 'number' ? portRaw : Number(portRaw ?? 0)
  const secure = (configService.get<string>('SMTP_SECURE') ?? '').toLowerCase() === 'true'
  const user = configService.get<string>('SMTP_USER')?.trim() ?? null
  const password = configService.get<string>('SMTP_PASSWORD') ?? null
  const from = configService.get<string>('REPORT_EMAIL_FROM')?.trim() ?? ''
  const baseUrl = configService.get<string>('CRM_WEB_BASE_URL')?.trim() ?? ''
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EmailConfigurationError('SMTP_HOST and a valid SMTP_PORT must be configured')
  }
  if (!from) {
    throw new EmailConfigurationError('REPORT_EMAIL_FROM must be configured')
  }
  if (!baseUrl) {
    throw new EmailConfigurationError('CRM_WEB_BASE_URL must be configured')
  }
  return { host, port, secure, user, password, from, baseUrl }
}

/** Deterministic message ID per execution — contract D22. */
export function executionMessageId(executionId: string): string {
  return `<report-schedule:${executionId}@crm-assistant>`
}

@Injectable()
export class ReportEmailService {
  private transport: MailTransport | null = null

  constructor(
    private readonly configService: ConfigService,
    @Optional() injectedTransport?: MailTransport,
  ) {
    if (injectedTransport) {
      this.transport = injectedTransport
    }
  }

  /** Testing hook: replaces the transport without touching real SMTP. */
  setTransport(transport: MailTransport): void {
    this.transport = transport
  }

  private getTransport(): MailTransport {
    if (this.transport) return this.transport
    const config = loadEmailConfig(this.configService)
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
      // Never log credentials; keep SMTP diagnostics minimal.
      logger: false,
      debug: false,
    })
    this.transport = transporter
    return transporter
  }

  /**
   * Sends the multipart message with a bounded timeout. Recipients go through
   * Nodemailer's address API (array), never string-concatenated headers.
   * Returns the provider message ID when the transport reports one.
   */
  async send(options: SendMailOptions): Promise<SendMailResult> {
    const transport = this.getTransport()
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new EmailSendError('SMTP send timed out', 'RETRYABLE'))
      }, EMAIL_SEND_TIMEOUT_MS)
      // Unref so a pending timer cannot keep the process alive in tests.
      timer.unref()
    })
    try {
      const result = await Promise.race([
        transport.sendMail({
          to: options.to, // address API — no header concatenation
          subject: options.subject,
          html: options.html,
          text: options.text,
          attachments: options.attachments,
          messageId: options.messageId,
        }),
        timeout,
      ])
      return { providerMessageId: result.messageId ?? null }
    } catch (error) {
      if (error instanceof EmailSendError) throw error
      throw new EmailSendError(
        `SMTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        classifyEmailError(error),
      )
    }
  }
}
