import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AvatarUpload } from '../AvatarUpload'

describe('AvatarUpload', () => {
  it('renders initial avatar as initials fallback when no currentUrl', () => {
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={jest.fn()} />)

    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('renders image preview when currentUrl is provided', () => {
    render(
      <AvatarUpload
        currentUrl="https://example.com/avatar.jpg"
        firstName="Ada"
        lastName="Lovelace"
        onUpload={jest.fn()}
      />,
    )

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    expect(img).toHaveAttribute('alt', 'Avatar preview')
  })

  it('shows "Upload photo" button when no preview exists', () => {
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={jest.fn()} />)

    expect(screen.getByRole('button', { name: /upload photo/i })).toBeInTheDocument()
  })

  it('shows "Change photo" button when preview exists', () => {
    render(
      <AvatarUpload
        currentUrl="https://example.com/avatar.jpg"
        firstName="Ada"
        lastName="Lovelace"
        onUpload={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /change photo/i })).toBeInTheDocument()
  })

  it('shows size and type helper text', () => {
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={jest.fn()} />)

    expect(screen.getByText('JPG or PNG, max 2MB')).toBeInTheDocument()
  })

  it('rejects files larger than 2MB', async () => {
    const user = userEvent.setup()
    const onUpload = jest.fn()
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const bigFile = new File(['x'.repeat(3 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, bigFile)

    expect(await screen.findByRole('alert')).toHaveTextContent('Image must be less than 2MB')
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('rejects non-JPG/PNG file types', async () => {
    const onUpload = jest.fn()
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const gifFile = new File(['x'], 'avatar.gif', { type: 'image/gif' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // fireEvent bypasses user-event's accept-attribute filtering
    Object.defineProperty(input, 'files', { value: [gifFile] })
    fireEvent.change(input)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only JPG and PNG images are allowed',
    )
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('calls onUpload with valid JPG file and shows preview', async () => {
    const user = userEvent.setup()
    const onUpload = jest.fn().mockResolvedValue('https://example.com/new-avatar.jpg')
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const validFile = new File(['valid-image-content'], 'photo.jpg', { type: 'image/jpeg' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, validFile)

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(validFile)
    })

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/new-avatar.jpg')
  })

  it('calls onUpload with valid PNG file', async () => {
    const user = userEvent.setup()
    const onUpload = jest.fn().mockResolvedValue('https://example.com/new-avatar.png')
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const validFile = new File(['png-content'], 'photo.png', { type: 'image/png' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, validFile)

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(validFile)
    })
  })

  it('shows error when onUpload rejects', async () => {
    const user = userEvent.setup()
    const onUpload = jest.fn().mockRejectedValue(new Error('Storage full'))
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const validFile = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, validFile)

    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  })

  it('shows generic error when onUpload rejects with non-Error', async () => {
    const user = userEvent.setup()
    const onUpload = jest.fn().mockRejectedValue('upload failed string')
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={onUpload} />)

    const validFile = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, validFile)

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed')
  })

  it('accept attribute restricts to JPG and PNG', () => {
    render(<AvatarUpload firstName="Ada" lastName="Lovelace" onUpload={jest.fn()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png')
  })
})
