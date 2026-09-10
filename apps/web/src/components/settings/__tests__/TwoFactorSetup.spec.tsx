import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(screen.getByAltText('QR Code for 2FA')).toHaveAttribute(
      'src',
      'data:image/png;base64,mock',
    )
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

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByText('Hủy'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('submits 6-digit code on verify', async () => {
    const user = userEvent.setup()
    mockOnVerify.mockResolvedValue({ success: true })
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl=""
        backupCodes={[]}
        onVerify={mockOnVerify}
        onCancel={jest.fn()}
      />,
    )

    const input = screen.getByLabelText('Mã xác thực 6 chữ số')
    await user.type(input, '123456')

    await user.click(screen.getByText('Xác thực'))
    expect(mockOnVerify).toHaveBeenCalledWith('123456')
  })

  it('shows error message when verify returns unsuccess', async () => {
    const user = userEvent.setup()
    mockOnVerify.mockResolvedValue({ success: false })
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl=""
        backupCodes={[]}
        onVerify={mockOnVerify}
        onCancel={jest.fn()}
      />,
    )

    const input = screen.getByLabelText('Mã xác thực 6 chữ số')
    await user.type(input, '123456')
    await user.click(screen.getByText('Xác thực'))

    expect(await screen.findByText('Mã xác thực không đúng')).toBeInTheDocument()
  })

  it('does not submit code shorter than 6 digits', async () => {
    const user = userEvent.setup()
    render(
      <TwoFactorSetup
        secret="MOCKSECRET"
        qrCodeDataUrl=""
        backupCodes={[]}
        onVerify={mockOnVerify}
        onCancel={jest.fn()}
      />,
    )

    const input = screen.getByLabelText('Mã xác thực 6 chữ số')
    await user.type(input, '123')

    const verifyButton = screen.getByText('Xác thực')
    expect(verifyButton).toBeDisabled()
  })
})
