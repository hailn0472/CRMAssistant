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
      <div className="flex h-9 items-center gap-2.5 rounded-full border border-slate-200 bg-slate-50/80 px-3 text-slate-500 shadow-none transition-colors focus-within:border-slate-300 focus-within:bg-white">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-slate-400"
        />
        <input
          type="search"
          aria-label="Search or run command"
          aria-haspopup="dialog"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={handleFocus}
          placeholder="Search or run a command"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
        />
        <kbd className="hidden shrink-0 rounded-[5px] border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline-flex">
          K K
        </kbd>
      </div>
    </div>
  )
}
