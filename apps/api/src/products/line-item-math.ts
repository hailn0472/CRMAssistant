import { BadRequestException } from '@nestjs/common'

// ═════════════════════════════════════════════════════════════════════════════
// Line-item math — API-side (authoritative).
// The web-side copy at apps/web/src/lib/line-item-format.ts must be
// byte-identical in formula. Modify both together.
// ═════════════════════════════════════════════════════════════════════════════

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeLineItemTotal(input: {
  quantity: number
  unitPrice: number
  discount: number
}): number {
  return roundMoney(input.quantity * input.unitPrice * (1 - input.discount / 100))
}

export function sumLineItemTotals(items: Array<{ total: number }>): number {
  const raw = items.reduce((sum, item) => sum + item.total, 0)
  return roundMoney(raw)
}

export interface LineItemNumbers {
  quantity: number
  unitPrice: number
  discount: number
}

const QUANTITY_MAX = 1_000_000

export function assertLineItemNumbers(input: LineItemNumbers): void {
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity)) {
    throw new BadRequestException('Quantity must be greater than 0')
  }
  if (input.quantity <= 0 || input.quantity > QUANTITY_MAX) {
    throw new BadRequestException('Quantity must be greater than 0')
  }

  if (typeof input.unitPrice !== 'number' || !Number.isFinite(input.unitPrice)) {
    throw new BadRequestException('Unit price must be 0 or greater')
  }
  if (input.unitPrice < 0) {
    throw new BadRequestException('Unit price must be 0 or greater')
  }

  if (typeof input.discount !== 'number' || !Number.isFinite(input.discount)) {
    throw new BadRequestException('Discount must be between 0 and 100')
  }
  if (input.discount < 0 || input.discount > 100) {
    throw new BadRequestException('Discount must be between 0 and 100')
  }
}
