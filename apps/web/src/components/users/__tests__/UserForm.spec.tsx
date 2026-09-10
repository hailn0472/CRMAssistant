import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { UserForm } from '../UserForm'
import { createUser, updateUser } from '@/services/user.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/user.service', () => ({
  createUser: jest.fn(),
  updateUser: jest.fn(),
}))

describe('UserForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('create mode', () => {
    it('shows "Create user" button label', () => {
      render(<UserForm />)

      expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument()
    })

    it('shows validation errors for empty required fields', async () => {
      const user = userEvent.setup()
      render(<UserForm />)

      await user.click(screen.getByRole('button', { name: /create user/i }))

      expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
      expect(screen.getByText('First name is required')).toBeInTheDocument()
      expect(screen.getByText('Last name is required')).toBeInTheDocument()
    })

    it('submits valid create values', async () => {
      const user = userEvent.setup()
      ;(createUser as jest.Mock).mockResolvedValue({ id: 'user-1' })
      render(<UserForm />)

      await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.click(screen.getByRole('button', { name: /create user/i }))

      await waitFor(() => {
        expect(createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
          }),
        )
      })
    })

    it('shows server error inline on failure', async () => {
      const user = userEvent.setup()
      ;(createUser as jest.Mock).mockRejectedValue(new Error('Duplicate email'))
      render(<UserForm />)

      await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.click(screen.getByRole('button', { name: /create user/i }))

      expect(await screen.findByText('Duplicate email')).toBeInTheDocument()
    })

    it('hands the saved user to onSaved instead of navigating', async () => {
      const user = userEvent.setup()
      ;(createUser as jest.Mock).mockResolvedValue({ id: 'user-new' })
      const onSaved = jest.fn()
      render(<UserForm onSaved={onSaved} />)

      await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.click(screen.getByRole('button', { name: /create user/i }))

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledWith({ id: 'user-new' })
      })
    })

    it('calls onCancel instead of rendering a bare submit when embedded', async () => {
      const user = userEvent.setup()
      const onCancel = jest.fn()
      render(<UserForm onCancel={onCancel} />)

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('edit mode', () => {
    const existingUser = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: [{ id: 'role-1', name: 'ADMIN' }],
      isActive: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }

    it('shows "Save user" button label', () => {
      render(<UserForm user={existingUser} />)

      expect(screen.getByRole('button', { name: /save user/i })).toBeInTheDocument()
    })

    it('pre-populates fields from existing user', () => {
      render(<UserForm user={existingUser} />)

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement
      expect(emailInput.value).toBe('ada@example.com')
      expect(emailInput).toBeDisabled()

      const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement
      expect(firstNameInput.value).toBe('Ada')
    })

    it('submits update with changed values', async () => {
      const user = userEvent.setup()
      ;(updateUser as jest.Mock).mockResolvedValue({ id: 'user-1' })
      render(<UserForm user={existingUser} />)

      const firstNameInput = screen.getByLabelText(/first name/i)
      await user.clear(firstNameInput)
      await user.type(firstNameInput, 'Augusta')
      await user.click(screen.getByRole('button', { name: /save user/i }))

      await waitFor(() => {
        expect(updateUser).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({ firstName: 'Augusta' }),
        )
      })
    })
  })
})
