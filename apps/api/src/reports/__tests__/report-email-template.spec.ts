/**
 * Story 6.5 (Contract D21, AC 11-12): branded email template tests — escaping,
 * tenant branding sanitization/fallback, canonical links, both parts.
 */
import {
  renderScheduledReportEmail,
  sanitizeTenantBranding,
  escapeHtml,
  emailSubject,
  DEFAULT_PRIMARY_COLOR,
} from '../report-email-template'
import type { ScheduledReportPayload } from '../scheduled-report-payload.service'

function payload(overrides: Partial<ScheduledReportPayload> = {}): ScheduledReportPayload {
  return {
    reportId: 'rep-1',
    reportType: 'SALES_OVERVIEW',
    reportName: 'Q1 <Overview> & "Details"',
    generatedAt: '2026-02-01T12:00:00.000Z',
    dateRangeLabel: '2026-01-01 — 2026-01-31',
    summaryMetrics: [
      { key: 'PIPELINE_VALUE', label: 'Total value', value: 125000, unit: 'CURRENCY' },
      { key: 'WIN_RATE', label: 'Win rate', value: null, unit: 'PERCENT' },
    ],
    columns: [],
    rows: [],
    totalRows: 0,
    warnings: [{ code: 'MIXED_CURRENCY', message: 'Mixed currencies detected' }],
    currency: 'USD',
    mixedCurrencies: true,
    crmUrl: 'https://crm.example/reports/sales?reportId=rep-1',
    ...overrides,
  }
}

describe('sanitizeTenantBranding', () => {
  it('keeps valid HTTPS logos and six-digit hex colors', () => {
    const out = sanitizeTenantBranding({
      name: 'Acme Inc',
      logoUrl: 'https://cdn.example/logo.png',
      primaryColor: '#FFAA00',
    })
    expect(out).toEqual({
      name: 'Acme Inc',
      logoUrl: 'https://cdn.example/logo.png',
      primaryColor: '#ffaa00',
    })
  })

  it('rejects non-HTTPS logos and invalid colors with safe fallbacks', () => {
    const out = sanitizeTenantBranding({
      name: 'Acme',
      logoUrl: 'javascript:alert(1)',
      primaryColor: 'red',
    })
    expect(out.logoUrl).toBeNull()
    expect(out.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)

    const http = sanitizeTenantBranding({
      name: 'Acme',
      logoUrl: 'http://x/logo.png',
      primaryColor: '#abcdef',
    })
    expect(http.logoUrl).toBeNull()
  })

  it('never throws on missing or empty branding', () => {
    expect(sanitizeTenantBranding(null)).toEqual({
      name: 'CRM',
      logoUrl: null,
      primaryColor: DEFAULT_PRIMARY_COLOR,
    })
    expect(sanitizeTenantBranding({ name: '', logoUrl: '', primaryColor: '' }).name).toBe('CRM')
  })
})

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    )
  })
})

describe('emailSubject', () => {
  it('strips CR/LF and control characters from the report name to prevent header injection', () => {
    const subject = emailSubject(payload({ reportName: 'Q1\r\nBcc: victim@evil.com' }))
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('Your scheduled report: Q1Bcc: victim@evil.com')
  })

  it('strips other control characters (tabs, NUL) from the subject', () => {
    const subject = emailSubject(payload({ reportName: 'R\tport\u0000Name' }))
    expect(subject).toBe('Your scheduled report: RportName')
  })
})

describe('renderScheduledReportEmail', () => {
  it('renders both parts with report name, dates, summary, attachment and CRM link', () => {
    const rendered = renderScheduledReportEmail({
      payload: payload(),
      branding: {
        name: 'Acme Inc',
        logoUrl: 'https://cdn.example/logo.png',
        primaryColor: '#ffaa00',
      },
      attachmentFilename: 'q1-overview-rep-1-20260201.pdf',
    })
    expect(rendered.subject).toBe('Your scheduled report: Q1 <Overview> & "Details"')
    expect(rendered.html).toContain('Q1 &lt;Overview&gt; &amp; &quot;Details&quot;')
    expect(rendered.html).toContain('2026-01-01 — 2026-01-31')
    expect(rendered.html).toContain('2026-02-01T12:00:00.000Z')
    expect(rendered.html).toContain('Total value')
    expect(rendered.html).toContain('125000')
    expect(rendered.html).toContain('Win rate')
    expect(rendered.html).toContain('n/a')
    expect(rendered.html).toContain('q1-overview-rep-1-20260201.pdf')
    expect(rendered.html).toContain('https://crm.example/reports/sales?reportId=rep-1')
    expect(rendered.html).toContain('MIXED_CURRENCY')
    expect(rendered.html).toContain('https://cdn.example/logo.png')
    expect(rendered.html).toContain('#ffaa00')

    expect(rendered.text).toContain('Q1 <Overview> & "Details"')
    expect(rendered.text).toContain('Date range: 2026-01-01 — 2026-01-31')
    expect(rendered.text).toContain('Total value: 125000')
    expect(rendered.text).toContain('Win rate: n/a')
    expect(rendered.text).toContain('View in CRM: https://crm.example/reports/sales?reportId=rep-1')
    expect(rendered.text).toContain('Acme Inc')
  })

  it('falls back to tenant name and default palette when branding is unsafe', () => {
    const rendered = renderScheduledReportEmail({
      payload: payload(),
      branding: { name: 'Acme', logoUrl: 'http://insecure/logo.png', primaryColor: 'not-a-color' },
      attachmentFilename: 'x.csv',
    })
    expect(rendered.html).not.toContain('http://insecure/logo.png')
    expect(rendered.html).toContain('Acme')
    expect(rendered.html).toContain(DEFAULT_PRIMARY_COLOR)
  })

  it('uses the custom report builder link for CUSTOM reports', () => {
    const rendered = renderScheduledReportEmail({
      payload: payload({
        reportType: 'CUSTOM',
        crmUrl: 'https://crm.example/reports/builder?reportId=rep-2',
      }),
      branding: null,
      attachmentFilename: 'x.xlsx',
    })
    expect(rendered.html).toContain('https://crm.example/reports/builder?reportId=rep-2')
  })

  it('escapes metric values and warning text (no raw user data)', () => {
    const rendered = renderScheduledReportEmail({
      payload: payload({
        reportName: '<img src=x onerror=alert(1)>',
        warnings: [{ code: 'X', message: '<script>alert(1)</script>' }],
      }),
      branding: null,
      attachmentFilename: 'x.pdf',
    })
    expect(rendered.html).not.toContain('<img src=x')
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
  })
})
