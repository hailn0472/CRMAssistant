import { Badge } from '@/components/ui/badge'
import {
  HEALTH_SIGNAL_LABELS,
  HEALTH_STATUS_LABELS,
  healthBadgeVariant,
} from '@/lib/deal-health-format'
import type { DealHealth } from '@/services/deal-health.service'

/**
 * Health badge for a deal. The text label is always present — never colour
 * alone (ux-design-specification.md:1997, :2223) — and the signal reasons are
 * exposed as a title attribute. Renders nothing for a closed deal (health
 * null).
 */
export function DealHealthBadge({
  health,
}: {
  health: DealHealth | null
}): React.JSX.Element | null {
  if (!health) return null

  const reasons = health.signals.map((signal) => HEALTH_SIGNAL_LABELS[signal] ?? signal).join('; ')

  return (
    <Badge
      variant={healthBadgeVariant(health.status)}
      className="gap-1.5"
      title={reasons || undefined}
    >
      {HEALTH_STATUS_LABELS[health.status] ?? health.status}
    </Badge>
  )
}
