/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Message } from '@prisma/client'

import { buildOutboundFacebookPayload, mapInboundFacebookMessage } from '../facebook-message-mapper'

const NOW = new Date('2026-07-19T00:00:00.000Z')

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'agent-1',
    senderType: 'AGENT' as any,
    content: 'Hello',
    messageType: 'TEXT' as any,
    internalNote: false,
    metadata: null,
    sentAt: NOW,
    deliveredAt: null,
    readAt: null,
    createdAt: NOW,
    createdBy: 'agent-1',
    ...overrides,
  }
}

describe('mapInboundFacebookMessage()', () => {
  it('maps a text message', () => {
    const result = mapInboundFacebookMessage({ mid: 'mid.1', text: 'Hi there' })
    expect(result).toEqual({ content: 'Hi there', messageType: 'TEXT', metadata: { mid: 'mid.1' } })
  })

  it('maps an image attachment', () => {
    const result = mapInboundFacebookMessage({
      mid: 'mid.2',
      attachments: [{ type: 'image', payload: { url: 'https://cdn.fb.com/img.jpg' } }],
    })
    expect(result.content).toBe('https://cdn.fb.com/img.jpg')
    expect(result.messageType).toBe('IMAGE')
  })

  it('maps a video attachment', () => {
    const result = mapInboundFacebookMessage({
      attachments: [{ type: 'video', payload: { url: 'https://cdn.fb.com/vid.mp4' } }],
    })
    expect(result.messageType).toBe('VIDEO')
  })

  it('maps a file/unknown attachment to FILE', () => {
    const result = mapInboundFacebookMessage({
      attachments: [{ type: 'file', payload: { url: 'https://cdn.fb.com/doc.pdf' } }],
    })
    expect(result.messageType).toBe('FILE')
  })

  it('falls back to a placeholder when attachment has no url', () => {
    const result = mapInboundFacebookMessage({ attachments: [{ type: 'image', payload: {} }] })
    expect(result.content).toBe('[image attachment]')
  })

  it('preserves every attachment when a message has more than one', () => {
    const result = mapInboundFacebookMessage({
      mid: 'mid.4',
      attachments: [
        { type: 'image', payload: { url: 'https://cdn.fb.com/a.jpg' } },
        { type: 'image', payload: { url: 'https://cdn.fb.com/b.jpg' } },
      ],
    })
    expect(result.content).toBe('https://cdn.fb.com/a.jpg\nhttps://cdn.fb.com/b.jpg')
    expect(result.messageType).toBe('IMAGE')
    expect(result.metadata?.['attachments']).toHaveLength(2)
  })

  it('falls back to an unsupported placeholder when neither text nor attachments are present', () => {
    const result = mapInboundFacebookMessage({ mid: 'mid.3' })
    expect(result.content).toBe('[Unsupported Facebook message]')
    expect(result.messageType).toBe('TEXT')
  })
})

describe('buildOutboundFacebookPayload()', () => {
  it('builds a text payload', () => {
    const payload = buildOutboundFacebookPayload(makeMessage({ content: 'Hello there' }))
    expect(payload).toEqual({ text: 'Hello there' })
  })

  it('builds an image attachment payload', () => {
    const payload = buildOutboundFacebookPayload(
      makeMessage({ messageType: 'IMAGE' as any, content: 'https://example.com/a.png' }),
    )
    expect(payload).toEqual({
      attachment: {
        type: 'image',
        payload: { url: 'https://example.com/a.png', is_reusable: true },
      },
    })
  })

  it('builds a video attachment payload', () => {
    const payload = buildOutboundFacebookPayload(
      makeMessage({ messageType: 'VIDEO' as any, content: 'https://example.com/a.mp4' }),
    )
    expect(payload).toEqual({
      attachment: {
        type: 'video',
        payload: { url: 'https://example.com/a.mp4', is_reusable: true },
      },
    })
  })

  it('builds a file attachment payload', () => {
    const payload = buildOutboundFacebookPayload(
      makeMessage({ messageType: 'FILE' as any, content: 'https://example.com/a.pdf' }),
    )
    expect(payload).toEqual({
      attachment: {
        type: 'file',
        payload: { url: 'https://example.com/a.pdf', is_reusable: true },
      },
    })
  })

  it('builds a template payload from metadata', () => {
    const template = { template_type: 'button', text: 'Choose', buttons: [] }
    const payload = buildOutboundFacebookPayload(
      makeMessage({ messageType: 'TEMPLATE' as any, metadata: { template } as any }),
    )
    expect(payload).toEqual({ attachment: { type: 'template', payload: template } })
  })

  it('falls back to text when TEMPLATE type has no template metadata', () => {
    const payload = buildOutboundFacebookPayload(
      makeMessage({ messageType: 'TEMPLATE' as any, content: 'fallback text' }),
    )
    expect(payload).toEqual({ text: 'fallback text' })
  })

  it('includes quick replies alongside a text message', () => {
    const payload = buildOutboundFacebookPayload(
      makeMessage({
        content: 'Pick one',
        metadata: { quickReplies: [{ title: 'Yes', payload: 'YES' }] } as any,
      }),
    )
    expect(payload).toEqual({
      text: 'Pick one',
      quick_replies: [{ content_type: 'text', title: 'Yes', payload: 'YES' }],
    })
  })
})
