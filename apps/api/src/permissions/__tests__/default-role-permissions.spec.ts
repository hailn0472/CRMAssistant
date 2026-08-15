/**
 * Story 6.2 (AC 19): Sales Manager gains REPORT CUD while preserving all other
 * grants; Sales Rep does not gain REPORT CUD; no RESOURCES/resourceLabel edit.
 */
import { DEFAULT_ROLE_PERMISSIONS } from '../default-role-permissions'

function has(
  resource: string,
  action: string,
  grants: { resource: string; action: string }[],
): boolean {
  return grants.some((g) => g.resource === resource && g.action === action)
}

describe('DEFAULT_ROLE_PERMISSIONS (AC 19)', () => {
  it('gives SALES_MANAGER REPORT:CREATE/UPDATE/DELETE on top of READ/EXPORT', () => {
    const grants = DEFAULT_ROLE_PERMISSIONS['SALES_MANAGER']
    expect(has('REPORT', 'READ', grants)).toBe(true)
    expect(has('REPORT', 'EXPORT', grants)).toBe(true)
    expect(has('REPORT', 'CREATE', grants)).toBe(true)
    expect(has('REPORT', 'UPDATE', grants)).toBe(true)
    expect(has('REPORT', 'DELETE', grants)).toBe(true)
  })

  it('does not give SALES_REP REPORT CUD (read-only remains)', () => {
    const grants = DEFAULT_ROLE_PERMISSIONS['SALES_REP']
    expect(has('REPORT', 'READ', grants)).toBe(true)
    expect(has('REPORT', 'CREATE', grants)).toBe(false)
    expect(has('REPORT', 'UPDATE', grants)).toBe(false)
    expect(has('REPORT', 'DELETE', grants)).toBe(false)
  })

  it('does not give MARKETING_USER REPORT CUD (read-only remains)', () => {
    const grants = DEFAULT_ROLE_PERMISSIONS['MARKETING_USER']
    expect(has('REPORT', 'READ', grants)).toBe(true)
    expect(has('REPORT', 'CREATE', grants)).toBe(false)
    expect(has('REPORT', 'UPDATE', grants)).toBe(false)
    expect(has('REPORT', 'DELETE', grants)).toBe(false)
  })

  it('preserves existing SALES_MANAGER grants (CONTACT/DEAL/TASK/PRODUCT/COMPETITOR/USER/INBOX)', () => {
    const grants = DEFAULT_ROLE_PERMISSIONS['SALES_MANAGER']
    expect(has('CONTACT', 'READ', grants)).toBe(true)
    expect(has('CONTACT', 'DELETE', grants)).toBe(true)
    expect(has('DEAL', 'READ', grants)).toBe(true)
    expect(has('DEAL', 'CREATE', grants)).toBe(true)
    // DEAL has no DELETE grant historically.
    expect(has('DEAL', 'DELETE', grants)).toBe(false)
    expect(has('TASK', 'READ', grants)).toBe(true)
    expect(has('PRODUCT', 'CREATE', grants)).toBe(true)
    expect(has('COMPETITOR', 'READ', grants)).toBe(true)
    expect(has('USER', 'READ', grants)).toBe(true)
    expect(has('INBOX', 'WRITE', grants)).toBe(true)
  })

  it('keeps ADMIN with only the bypass marker (no REPORT rows needed)', () => {
    expect(DEFAULT_ROLE_PERMISSIONS['ADMIN']).toEqual([{ resource: 'DATA', action: 'VIEW_ALL' }])
  })
})
