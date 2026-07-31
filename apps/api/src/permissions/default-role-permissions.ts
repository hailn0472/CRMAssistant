const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN'] as const

export function buildAllPermissionActions(
  resource: string,
): { resource: string; action: string }[] {
  return ACTIONS.map((a) => ({ resource, action: a }))
}

/**
 * Default permission assignments for system roles (Story 2.3).
 *
 * ADMIN bypasses permission checks in code, so it needs zero DB rows (empty array).
 * SALES_MANAGER: 23 permissions
 * SALES_REP: 14 permissions
 * SUPPORT_AGENT: 9 permissions
 * MARKETING_USER: 4 permissions
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ADMIN: [{ resource: 'DATA', action: 'VIEW_ALL' }],
  SALES_MANAGER: [
    ...ACTIONS.map((a) => ({ resource: 'CONTACT', action: a })),
    ...ACTIONS.filter((a) => a !== 'DELETE').map((a) => ({ resource: 'DEAL', action: a })),
    ...ACTIONS.filter((a) => a !== 'EXPORT' && a !== 'IMPORT').map((a) => ({
      resource: 'TASK',
      action: a,
    })),
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
    { resource: 'PRODUCT', action: 'CREATE' },
    { resource: 'PRODUCT', action: 'READ' },
    { resource: 'PRODUCT', action: 'UPDATE' },
    ...ACTIONS.map((a) => ({ resource: 'COMPETITOR', action: a })),
    { resource: 'USER', action: 'READ' },
    { resource: 'INBOX', action: 'READ' },
    { resource: 'INBOX', action: 'WRITE' },
  ],
  SALES_REP: [
    { resource: 'CONTACT', action: 'CREATE' },
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'CONTACT', action: 'UPDATE' },
    { resource: 'CONTACT', action: 'DELETE' },
    { resource: 'DEAL', action: 'CREATE' },
    { resource: 'DEAL', action: 'READ' },
    { resource: 'DEAL', action: 'UPDATE' },
    { resource: 'DEAL', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
    { resource: 'COMPETITOR', action: 'READ' },
    { resource: 'TASK', action: 'CREATE' },
    { resource: 'TASK', action: 'READ' },
    { resource: 'TASK', action: 'UPDATE' },
    { resource: 'TASK', action: 'DELETE' },
    { resource: 'REPORT', action: 'READ' },
    { resource: 'INBOX', action: 'READ' },
    { resource: 'INBOX', action: 'WRITE' },
  ],
  SUPPORT_AGENT: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'CONTACT', action: 'UPDATE' },
    ...ACTIONS.map((a) => ({ resource: 'TICKET', action: a })),
    { resource: 'TASK', action: 'READ' },
    { resource: 'TASK', action: 'UPDATE' },
    { resource: 'INBOX', action: 'READ' },
    { resource: 'INBOX', action: 'WRITE' },
  ],
  MARKETING_USER: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'CONTACT', action: 'EXPORT' },
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
  ],
}
