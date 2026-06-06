'use client'

import type React from 'react'

import { Badge } from './badge'
import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Input } from './input'
import { Select } from './select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TablePaginationPlaceholder,
  TableRow,
} from './table'
import { Textarea } from './textarea'

function CrmFormFieldExample(): React.ReactElement {
  return (
    <section
      aria-label="Shared UI implementation reference"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <p className="mb-4 text-sm font-medium text-slate-700">Sample/reference data only</p>
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="account-name" className="text-sm font-medium text-slate-700">
            Account name
          </label>
          <Input id="account-name" aria-describedby="account-name-help account-name-error" />
          <p id="account-name-help" className="text-sm text-slate-500">
            Use the legal account name from the CRM workspace.
          </p>
          <p id="account-name-error" className="text-sm text-red-600">
            Account name is required for the sample flow.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="summary" className="text-sm font-medium text-slate-700">
            Summary
          </label>
          <Textarea id="summary" />
        </div>
        <div className="space-y-2">
          <label htmlFor="priority" className="text-sm font-medium text-slate-700">
            Priority
          </label>
          <Select id="priority" defaultValue="normal">
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </Select>
        </div>
      </div>
    </section>
  )
}

function CrmTableExample(): React.ReactElement {
  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Record</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Sample account</TableCell>
            <TableCell>
              <Badge variant="success">Active</Badge>
            </TableCell>
            <TableCell>Human-owned</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Record</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyState colSpan={1} message="No records match this sample view." />
        </TableBody>
      </Table>
      <TablePaginationPlaceholder>Pagination placeholder: 1-1 of 1</TablePaginationPlaceholder>
    </div>
  )
}

function CrmConfirmationDialogExample(): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger>
        <Button variant="outline">Open confirmation sample</Button>
      </DialogTrigger>
      <DialogContent
        role="alertdialog"
        aria-labelledby="archive-sample-title"
        aria-describedby="archive-sample-description"
      >
        <DialogHeader>
          <DialogTitle id="archive-sample-title">Archive sample record?</DialogTitle>
          <DialogDescription id="archive-sample-description">
            This reference flow confirms a reversible CRM action.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline">Keep record</Button>
          </DialogClose>
          <Button variant="destructive">Archive sample</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CrmQuickEditSheetExample(): React.ReactElement {
  return (
    <Sheet>
      <SheetTrigger>
        <Button>Open quick edit sample</Button>
      </SheetTrigger>
      <SheetContent aria-labelledby="quick-edit-title" aria-describedby="quick-edit-description">
        <SheetHeader>
          <SheetTitle id="quick-edit-title">Quick edit sample account</SheetTitle>
          <SheetDescription id="quick-edit-description">
            Sample/reference data only for implementers.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="display-name" className="text-sm font-medium text-slate-700">
              Display name
            </label>
            <Input id="display-name" />
          </div>
          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium text-slate-700">
              Notes
            </label>
            <Textarea id="notes" />
          </div>
          <SheetClose>
            <Button variant="outline">Close quick edit sample</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export {
  CrmConfirmationDialogExample,
  CrmFormFieldExample,
  CrmQuickEditSheetExample,
  CrmTableExample,
}
