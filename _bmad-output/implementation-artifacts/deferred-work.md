## Deferred from: 6-1-role-based-dashboard-with-customizable-widgets

- No JSON GraphQL scalar — `Widget.config` is exposed as a typed `WidgetConfig` Pothos object with a closed set of optional fields, parsed and re-validated on every read. Related deferred-work entries at `:128` and `:149` remain open; a future JSON scalar is the correct universal fix.
- `resolveWidgetSpan` duplicated across `apps/api/src/dashboards/widget-types.ts` and `apps/web/src/lib/widget-format.ts` because `packages/*` is empty (`docs/project-context.md:48-50`). Both files carry cross-reference comments. Consolidation into shared types needs a package-scope decision.
- Widget data computed on read with no server-side cache, no materialized view, no snapshot table. The 4.5 precedent ("computed on read with no cache", `deferred-work.md:160`) is followed here.
- 30s `refetchInterval` polling instead of the `< 1s` NFR2 GraphQL subscription. No new `EventEmitter`, no new pub/sub. Polling pauses during edit mode to prevent mid-drag re-renders.
- All bucketing UTC — no per-user timezone. Inherited from 4.3/4.4/4.5.
- No widget data export or chart PNG/SVG export (Stories 6.4/6.6).
- No per-breakpoint saved layout. `Widget.position` and `Widget.size` are the single source of truth; a future story that needs per-breakpoint layouts adds the column then.
- Dashboard sharing is `READ` only. `shareDashboard` rejects `EDIT` and `FULL` with `BadRequestException`. Collaborative editing of someone else's layout needs conflict resolution nothing in this repo has.
- `sharing.graphql.ts:129`'s hardcoded `requirePermission(context, 'CONTACT', 'UPDATE')` on `unshareRecord` left unfixed — dashboard sharing uses dashboard-owned mutations (`shareDashboard`/`unshareDashboard`) instead of the generic `shareRecord`, avoiding the gate.
- No `Dashboard.layout` column — `Widget.position` + `Widget.size` are the layout, and they are the single source of truth. A dead `layout` column is a lie the next story would trust.
