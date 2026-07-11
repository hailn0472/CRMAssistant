import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import TagsManagementPage from '../page'

jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn(),
  deleteTag: jest.fn(),
}))

jest.mock('@/components/layout/AppShell', () => ({
  WorkspaceHeader: ({ title }: { title: string }) => <div>{title}</div>,
}))

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TagsManagementPage', () => {
  it('renders without crashing', () => {
    const { container } = renderWithQuery(<TagsManagementPage />)
    expect(container).toBeTruthy()
  })
})
