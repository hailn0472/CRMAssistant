import { BadRequestException } from '@nestjs/common'

export const MAX_NOTE_BODY_LENGTH = 5000

export const NOTE_PARENTS = ['CONTACT', 'DEAL'] as const

export function normalizeNoteBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

export function assertValidNoteBody(body: string): void {
  if (!body) {
    throw new BadRequestException('Note body is required')
  }
  if (body.length > MAX_NOTE_BODY_LENGTH) {
    throw new BadRequestException(`Note body must not exceed ${MAX_NOTE_BODY_LENGTH} characters`)
  }
}

export function resolveNoteParent(input: { contactId?: string | null; dealId?: string | null }): {
  parent: (typeof NOTE_PARENTS)[number]
  id: string
} {
  const hasContact = !!input.contactId
  const hasDeal = !!input.dealId

  if (hasContact && hasDeal) {
    throw new BadRequestException('A note must be attached to exactly one of contactId or dealId')
  }
  if (!hasContact && !hasDeal) {
    throw new BadRequestException('A note must be attached to exactly one of contactId or dealId')
  }

  if (hasContact) {
    return { parent: 'CONTACT', id: input.contactId! }
  }
  return { parent: 'DEAL', id: input.dealId! }
}
