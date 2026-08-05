/**
 * Stored view preference for the Activities workspace (Story 4.4, AC 35).
 * Pure module — no React — so every branch is unit-testable.
 *
 * 🚨 NEVER read this during render: the server renders without `localStorage`
 * and the mismatch produces a Next hydration error. Callers read it inside a
 * mount `useEffect` and start from the deterministic `'list'`.
 *
 * A view toggle is a device-scoped UI preference, not tenant data — there is
 * no `UserPreference` model (arbitration, AC 35). Ledgered in deferred-work.md:
 * the preference does not follow the user across devices.
 */

export type ActivityView = 'list' | 'calendar' | 'timeline'

export const ACTIVITY_VIEWS: readonly ActivityView[] = ['list', 'calendar', 'timeline']

/** localStorage key — stable and namespaced (AC 35). */
export const ACTIVITY_VIEW_STORAGE_KEY = 'crm.activities.view'

export function isActivityView(value: unknown): value is ActivityView {
  return typeof value === 'string' && (ACTIVITY_VIEWS as readonly string[]).includes(value)
}

/**
 * Returns the stored view, or `null` when absent, garbage, or unavailable —
 * including a `SecurityError` from private-browsing mode, which must never
 * break the page (AC 35).
 */
export function readStoredView(): ActivityView | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACTIVITY_VIEW_STORAGE_KEY)
    if (raw === null) return null
    return isActivityView(raw) ? raw : null
  } catch {
    return null
  }
}

/** Best-effort write — a throwing `localStorage` (private browsing) is swallowed. */
export function writeStoredView(view: ActivityView): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVITY_VIEW_STORAGE_KEY, view)
  } catch {
    // Preference persistence is best-effort; the page must not crash.
  }
}
