/**
 * Story 6.5 (Contract D20, D22, AC 18): email service tests with an injected
 * fake transport — never a real SMTP server.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import type { ConfigService } from '@nestjs/config'

import {
  ReportEmailService,
  EmailConfigurationError,
  classifyEmailError,
  executionMessageId,
  loadEmailConfig,
  type MailTransport,
} from '../report-email.service'

function fakeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] ?? undefined } as unknown as ConfigService
}

function fullConfig(): ConfigService {
  return fakeConfig({
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'user@example.com',
    SMTP_PASSWORD: 'sekret',
    REPORT_EMAIL_FROM: 'reports@example.com',
    CRM_WEB_BASE_URL: 'https://crm.example',
  })
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    to: ['a@x.io', 'b@x.io'],
    subject: 'Your scheduled report: Q1',
    html: '<p>hi</p>',
    text: 'hi',
    attachments: [
      { filename: 'q1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') },
    ],
    messageId: executionMessageId('exec-1'),
    ...overrides,
  }
}

describe('loadEmailConfig', () => {
  it('rejects missing host/port/from/baseUrl with typed errors', () => {
    expect(() => loadEmailConfig(fakeConfig({}))).toThrow(EmailConfigurationError)
    expect(() => loadEmailConfig(fakeConfig({ SMTP_HOST: 'h', SMTP_PORT: '25' }))).toThrow(
      /REPORT_EMAIL_FROM/,
    )
    expect(() =>
      loadEmailConfig(fakeConfig({ SMTP_HOST: 'h', SMTP_PORT: '25', REPORT_EMAIL_FROM: 'f@x.io' })),
    ).toThrow(/CRM_WEB_BASE_URL/)
  })

  it('parses a full configuration without exposing secrets in the object shape', () => {
    const config = loadEmailConfig(fullConfig())
    expect(config.host).toBe('smtp.example.com')
    expect(config.port).toBe(587)
    expect(config.secure).toBe(false)
    expect(config.from).toBe('reports@example.com')
    expect(config.baseUrl).toBe('https://crm.example')
    expect(config.user).toBe('user@example.com')
  })
})

describe('classifyEmailError', () => {
  it('marks network/timeout errors retryable', () => {
    expect(classifyEmailError({ code: 'ECONNECTION' })).toBe('RETRYABLE')
    expect(classifyEmailError({ code: 'ETIMEDOUT' })).toBe('RETRYABLE')
  })

  it('marks SMTP 4xx retryable and 5xx terminal', () => {
    expect(classifyEmailError({ responseCode: 421 })).toBe('RETRYABLE')
    expect(classifyEmailError({ responseCode: 450 })).toBe('RETRYABLE')
    expect(classifyEmailError({ responseCode: 550 })).toBe('TERMINAL')
    expect(classifyEmailError({ responseCode: 554 })).toBe('TERMINAL')
  })

  it('marks configuration errors terminal and unknown errors retryable', () => {
    expect(classifyEmailError(new EmailConfigurationError('x'))).toBe('TERMINAL')
    expect(classifyEmailError(new Error('mystery'))).toBe('RETRYABLE')
  })
})

describe('executionMessageId', () => {
  it('produces one deterministic ID per execution', () => {
    expect(executionMessageId('exec-1')).toBe('<report-schedule:exec-1@crm-assistant>')
  })
})

describe('ReportEmailService', () => {
  it('sends through the injected transport with the address API and returns the provider ID', async () => {
    const sent: unknown[] = []
    const fake: MailTransport = {
      sendMail: async (opts) => {
        sent.push(opts)
        return { messageId: 'provider-msg-123' }
      },
    }
    const service = new ReportEmailService(fullConfig(), fake)
    const result = await service.send(options())
    expect(result.providerMessageId).toBe('provider-msg-123')
    const mail = sent[0] as Record<string, unknown>
    // Recipients passed as an array (address API) — never a concatenated header.
    expect(mail.to).toEqual(['a@x.io', 'b@x.io'])
    expect(mail.subject).toBe('Your scheduled report: Q1')
    expect(mail.messageId).toBe('<report-schedule:exec-1@crm-assistant>')
    expect(mail.attachments).toEqual([
      { filename: 'q1.pdf', contentType: 'application/pdf', content: expect.any(Buffer) },
    ])
    expect(mail.html).toBe('<p>hi</p>')
    expect(mail.text).toBe('hi')
  })

  it('throws a typed configuration error without contacting SMTP when env is missing', async () => {
    const service = new ReportEmailService(fakeConfig({}), undefined)
    await expect(service.send(options())).rejects.toThrow(EmailConfigurationError)
  })

  it('wraps transport failures as EmailSendError with the classified kind', async () => {
    const fake: MailTransport = {
      sendMail: async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNECTION' })
      },
    }
    const service = new ReportEmailService(fullConfig(), fake)
    await expect(service.send(options())).rejects.toMatchObject({
      name: 'EmailSendError',
      kind: 'RETRYABLE',
    })
  })

  it('classifies SMTP 5xx as terminal', async () => {
    const fake: MailTransport = {
      sendMail: async () => {
        throw Object.assign(new Error('relay denied'), { responseCode: 554 })
      },
    }
    const service = new ReportEmailService(fullConfig(), fake)
    await expect(service.send(options())).rejects.toMatchObject({ kind: 'TERMINAL' })
  })

  it('setTransport swaps the transport for tests', async () => {
    const service = new ReportEmailService(fakeConfig({}), undefined)
    const fake: MailTransport = { sendMail: async () => ({ messageId: 'm-1' }) }
    service.setTransport(fake)
    const result = await service.send(options())
    expect(result.providerMessageId).toBe('m-1')
  })

  it('times out hung transports as a retryable failure', async () => {
    jest.useFakeTimers()
    try {
      const fake: MailTransport = {
        sendMail: () => new Promise(() => undefined), // never resolves
      }
      const service = new ReportEmailService(fullConfig(), fake)
      const promise = service.send(options())
      jest.advanceTimersByTime(31_000)
      await expect(promise).rejects.toMatchObject({ name: 'EmailSendError', kind: 'RETRYABLE' })
    } finally {
      jest.useRealTimers()
    }
  })
})
