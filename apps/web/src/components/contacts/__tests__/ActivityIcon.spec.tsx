import { render, screen } from '@testing-library/react'

import { ActivityIcon, ICON_CONFIGS, DEFAULT_CONFIG } from '../ActivityIcon'
import { CheckCircle2, ArrowRightLeft, MessageSquare, Send } from 'lucide-react'

describe('ActivityIcon', () => {
  it('renders the TASK_COMPLETED icon with the emerald colour vocabulary (AC 46 / W1)', () => {
    render(<ActivityIcon type="TASK_COMPLETED" />)

    expect(ICON_CONFIGS['TASK_COMPLETED'].icon).toBe(CheckCircle2)
    const wrapper = screen.getByTitle('Task Completed')
    expect(wrapper.className).toContain('bg-emerald-100')
    const svg = wrapper.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class')).toContain('text-emerald-600')
  })

  it('renders the DEAL_STAGE_CHANGED icon with the orange colour vocabulary (AC 46 / W2)', () => {
    render(<ActivityIcon type="DEAL_STAGE_CHANGED" />)

    expect(ICON_CONFIGS['DEAL_STAGE_CHANGED'].icon).toBe(ArrowRightLeft)
    const wrapper = screen.getByTitle('Stage Changed')
    expect(wrapper.className).toContain('bg-orange-100')
    const svg = wrapper.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class')).toContain('text-orange-600')
  })

  it('renders the MESSAGE_RECEIVED icon with the sky colour vocabulary (AC 46 / W3)', () => {
    render(<ActivityIcon type="MESSAGE_RECEIVED" />)

    expect(ICON_CONFIGS['MESSAGE_RECEIVED'].icon).toBe(MessageSquare)
    const wrapper = screen.getByTitle('Message Received')
    expect(wrapper.className).toContain('bg-sky-100')
    const svg = wrapper.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class')).toContain('text-sky-600')
  })

  it('renders the MESSAGE_SENT icon with the sky colour vocabulary (AC 46 / W4)', () => {
    render(<ActivityIcon type="MESSAGE_SENT" />)

    expect(ICON_CONFIGS['MESSAGE_SENT'].icon).toBe(Send)
    const wrapper = screen.getByTitle('Message Sent')
    expect(wrapper.className).toContain('bg-sky-100')
    const svg = wrapper.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('class')).toContain('text-sky-600')
  })

  it('falls back to DEFAULT_CONFIG for unknown types (W5)', () => {
    render(<ActivityIcon type={'UNKNOWN_TYPE' as never} />)

    expect(DEFAULT_CONFIG.icon).toBeDefined()
    const wrapper = screen.getByTitle('Activity')
    expect(wrapper.className).toContain('bg-slate-100')
  })

  it('keeps the pre-existing types rendering their icons (W6 regression)', () => {
    render(<ActivityIcon type="NOTE_ADDED" />)
    render(<ActivityIcon type="DEAL_CREATED" />)
    render(<ActivityIcon type="CONTACT_CREATED" />)
    render(<ActivityIcon type="CONTACT_UPDATED" />)
    render(<ActivityIcon type="CONTACT_OWNER_CHANGED" />)
    render(<ActivityIcon type="EMAIL_SENT" />)
    render(<ActivityIcon type="CALL_MADE" />)
    render(<ActivityIcon type="MEETING_SCHEDULED" />)

    expect(screen.getAllByTitle('Note Added')).toHaveLength(1)
    expect(screen.getAllByTitle('Deal Created')).toHaveLength(1)
    expect(screen.getAllByTitle('Contact Created')).toHaveLength(1)
    expect(screen.getAllByTitle('Contact Updated')).toHaveLength(1)
    expect(screen.getAllByTitle('Owner Changed')).toHaveLength(1)
    expect(screen.getAllByTitle('Email Sent')).toHaveLength(1)
    expect(screen.getAllByTitle('Call Made')).toHaveLength(1)
    expect(screen.getAllByTitle('Meeting Scheduled')).toHaveLength(1)
  })
})
