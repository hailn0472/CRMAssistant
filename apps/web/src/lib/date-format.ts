/** Shared "3 Aug 2026" (optionally "3 Aug 2026, 14:05") date formatting for the deals UI. */
export function formatDate(
  dateString?: string | null,
  options: { includeTime?: boolean } = {},
): string {
  if (!dateString) return '—'
  try {
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(options.includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    })
  } catch {
    return '—'
  }
}
