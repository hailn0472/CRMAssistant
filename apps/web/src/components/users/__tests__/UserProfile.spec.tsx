import { render, screen } from '@testing-library/react'

import { UserProfile } from '../UserProfile'
import type { User } from '@/services/user.service'

const baseUser: User = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ADMIN',
  isActive: true,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('UserProfile', () => {
  it('renders user full name and email', () => {
    render(<UserProfile user={baseUser} />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  })

  it('renders initials as fallback when avatar is missing', () => {
    render(<UserProfile user={baseUser} />)

    expect(screen.getByText('AL')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders avatar image when avatar URL is provided', () => {
    render(<UserProfile user={{ ...baseUser, avatar: 'https://example.com/avatar.jpg' }} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    expect(img).toHaveAttribute('alt', 'Ada Lovelace')
  })

  it('renders job title when present', () => {
    render(<UserProfile user={{ ...baseUser, jobTitle: 'Engineer' }} />)

    expect(screen.getByText('Engineer')).toBeInTheDocument()
  })

  it('falls back to role when job title is absent', () => {
    render(<UserProfile user={baseUser} />)

    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('renders initials for single-name users', () => {
    render(
      <UserProfile
        user={{ ...baseUser, firstName: 'Madonna', lastName: '', email: 'madonna@example.com' }}
      />,
    )

    expect(screen.getByText('M')).toBeInTheDocument()
  })
})
