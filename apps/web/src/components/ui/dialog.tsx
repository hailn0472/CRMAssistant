'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
}

interface DialogChildProps {
  onClick?: React.MouseEventHandler<HTMLElement>
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined)

function useDialogContext(): DialogContextValue {
  const context = React.useContext(DialogContext)
  if (!context) {
    throw new Error('Dialog components must be used within Dialog')
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

function Dialog({ open: controlledOpen, onOpenChange, children }: DialogProps): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement>(null)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (nextOpen: boolean): void => {
    setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <DialogContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({
  children,
}: {
  children: React.ReactElement<DialogChildProps>
}): React.ReactElement {
  const { setOpen, triggerRef } = useDialogContext()
  return React.cloneElement(children, {
    onClick: composeClickHandler(children.props.onClick, true, setOpen, triggerRef),
  })
}

function DialogContent({
  className,
  children,
  role = 'dialog',
  onKeyDown,
  tabIndex = -1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  role?: 'dialog' | 'alertdialog'
}): React.ReactElement | null {
  const { open, setOpen, triggerRef } = useDialogContext()
  const contentRef = React.useRef<HTMLDivElement>(null)

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

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-4">
      <div
        ref={contentRef}
        role={role}
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
          'w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
}

function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <h2 className={cn('text-lg font-semibold text-slate-950', className)} {...props} />
}

function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return <p className={cn('text-sm text-slate-500', className)} {...props} />
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogClose({
  children,
}: {
  children: React.ReactElement<DialogChildProps>
}): React.ReactElement {
  const { setOpen } = useDialogContext()
  return React.cloneElement(children, {
    onClick: composeClickHandler(children.props.onClick, false, setOpen),
  })
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
