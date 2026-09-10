import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SalesAssistantWorkspace } from '../SalesAssistantWorkspace'
import { executeTextToSqlPreview, generateTextToSqlPreview } from '@/services/text-to-sql.service'

jest.mock('@/services/text-to-sql.service', () => ({
  generateTextToSqlPreview: jest.fn(),
  executeTextToSqlPreview: jest.fn(),
  TextToSqlError: class TextToSqlError extends Error {},
}))

describe('SalesAssistantWorkspace', () => {
  const generatePreviewMock = jest.mocked(generateTextToSqlPreview)
  const executePreviewMock = jest.mocked(executeTextToSqlPreview)

  function renderWorkspace(): void {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <SalesAssistantWorkspace />
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends a natural-language question and presents the safe SQL preview', async () => {
    generatePreviewMock.mockResolvedValue({
      sql: 'SELECT "id" FROM "Task" WHERE "tenantId" = :tenantId LIMIT 10',
      explanation: 'Shows overdue tasks.',
      intent: 'OVERDUE_TASKS',
      model: 'gemini-test',
      executionToken: 'signed-preview',
      status: 'preview',
    })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Which open tasks are overdue?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }))

    expect(await screen.findByText('Safe query preview')).toBeInTheDocument()
    expect(screen.getByText('Shows overdue tasks.')).toBeInTheDocument()
    expect(generatePreviewMock.mock.calls[0]?.[0]).toBe('Which open tasks are overdue?')
  })

  it('explains that a blank question cannot be submitted', () => {
    renderWorkspace()

    expect(screen.getByRole('button', { name: 'Generate preview' })).toBeDisabled()
  })

  it('runs a signed preview and presents the assistant response', async () => {
    const preview = {
      sql: 'SELECT "id" FROM "Task" WHERE "tenantId" = :tenantId LIMIT 10',
      explanation: 'Shows overdue tasks.',
      intent: 'OVERDUE_TASKS' as const,
      model: 'gemini-test',
      executionToken: 'signed-preview',
      status: 'preview' as const,
    }
    generatePreviewMock.mockResolvedValue(preview)
    executePreviewMock.mockResolvedValue({
      answer: 'You have one overdue task that needs attention.',
      suggestedNextSteps: ['Contact the owner today.'],
      rows: [{ title: 'Call Ada', status: 'TODO' }],
      rowCount: 1,
      status: 'completed',
    })
    renderWorkspace()

    fireEvent.change(screen.getByLabelText('What do you need to know?'), {
      target: { value: 'Which open tasks are overdue?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }))
    await screen.findByRole('button', { name: 'Run query' })
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    expect(
      await screen.findByText('You have one overdue task that needs attention.'),
    ).toBeInTheDocument()
    expect(executePreviewMock.mock.calls[0]?.[0]).toBe('Which open tasks are overdue?')
    expect(executePreviewMock.mock.calls[0]?.[1]).toEqual(preview)
  })
})
