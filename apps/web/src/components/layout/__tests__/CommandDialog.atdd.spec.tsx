/**
 * ATDD Component Tests — CommandDialog
 *
 * GREEN PHASE: CommandDialog component is now implemented.
 * All tests are active and verify the component behavior.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockPush = jest.fn()
const mockUsePathname = jest.fn(() => '/dashboard')

jest.mock('next/navigation', () => ({
  useRouter: (): { push: jest.Mock } => ({
    push: mockPush,
  }),
  usePathname: (): string => mockUsePathname(),
}))

import { CommandDialog } from '../CommandDialog'

describe('CommandDialog component ATDD', () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  it('[P1] renders accessible dialog with title and description', async () => {
    render(<CommandDialog open={true} onOpenChange={jest.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeVisible()

    await waitFor(() => {
      expect(dialog).toHaveAccessibleName('Search or run command')
      expect(dialog).toHaveAccessibleDescription(
        'Search CRM navigation actions and planned command shortcuts.',
      )
    })
  })

  it('[P1] renders Navigate group with enabled actions', () => {
    render(<CommandDialog open={true} onOpenChange={jest.fn()} />)

    expect(screen.getByRole('option', { name: /open contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /open deals/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /open dashboard/i })).toBeInTheDocument()
  })

  it('[P1] selecting an enabled navigate action calls router.push and closes dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()

    render(<CommandDialog open={true} onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('option', { name: /open contacts/i }))

    expect(mockPush).toHaveBeenCalledWith('/contacts')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('[P2] renders Create group items as disabled with planned indicator', () => {
    render(<CommandDialog open={true} onOpenChange={jest.fn()} />)

    const createContact = screen.getByText(/create contact/i)
    expect(createContact).toBeInTheDocument()

    const createDeal = screen.getByText(/create deal/i)
    expect(createDeal).toBeInTheDocument()

    // Disabled items should have planned markers
    expect(screen.getAllByText(/\(planned\)/i).length).toBeGreaterThanOrEqual(2)
  })

  it('[P2] disabled action item does not call router.push when clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()

    render(<CommandDialog open={true} onOpenChange={onOpenChange} />)

    // Create Contact is a disabled CommandItem — clicking it should trigger nothing
    const createContactItem = screen.getByRole('option', { name: /create contact/i })
    await user.click(createContactItem)

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('[P2] renders Ask AI as disabled with violet accent and planned label', () => {
    render(<CommandDialog open={true} onOpenChange={jest.fn()} />)

    const askAi = screen.getByText(/ask ai/i)
    expect(askAi).toBeInTheDocument()

    expect(screen.getByText('Planned — AI Query')).toBeInTheDocument()
  })

  it('[P2] renders Settings as disabled placeholder', () => {
    render(<CommandDialog open={true} onOpenChange={jest.fn()} />)

    const settings = screen.getByText(/open settings/i)
    expect(settings).toBeInTheDocument()

    // Settings is disabled
    const settingsItem = screen.getByRole('option', { name: /open settings/i })
    expect(settingsItem).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('CommandDialog keyboard shortcut', () => {
  it('[P1] Ctrl+K opens the dialog', () => {
    const onOpenChange = jest.fn()

    render(<CommandDialog open={false} onOpenChange={onOpenChange} />)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('[P1] Cmd+K opens the dialog on Mac', () => {
    const onOpenChange = jest.fn()

    render(<CommandDialog open={false} onOpenChange={onOpenChange} />)

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})

describe('CommandDialog focus management', () => {
  it('[P1] does not move focus to the trigger on initial closed render', async () => {
    const trigger = document.createElement('button')
    trigger.setAttribute('aria-label', 'Search or run command')
    document.body.appendChild(trigger)

    render(<CommandDialog open={false} onOpenChange={jest.fn()} />)

    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(trigger).not.toHaveFocus()

    document.body.removeChild(trigger)
  })

  it('[P1] Escape closes the dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()

    render(<CommandDialog open={true} onOpenChange={onOpenChange} />)

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('[P1] focus returns to trigger after closing via Escape', async () => {
    const user = userEvent.setup()

    // Create a trigger button in the DOM (simulating the topbar trigger)
    const trigger = document.createElement('button')
    trigger.setAttribute('aria-label', 'Search or run command')
    document.body.appendChild(trigger)

    const onOpenChange = jest.fn()

    const { rerender } = render(<CommandDialog open={true} onOpenChange={onOpenChange} />)

    await user.keyboard('{Escape}')

    // After closing, re-render with open=false to trigger the focus return effect
    rerender(<CommandDialog open={false} onOpenChange={onOpenChange} />)

    // Wait for requestAnimationFrame in the focus-return effect
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(trigger).toHaveFocus()

    document.body.removeChild(trigger)
  })
})
