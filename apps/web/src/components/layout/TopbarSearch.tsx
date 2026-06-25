'use client'

interface TopbarSearchProps {
  value: string
  onChange: (value: string) => void
  onFocus: () => void
}

export function TopbarSearch({ value, onChange, onFocus }: TopbarSearchProps): React.JSX.Element {
  function handleFocus(event: React.FocusEvent<HTMLInputElement>): void {
    if ('dataset' in event.target) {
      const input = event.target as HTMLInputElement
      if (input.dataset.returningFocus !== undefined) {
        delete input.dataset.returningFocus
        return
      }
    }
    onFocus()
  }

  return (
    <div className="w-full">
      <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-slate-500 shadow-none focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100">
        <span aria-hidden="true" className="mr-2 text-slate-400">
          /
        </span>
        <input
          type="search"
          aria-label="Search or run command"
          aria-haspopup="dialog"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={handleFocus}
          placeholder="Search or run command"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
        />
        <kbd className="ml-2 hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 sm:inline-flex">
          Ctrl K
        </kbd>
      </div>
    </div>
  )
}
