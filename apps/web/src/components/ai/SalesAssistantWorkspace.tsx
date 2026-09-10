'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  executeTextToSqlPreview,
  generateTextToSqlPreview,
  TextToSqlError,
} from '@/services/text-to-sql.service'
import type { TextToSqlExecution, TextToSqlPreview } from '@/types/text-to-sql.types'

const SUGGESTED_QUESTIONS = [
  'Which open tasks are overdue?',
  'Show the lead pipeline by status.',
  'Which active contacts should I follow up with?',
]

function getErrorMessage(error: unknown): string {
  if (error instanceof TextToSqlError) return error.message
  return 'The sales assistant could not complete that request. Please try again.'
}

function SqlPreview({
  preview,
  isExecuting,
  onExecute,
}: {
  preview: TextToSqlPreview
  isExecuting: boolean
  onExecute: () => void
}): React.JSX.Element {
  return (
    <section
      aria-label="Generated query preview"
      className="overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-1 border-b border-indigo-100 bg-indigo-50/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">Safe query preview</h2>
          <p className="mt-1 text-[13px] leading-5 text-slate-600">{preview.explanation}</p>
        </div>
        <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
          Preview only
        </span>
      </div>
      <div className="p-5">
        <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-[12px] leading-6 text-slate-100">
          <code>{preview.sql}</code>
        </pre>
        <p className="mt-3 text-[12px] leading-5 text-slate-500">
          Running this preview uses a tenant-bound, read-only transaction. It cannot modify CRM
          data.
        </p>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onExecute} disabled={isExecuting} variant="outline">
            {isExecuting ? 'Running query…' : 'Run query'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function AssistantResponse({ execution }: { execution: TextToSqlExecution }): React.JSX.Element {
  const columns = execution.rows.length > 0 ? Object.keys(execution.rows[0] ?? {}) : []

  return (
    <section
      aria-label="Sales assistant response"
      className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"
    >
      <div className="border-b border-emerald-100 bg-emerald-50/70 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
          Sales Assistant
        </p>
        <h2 className="mt-1 text-[16px] font-semibold leading-6 text-slate-950">
          {execution.answer}
        </h2>
        <p className="mt-1 text-[12px] text-slate-500">
          Based on {execution.rowCount} matching CRM record{execution.rowCount === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="space-y-5 p-5">
        {execution.suggestedNextSteps.length > 0 ? (
          <div>
            <h3 className="text-[13px] font-semibold text-slate-800">Suggested next steps</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-slate-600">
              {execution.suggestedNextSteps.map((step) => (
                <li key={step} className="flex gap-2">
                  <span aria-hidden="true" className="text-emerald-600">
                    •
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {columns.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-[12px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2.5 font-semibold"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {execution.rows.slice(0, 20).map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column} className="max-w-64 px-3 py-2.5 align-top">
                        <span className="line-clamp-3">{formatCell(row[column])}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {execution.rowCount > 20 ? (
          <p className="text-[12px] text-slate-500">Showing the first 20 records in this view.</p>
        ) : null}
      </div>
    </section>
  )
}

export function SalesAssistantWorkspace(): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const previewMutation = useMutation({ mutationFn: generateTextToSqlPreview })
  const executionMutation = useMutation({
    mutationFn: ({
      question: currentQuestion,
      preview,
    }: {
      question: string
      preview: TextToSqlPreview
    }) => executeTextToSqlPreview(currentQuestion, preview),
  })
  const canSubmit = question.trim().length > 0 && !previewMutation.isPending

  function submitQuestion(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const normalizedQuestion = question.trim()
    if (!normalizedQuestion) return
    executionMutation.reset()
    previewMutation.mutate(normalizedQuestion)
  }

  function selectSuggestedQuestion(suggestedQuestion: string): void {
    setQuestion(suggestedQuestion)
  }

  function executePreview(): void {
    if (!previewMutation.data || !question.trim()) return
    executionMutation.mutate({ question: question.trim(), preview: previewMutation.data })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Sparkles aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[27px] font-semibold tracking-[-0.025em] text-[#1b1b1f]">
            Sales Assistant
          </h1>
          <p className="mt-1 text-[13.5px] leading-6 text-[#77777f]">
            Ask a CRM question in plain language and review a tenant-scoped, read-only query before
            it can be used.
          </p>
        </div>
      </div>

      <form
        aria-label="Ask the sales assistant"
        onSubmit={submitQuestion}
        className="rounded-2xl border border-[#ececf0] bg-white p-5 shadow-sm"
      >
        <label htmlFor="sales-question" className="text-[14px] font-semibold text-slate-900">
          What do you need to know?
        </label>
        <Textarea
          id="sales-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="For example: Which open tasks are overdue this week?"
          maxLength={2_000}
          className="mt-2 min-h-28 resize-y border-slate-200 text-[14px] leading-6 focus-visible:ring-indigo-600"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((suggestedQuestion) => (
              <button
                key={suggestedQuestion}
                type="button"
                onClick={() => selectSuggestedQuestion(suggestedQuestion)}
                className={cn(
                  'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 transition-colors',
                  'hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                )}
              >
                {suggestedQuestion}
              </button>
            ))}
          </div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700"
          >
            {previewMutation.isPending ? 'Generating preview…' : 'Generate preview'}
          </Button>
        </div>
      </form>

      {previewMutation.isError || executionMutation.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"
        >
          {getErrorMessage(previewMutation.error ?? executionMutation.error)}
        </div>
      ) : null}

      {previewMutation.data ? (
        <SqlPreview
          preview={previewMutation.data}
          isExecuting={executionMutation.isPending}
          onExecute={executePreview}
        />
      ) : null}

      {executionMutation.data ? <AssistantResponse execution={executionMutation.data} /> : null}
    </div>
  )
}
