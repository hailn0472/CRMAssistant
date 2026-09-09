import { BadRequestException } from '@nestjs/common'

export const MAX_NOTE_BODY_LENGTH = 5000

export function normalizeNoteBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

export function assertValidNoteBody(body: string): void {
  if (!body) throw new BadRequestException('Note body is required')
  if (body.length > MAX_NOTE_BODY_LENGTH) {
    throw new BadRequestException(`Note body must not exceed ${MAX_NOTE_BODY_LENGTH} characters`)
  }
}
