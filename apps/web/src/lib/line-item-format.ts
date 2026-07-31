// ═════════════════════════════════════════════════════════════════════════════
// Line-item math — web-side (mirrors apps/api/src/products/line-item-math.ts).
// Both files must be byte-identical in formula. Modify together.
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

export function formatDiscount(discount: number): string {
  return `${Math.round(discount)}%`
}
