import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ShareSection } from '../ShareSection'

jest.mock('@/components/sharing/ShareDialog', () => ({
  ShareDialog: function MockShareDialog({ open }: { open: boolean }) {
    return open ? <div data-testid="share-dialog">Share Dialog</div> : null
  },
}))

describe('ShareSection', () => {
  it('renders share button', () => {
    render(<ShareSection resourceType="CONTACT" resourceId="id-1" />)

    expect(screen.getByText('Share')).toBeInTheDocument()
  })

  it('opens ShareDialog when button is clicked', async () => {
    const user = userEvent.setup()
    render(<ShareSection resourceType="CONTACT" resourceId="id-1" />)

    await user.click(screen.getByText('Share'))

    expect(screen.getByTestId('share-dialog')).toBeInTheDocument()
  })
})
