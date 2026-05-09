import { render, screen } from '@testing-library/react'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../card'

describe('Card', () => {
  it('renders Card with children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('renders CardHeader with children', () => {
    render(<CardHeader>Header content</CardHeader>)
    expect(screen.getByText('Header content')).toBeInTheDocument()
  })

  it('renders CardTitle with text', () => {
    render(<CardTitle>My Title</CardTitle>)
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })

  it('renders CardDescription with text', () => {
    render(<CardDescription>Some description</CardDescription>)
    expect(screen.getByText('Some description')).toBeInTheDocument()
  })

  it('renders CardContent with children', () => {
    render(<CardContent>Content here</CardContent>)
    expect(screen.getByText('Content here')).toBeInTheDocument()
  })

  it('renders CardFooter with children', () => {
    render(<CardFooter>Footer here</CardFooter>)
    expect(screen.getByText('Footer here')).toBeInTheDocument()
  })

  it('composes card components together', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    )
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Footer')).toBeInTheDocument()
  })

  it('applies custom className to Card', () => {
    const { container } = render(<Card className="custom-class">Content</Card>)
    const card = container.querySelector('div')
    expect(card).toHaveClass('custom-class')
  })
})
