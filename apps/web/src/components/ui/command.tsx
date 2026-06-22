'use client'

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'

import { cn } from '@/lib/utils'

const CommandDialog = CommandPrimitive.Dialog

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>): React.ReactElement {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col bg-white text-slate-950', className)}
      {...props}
    />
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>): React.ReactElement {
  return (
    <div
      className="mx-4 mb-3 flex h-14 items-center rounded-full border border-slate-200 bg-white px-4 shadow-sm ring-offset-white focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100"
      cmdk-input-wrapper=""
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mr-3 h-[18px] w-[18px] shrink-0 text-slate-400"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <CommandPrimitive.Input
        className={cn(
          'flex h-full w-full bg-transparent text-base outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>): React.ReactElement {
  return (
    <CommandPrimitive.List
      className={cn(
        'max-h-[min(58vh,32rem)] overflow-y-auto overflow-x-hidden px-3 pb-4',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>): React.ReactElement {
  return <CommandPrimitive.Empty className="py-6 text-center text-sm text-slate-500" {...props} />
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>): React.ReactElement {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden py-2 text-slate-950 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-slate-500',
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>): React.ReactElement {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-3 rounded-xl px-3 py-3 text-sm outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700 data-[disabled=true]:opacity-55',
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return (
    <span className={cn('ml-auto text-xs tracking-widest text-slate-500', className)} {...props} />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
}
