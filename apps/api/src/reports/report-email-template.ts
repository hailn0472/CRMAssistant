/**
 * Story 6.5 (Contract D21, AC 11-12): branded email template rendering.
 * Pure module — escapes all user data, uses only validated tenant branding,
 * builds canonical CRM links, and never accepts raw HTML/CSS.
 */
import type { ScheduledReportPayload } from './scheduled-report-payload.service'

export type TenantBranding = {
  name: string
  logoUrl?: string | null
  primaryColor?: string | null
}

export const DEFAULT_PRIMARY_COLOR = '#1e3a5f'
const LOGO_URL_PATTERN = /^https:\/\//i
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export type SanitizedBranding = {
  name: string
  logoUrl: string | null
  primaryColor: string
}

/**
 * Defensive sanitization of tenant branding (rows may have been written
 * outside this feature). logoUrl must be an HTTPS URL (never fetched
 * server-side); primaryColor must be a six-digit hex. Unsafe values fall back
 * to the tenant name and the CRM default palette without throwing.
 */
export function sanitizeTenantBranding(
  branding: TenantBranding | null | undefined,
): SanitizedBranding {
  const name = branding?.name?.trim() || 'CRM'
  const logoUrl = branding?.logoUrl?.trim() ?? ''
  const primaryColor = branding?.primaryColor?.trim() ?? ''
  return {
    name,
    logoUrl: LOGO_URL_PATTERN.test(logoUrl) && logoUrl.length <= 2048 ? logoUrl : null,
    primaryColor: HEX_COLOR_PATTERN.test(primaryColor)
      ? primaryColor.toLowerCase()
      : DEFAULT_PRIMARY_COLOR,
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function emailSubject(payload: ScheduledReportPayload): string {
  // Report names are only length-checked upstream (no CR/LF stripping), so a
  // public report named `X\r\nBcc: victim@evil.com` could inject a header when
  // another user schedules it. Strip CR/LF and every other C0 control char so
  // the subject can never contain an embedded header line.
  const safeName = payload.reportName.replace(/[\r\n\u0000-\u001f\u007f]+/g, '')
  return `Your scheduled report: ${safeName}`
}

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/**
 * Renders multipart HTML + plain text. Both contain report name, date range,
 * generated time, escaped summary metrics, attachment filename and the
 * canonical CRM link. HTML uses semantic tables and the validated tenant
 * name/logo/primary color.
 */
export function renderScheduledReportEmail(input: {
  payload: ScheduledReportPayload
  branding: TenantBranding | null | undefined
  attachmentFilename: string
}): RenderedEmail {
  const { payload, attachmentFilename } = input
  const branding = sanitizeTenantBranding(input.branding)
  const generatedAt = new Date(payload.generatedAt).toISOString()

  const summaryRows = payload.summaryMetrics
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.label)}</td><td align="right">${
          m.value === null ? '<em>n/a</em>' : escapeHtml(String(m.value))
        }</td></tr>`,
    )
    .join('')

  const warningBlock =
    payload.warnings.length > 0
      ? `<div style="margin:16px 0;padding:10px;background:#fef3c7;color:#92400e;font-size:13px">${payload.warnings
          .map((w) => `<div>${escapeHtml(w.code)}: ${escapeHtml(w.message)}</div>`)
          .join('')}</div>`
      : ''

  const logoBlock = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.name)}" style="max-height:48px;max-width:200px;display:block;margin-bottom:8px" />`
    : `<div style="font-size:18px;font-weight:700;color:${branding.primaryColor};margin-bottom:8px">${escapeHtml(
        branding.name,
      )}</div>`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${branding.primaryColor};padding:20px 28px">
          ${logoBlock}
          <div style="color:#ffffff;font-size:14px">Scheduled report delivery</div>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 4px;font-size:20px;color:#0f172a">${escapeHtml(payload.reportName)}</h1>
          <div style="color:#64748b;font-size:13px;margin-bottom:20px">Date range: ${escapeHtml(
            payload.dateRangeLabel,
          )} &middot; Generated: ${escapeHtml(generatedAt)}</div>
          <h2 style="font-size:14px;color:${branding.primaryColor};margin:0 0 8px">Summary</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px">
            ${summaryRows}
          </table>
          ${warningBlock}
          <p style="font-size:13px;color:#334155;margin:12px 0">
            The full report is attached as <strong>${escapeHtml(attachmentFilename)}</strong>.
          </p>
          <p style="margin:20px 0 0">
            <a href="${escapeHtml(payload.crmUrl)}" style="background:${branding.primaryColor};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">View in CRM</a>
          </p>
          <p style="font-size:12px;color:#94a3b8;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px">
            You are receiving this because a scheduled report delivery was created for you in CRM Assistant.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const textLines = [
    `${payload.reportName}`,
    `Date range: ${payload.dateRangeLabel}`,
    `Generated: ${generatedAt}`,
    '',
    'Summary',
    ...payload.summaryMetrics.map((m) => `- ${m.label}: ${m.value === null ? 'n/a' : m.value}`),
    ...payload.warnings.map((w) => `[${w.code}] ${w.message}`),
    '',
    `The full report is attached as ${attachmentFilename}.`,
    `View in CRM: ${payload.crmUrl}`,
    '',
    `You are receiving this because a scheduled report delivery was created for you in ${branding.name}.`,
  ]

  return { subject: emailSubject(payload), html, text: textLines.join('\n') }
}
