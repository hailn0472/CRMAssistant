import { render, screen } from '@testing-library/react'
import { TwoFactorSetup } from '../TwoFactorSetup'

const mockOnVerify = jest.fn()

describe('TwoFactorSetup', () => {
  beforeEach(() => {
    mockOnVerify.mockReset()
  })

  it('renders QR code image when qrCodeDataUrl is provided', () => {
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl="data:image/png;base64,mock"
        backupCodes={['CODE1']}
        onVerify={mockOnVerify}
        onCancel={jest.fn()}
      />,
    )

    expect(screen.getByAltText('QR Code for 2FA')).toHaveAttribute('src', 'data:image/png;base64,mock')
  })

  it('renders the manual secret code', () => {
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl=""
        backupCodes={['CODE1']}
        onVerify={mockOnVerify}
        onCancel={jest.fn()}
      />,
    )

    expect(screen.getByText('MOCKSECRET')).toBeInTheDocument()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = jest.fn()
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl=""
        backupCodes={['CODE1']}
        onVerify={mockOnVerify}
        onCancel={onCancel}
      />,
    )

    const buttons = screen.getAllByRole('button')
    const cancelButton = buttons.find((b) => b.textContent === 'Hủy')
    expect(cancelButton).toBeInTheDocument()
    cancelButton?.click()
    expect(onCancel).toHaveBeenCalled()
  })
})
