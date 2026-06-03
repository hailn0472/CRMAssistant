import { render, screen } from '@testing-library/react'

import DashboardLoading from '../loading'

describe('DashboardLoading', () => {
  it('shows a calm auth resolving state for protected workspace routes', () => {
    render(<DashboardLoading />)

    expect(screen.getByRole('status')).toHaveAccessibleName('Đang kiểm tra phiên đăng nhập')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Đang kiểm tra phiên đăng nhập')).toBeInTheDocument()
    expect(
      screen.getByText('Vui lòng chờ trong giây lát trước khi mở workspace CRM.'),
    ).toBeInTheDocument()
  })
})
