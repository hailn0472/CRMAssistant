'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
}

interface SheetChildProps {
  onClick?: React.MouseEventHandler<HTMLElement>
}

const SheetContext = React.createContext<SheetContextValue | undefined>(undefined)

function useSheetContext(): SheetContextValue {
  const context = React.useContext(SheetContext)
  if (!context) {
    throw new Error('Sheet components must be used within Sheet')
  }
  return context
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function composeClickHandler(
  childOnClick: React.MouseEventHandler<HTMLElement> | undefined,
  nextOpen: boolean,
  setOpen: (open: boolean) => void,
  triggerRef?: React.MutableRefObject<HTMLElement | null>,
): React.MouseEventHandler<HTMLElement> {
  return (event) => {
    childOnClick?.(event)

    if (!event.defaultPrevented) {
      if (triggerRef && nextOpen) {
        triggerRef.current = event.currentTarget
      }

      setOpen(nextOpen)
    }
  }
}

function Sheet({ open: controlledOpen, onOpenChange, children }: SheetProps): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement>(null)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (nextOpen: boolean): void => {
    setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <SheetContext.Provider value={{ open, setOpen, triggerRef }}>{children}</SheetContext.Provider>
  )
}

function SheetTrigger({
  children,
}: {
  children: React.ReactElement<SheetChildProps>
}): React.ReactElement {
  const { setOpen, triggerRef } = useSheetContext()
  return React.cloneElement(children, {
    onClick: composeClickHandler(children.props.onClick, true, setOpen, triggerRef),
  })
}

function SheetContent({
  className,
  children,
  onKeyDown,
  tabIndex = -1,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const { open, setOpen, triggerRef } = useSheetContext()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }

    const content = contentRef.current
    const trigger = triggerRef.current
    const firstFocusable = content ? getFocusableElements(content)[0] : undefined
    ;(firstFocusable ?? content)?.focus()

    return () => {
      trigger?.focus()
    }
  }, [open, triggerRef])

  if (!open || !mounted) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20">
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={tabIndex}
        onKeyDown={(event) => {
          onKeyDown?.(event)

          if (event.defaultPrevented) {
            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
            return
          }

          if (event.key !== 'Tab') {
            return
          }

          const focusableElements = getFocusableElements(event.currentTarget)
          if (focusableElements.length === 0) {
            event.preventDefault()
            return
          }

          const firstElement = focusableElements[0]
          const lastElement = focusableElements[focusableElements.length - 1]

          if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault()
            lastElement.focus()
          } else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault()
            firstElement.focus()
          }
        }}
        className={cn(
          'h-full w-full max-w-md border-l border-slate-200 bg-white p-6 shadow-sm',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
}

function SheetTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <h2 className={cn('text-lg font-semibold text-slate-950', className)} {...props} />
}

function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return <p className={cn('text-sm text-slate-500', className)} {...props} />
}

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />
}

function SheetClose({
  children,
}: {
  children: React.ReactElement<SheetChildProps>
}): React.ReactElement {
  const { setOpen } = useSheetContext()
  return React.cloneElement(children, {
    onClick: composeClickHandler(children.props.onClick, false, setOpen),
  })
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
