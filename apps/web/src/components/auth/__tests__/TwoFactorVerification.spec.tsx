import { render, screen } from '@testing-library/react'
import { TwoFactorVerification } from '../TwoFactorVerification'

describe('TwoFactorVerification', () => {
  it('renders 6 digit input boxes', () => {
    render(
      <TwoFactorVerification
        onSubmit={jest.fn()}
        isSubmitting={false}
        error={null}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(6)
  })

  it('renders submit button', () => {
    render(
      <TwoFactorVerification
        onSubmit={jest.fn()}
        isSubmitting={false}
        error={null}
      />,
    )

    expect(screen.getByText('Xác thực')).toBeInTheDocument()
  })

  it('displays error message when error is provided', () => {
    render(
      <TwoFactorVerification
        onSubmit={jest.fn()}
        isSubmitting={false}
        error={'Mã xác thực không đúng'}
      />,
    )

    expect(screen.getByText('Mã xác thực không đúng')).toBeInTheDocument()
  })

  it('disables inputs when submitting', () => {
    render(
      <TwoFactorVerification
        onSubmit={jest.fn()}
        isSubmitting={true}
        error={null}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    for (const input of inputs) {
      expect(input).toBeDisabled()
    }
  })

  it('shows backup codes remaining warning', () => {
    render(
      <TwoFactorVerification
        onSubmit={jest.fn()}
        isSubmitting={false}
        error={null}
        backupCodesRemaining={2}
      />,
    )

    expect(screen.getByText(/Còn 2 mã dự phòng/)).toBeInTheDocument()
  })
})
