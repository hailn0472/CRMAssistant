import { render } from '@testing-library/react'

import { AppToaster } from '../AppToaster'

describe('AppToaster', () => {
  it('renders without crashing', () => {
    const { container } = render(<AppToaster />)
    expect(container).toBeTruthy()
  })
})
