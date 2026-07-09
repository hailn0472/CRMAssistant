// Test the CSV utility function
import { auditLogsToCsv } from '@/services/audit.service'
import type { AuditLogEntry } from '@/services/audit.service'

describe('AuditLogPage', () => {
  describe('auditLogsToCsv', () => {
    const sampleLogs: AuditLogEntry[] = [
      {
        id: '1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'CONTACT',
        entityId: 'contact-1',
        details: null,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        createdAt: '2026-07-09T12:00:00.000Z',
        user: { id: 'user-1', email: 'test@test.com', firstName: 'John', lastName: 'Doe' },
      },
    ]

    it('generates CSV with headers', () => {
      const csv = auditLogsToCsv(sampleLogs)
      expect(csv).toContain('Timestamp,User,Action,Resource Type,Resource ID,IP Address,Details')
    })

    it('includes log data in CSV', () => {
      const csv = auditLogsToCsv(sampleLogs)
      expect(csv).toContain('John Doe')
      expect(csv).toContain('CREATE')
      expect(csv).toContain('CONTACT')
      expect(csv).toContain('192.168.1.1')
    })

    it('handles empty logs', () => {
      const csv = auditLogsToCsv([])
      expect(csv).toContain('Timestamp')
      expect(csv.split('\n').length).toBe(1) // headers only
    })

    it('escapes commas in values', () => {
      const logWithComma: AuditLogEntry[] = [
        {
          id: '2',
          userId: 'user-2',
          action: 'CREATE',
          entity: 'CONTACT',
          entityId: 'contact-2',
          details: '{"note":"hello, world"}',
          ipAddress: null,
          userAgent: null,
          createdAt: '2026-07-09T12:00:00.000Z',
          user: null,
        },
      ]
      const csv = auditLogsToCsv(logWithComma)
      expect(csv).toContain('"')
    })
  })
})
