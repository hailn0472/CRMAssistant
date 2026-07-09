import { render, screen, fireEvent } from '@testing-library/react'
import { BackupCodesDisplay } from '../BackupCodesDisplay'

describe('BackupCodesDisplay', () => {
  const codes = ['CODE1234', 'CODE5678', 'CODE9012']

  it('renders all backup codes', () => {
    render(<BackupCodesDisplay codes={codes} />)

    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument()
    }
  })

  it('renders copy button', () => {
    render(<BackupCodesDisplay codes={codes} />)

    expect(screen.getByText('Sao chép tất cả')).toBeInTheDocument()
  })

  it('shows confirmed button when onConfirmed is provided', () => {
    render(<BackupCodesDisplay codes={codes} onConfirmed={jest.fn()} />)

    expect(screen.getByText('Tôi đã lưu các mã này')).toBeInTheDocument()
  })

  it('calls onConfirmed when button is clicked', () => {
    const onConfirmed = jest.fn()
    render(<BackupCodesDisplay codes={codes} onConfirmed={onConfirmed} />)

    fireEvent.click(screen.getByText('Tôi đã lưu các mã này'))
    expect(onConfirmed).toHaveBeenCalled()
  })
})
