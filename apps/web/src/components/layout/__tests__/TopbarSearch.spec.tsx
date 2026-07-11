import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TopbarSearch } from '../TopbarSearch'

describe('TopbarSearch', () => {
  it('renders search input with placeholder', () => {
    render(<TopbarSearch value="" onChange={jest.fn()} onFocus={jest.fn()} />)

    expect(screen.getByPlaceholderText('Search or run command')).toBeInTheDocument()
  })

  it('displays current value', () => {
    render(<TopbarSearch value="test" onChange={jest.fn()} onFocus={jest.fn()} />)

    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.value).toBe('test')
  })

  it('calls onChange when value changes', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<TopbarSearch value="" onChange={onChange} onFocus={jest.fn()} />)

    await user.type(screen.getByRole('searchbox'), 'a')

    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('calls onFocus when input is focused', async () => {
    const user = userEvent.setup()
    const onFocus = jest.fn()
    render(<TopbarSearch value="" onChange={jest.fn()} onFocus={onFocus} />)

    await user.click(screen.getByRole('searchbox'))

    expect(onFocus).toHaveBeenCalled()
  })

  it('renders Ctrl K shortcut badge', () => {
    render(<TopbarSearch value="" onChange={jest.fn()} onFocus={jest.fn()} />)

    expect(screen.getByText('Ctrl K')).toBeInTheDocument()
  })
})
