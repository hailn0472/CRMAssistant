---
Status: review
Story Key: 6-8-activity-reports-team-productivity-metrics
Story ID: "6.8"
Epic: "6 — Reporting & Analytics Dashboard"
FR: "Không có FR riêng trong PRD (FR63 'Activity Reports' chỉ xuất hiện trong Journey 2 nhưng chưa được thêm vào danh sách FR); Story 6.8 là epic-level addition. FR liên quan: FR19 (activity views), FR20 (time tracking & productivity reports)"
Depends On:
  - "Epic 4 / Activity Management — Activity append-only + Task CRUD + TimeEntry (shipped)"
  - "Story 4.1 — Task CRUD, status/completedAt/dueDate semantics (done)"
  - "Story 4.2 — automatic activity logging, ActivityType vocabulary (done)"
  - "Story 4.4 — Activity feed visibility predicate buildFeedWhere (done)"
  - "Story 4.5 — TimeEntry model + TimeEntriesService.buildTimeEntryWhere + ProductivityService (done)"
  - "Story 4.8 — NotificationsModule notifySafe + NOTIFICATION_TYPES const tuple (done)"
  - "Story 6.2 — REPORT permission, ReportsModule, reports nav (done)"
  - "Story 6.4 — ReportChart/Recharts chart framework (done)"
  - "Story 6.6 — ExcelJS/PDFKit export libs + Supabase Storage signed-URL pattern (done)"
  - "Story 6.7 — module registration / barrel / Pothos conventions (done)"
Baseline Commit: "a9714f627d9b5739ddac43a6a335e90706c591c7"
Created: "2026-08-22"
Document Language: Vietnamese
---

# Story 6.8: Activity Reports & Team Productivity Metrics

## Bối cảnh và quyết định phạm vi — ĐỌC TRƯỚC KHI IMPLEMENT

Story này thêm read-model báo cáo hoạt động team vào module `reports` hiện có: query `activityReport(filters)` trả activity metrics + productivity metrics, dashboard tenant-safe/visibility-safe tại `/reports/activity` (heatmap theo day-of-week × hour, line trend, leaderboard, team comparison, user drill-down), activity goals do manager thiết lập kèm progress tracking và alert khi tụt tiến độ, và export PDF/Excel bằng cách **mở rộng đúng machinery `ReportExport` đã ship ở Story 6.6**.

Không được xây Activity/Task/TimeEntry song song, không được tính metrics riêng ở frontend, không được bỏ qua `tenantId`, không được dùng Redis/in-memory queue, không được thêm dependency/chart library mới, và đặc biệt **không được tạo export service/storage/history/notification/download flow song song**. Story phải refactor nhỏ, backward-compatible để `ReportExport` hỗ trợ nguồn `ACTIVITY_REPORT`, rồi reuse processor, renderer, private Storage, signed URL, owner-only history và notification của Story 6.6.

| Câu hỏi | Hiện trạng repository | Quyết định binding cho Story 6.8 |
| --- | --- | --- |
| Activity metrics đếm trên nguồn nào? | `Activity` là append-only log: bắt buộc `tenantId` + `contactId`, có `type`, `title`, `createdBy` (String — KHÔNG có FK tới User), `source/sourceId/dedupeKey/metadata`, index `[tenantId, contactId, createdAt DESC]` và `[tenantId, createdAt DESC]`. Không có cột teamId/dealId/status. | Mọi activity metric (total, by type, by user, by date, meetings scheduled, heatmap, trend, goal progress) đếm `Activity` tenant-scoped trong range, active rows (không soft-delete). "User" của activity là `createdBy` — join qua `User.id` để lấy tên/team cho leaderboard/filters; không thêm cột FK mới vào Activity. |
| "Completion rate" tính thế nào khi Activity không có trạng thái hoàn thành? | `Task` có `completedAt DateTime?`, `dueDate DateTime?` và `status` enum `TODO/IN_PROGRESS/COMPLETED/CANCELLED`. | Đây là **task due-cohort completion rate**: tử số = active, non-cancelled tasks có `dueDate` trong range và `status=COMPLETED`; mẫu số = mọi active, non-cancelled task có `dueDate` trong range. Trả thêm numerator/denominator và `calculationNote`; 0 khi mẫu số = 0. Metric độc lập `tasksCompleted` vẫn dùng `completedAt` trong range. Cách này không thể vượt 100% và không suy diễn từ `ActivityType.TASK_COMPLETED`. |
| "Average completion time" tính từ đâu? | `Task.createdAt` + `Task.completedAt` có sẵn. | `avgCompletionTimeHours = avg(completedAt - createdAt)` của active tasks hoàn thành trong range (giờ, round 1, 0 khi không có). |
| "Overdue tasks" định nghĩa thế nào? | `Task.dueDate DateTime?`, `status`, `completedAt DateTime?`, `deletedAt DateTime?`. | `overdueTasks` = active tasks có `status IN (TODO, IN_PROGRESS)`, `dueDate >= startInclusive` và `dueDate < min(endExclusive, now)`. `now` đến từ injectable clock để test deterministic; không tính `CANCELLED`, `COMPLETED` hoặc task không có dueDate. |
| "Time tracked" lấy từ đâu? | `TimeEntry` có `durationSeconds` là single source of truth (Story 4.5 AC 22); running entries có `endTime = null`; `TimeEntriesService.buildTimeEntryWhere(tenantId, callerUserId, {userId, startFrom, startTo})` là predicate chuẩn. | `timeTrackedSeconds` = SUM(`durationSeconds`) của entries không-running (`endTime != null`) trong range/scope — layered filter đúng mẫu `ProductivityService` (AC 21): không đếm timer đang chạy, không recompute từ startTime/endTime. |
| "Meetings scheduled" đếm gì? | `ActivityType` có `MEETING_SCHEDULED`. | Count `Activity.type = MEETING_SCHEDULED` trong range/scope. |
| "Deals closed" trong leaderboard đếm thế nào? | `Deal.ownerId` (FK User), terminal outcome authority là active `DealStage.isWon/isLost`; `Deal.actualCloseDate` là field thời điểm đóng đã được Win/Loss reports dùng. | `dealsClosed` = count active deals có active stage `isWon=true`, `ownerId=user`, `actualCloseDate` trong range. Won deal có `actualCloseDate=null` không được gán giả vào period và phải được nêu trong `calculationNote`; tuyệt đối không dùng `createdAt` làm ngày đóng. |
| Team filter và leaderboard tôn trọng visibility thế nào? | `User.teamId` (FK Team). `resolveVisibilityFilter(callerUserId, tenantId)` trả OWN (string) hoặc TEAM/ALL (array) hoặc undefined (ADMIN). `ProductivityService` AC 17 đã có pattern: userId khác caller phải nằm trong visibility scope. | Mọi user xuất hiện trong report (leaderboard rows, drill-down, filter userId/team) phải nằm trong visibility scope của caller theo đúng pattern `ProductivityService` — ADMIN bypass qua guard hiện có, integration tests dùng non-ADMIN. Team filter: lọc user theo `User.teamId`, sau đó mọi data source (Activity.createdBy, Task.assignedTo, Deal.ownerId, TimeEntry.userId) derive membership qua User. Không copy visibility logic. |
| Filter contact/deal trên Activity thế nào khi Activity chỉ có contactId? | `Activity.contactId` bắt buộc nhưng activity có provenance `source/sourceId`; Task có `dealId`. Lọc mọi activity của `Deal.contactId` sẽ gán sai các email/call không liên quan cho deal. | `contactId` lọc trực tiếp. `dealId` phải được authorize qua `DealsService.findOne`; Activity scope chỉ gồm `(source='DEAL' AND sourceId=dealId)` hoặc `(source='TASK' AND sourceId IN <bounded active task IDs of that deal>)`. Message/note/contact activity không có deal provenance bị loại. Task/TimeEntry/Deal metrics dùng `Task.dealId`/relation tương ứng. Không dùng `Deal.contactId` để kéo toàn bộ contact timeline. |
| Activity goals cần model mới không? | Chưa có `ActivityGoal`/goal model nào trong schema. Notification: `NOTIFICATION_TYPES` là const tuple trong pure module (`notification-types.ts`) — thêm member không cần migration; `Notification` không có cột goalId. | Thêm model tenant-scoped `ActivityGoal` (xem Contract A). Thêm member `ACTIVITY_GOAL_AT_RISK` vào `NOTIFICATION_TYPES` (pure tuple, không migration); alert gửi qua `NotificationsService.notifySafe` với `dedupeKey` deterministic, target `NONE` (không thêm FK cột mới vào Notification). |
| Alert "falling behind" chạy khi nào và thế nào? | `@nestjs/schedule` đã ship và đăng ký một lần ở root (Story 6.5/6.7 processor precedent); `notifySafe` + dedupeKey đã có. | Thêm `ActivityGoalProcessor` cron 6-field `0 0 7 * * *` (07:00 UTC mỗi ngày) chạy per-tenant theo batch, đánh giá active goals: `actualCount < expectedPace = targetCount × elapsedFraction` → tối đa một notification/goal/**period** qua `notifySafe` với `dedupeKey='activity-goal-at-risk:<goalId>:<periodStart>'`. Cron kiểm tra hằng ngày nhưng không spam hằng ngày; idempotent khi rerun/concurrent. |
| Export PDF/Excel theo đường nào? | Story 6.6 đã có durable `ReportExport`, processor/lease/retry, `ReportDocumentPayload`, PDFKit/ExcelJS renderer, private Storage, 50 MB/row bounds, signed URL TTL 24h, owner-only history/download và ready/failed notification. Trở ngại duy nhất là `reportId` đang bắt buộc và payload dispatcher chỉ biết saved sales/custom report. | Mở rộng machinery, không fork: thêm source discriminator `SAVED_REPORT | ACTIVITY_REPORT`, làm `ReportExport.reportId` nullable có DB CHECK theo source, lưu immutable validated activity filters trong `ReportExport.filters`, và thêm activity payload adapter vào **cùng** `ReportExportPayloadService`/`ReportExportProcessor`. Mutation `exportActivityReport(filters, format)` tạo durable row và đi qua cùng renderer/storage/history/download/notification. Chỉ cho `PDF`/`EXCEL`; reject `CSV` rõ ràng. Existing `exportReport` behavior phải giữ nguyên. |
| Có cần thư viện mới/upgrade không? | Shipped: Prisma `^5.10.0`, `exceljs`, `pdfkit`, Recharts `^3.10.1`, TanStack Query `^5.100.9`, Next `14.2.35`, `@nestjs/schedule ^6.1.3`. | Không thêm dependency, không nâng Prisma (latest major 7.x ngoài phạm vi). Reuse toàn bộ stack shipped. |

### Ngoài phạm vi rõ ràng

- Không thêm `ACTIVITY` vào `REPORT_TYPES`/`PLATFORM_REPORT_TYPES` và không tạo saved `Report` giả/ẩn chỉ để lấy `reportId`.
- Không tạo `ActivityReportExport`, export table, processor, Storage bucket, history page, signed-URL flow hoặc notification channel thứ hai. Chỉ mở rộng backward-compatible `ReportExport` của Story 6.6.
- Không dùng AI/ML, external scoring, Redis, BullMQ, Kafka, in-memory queue.
- Không thêm chart library mới; reuse `ReportChart`.
- Không sửa Activity/Task/TimeEntry/Deal models (chỉ thêm model mới `ActivityGoal`).
- Không gửi email alert riêng — chỉ dùng notification in-app hiện có.
- Không sửa `/reports/productivity` (time-tracking của Story 4.5) — route bắt buộc mới là `/reports/activity`.
- Không schedule activity report qua Story 6.5 pipeline; không đưa activity report vào unified saved Report system.
- Không tính metric ở client; server-owned.

---

## Story

Là một **sales manager**,
Tôi muốn **xem activity reports và team productivity metrics**,
Để **giám sát hiệu suất team và xác định cơ hội coaching**.

---

## Acceptance Criteria

### Acceptance Criteria binding — giữ nguyên từ `epics.md` Story 6.8

18 statement dưới đây là tập acceptance binding đầy đủ. Implementation Contract chỉ làm rõ cách build/test trên codebase hiện tại; không thay thế hoặc nới lỏng bất kỳ statement nào.

1. **Given** Activity Management is implemented from Epic 4
2. **When** I implement activity reports and productivity metrics
3. **And** GraphQL query `activityReport(filters)` returns activity metrics
4. **And** Activity metrics include: total activities, activities by type, activities by user, activities by date, completion rate
5. **And** Productivity metrics include: tasks completed, average completion time, overdue tasks, time tracked, meetings scheduled
6. **And** Frontend `/reports/activity` page displays activity reports
7. **And** Activity report shows: activity heatmap (calendar view), activity trend chart (line chart), top performers leaderboard
8. **And** Heatmap shows activity intensity by day of week and hour of day
9. **And** Leaderboard ranks users by: activities logged, tasks completed, deals closed, time tracked
10. **And** Report filters: date range, user, team, activity type, contact/deal
11. **And** Team comparison: side-by-side comparison of team metrics
12. **And** Individual user drill-down: click on user to see detailed activity breakdown
13. **And** Activity goals: managers can set activity targets (e.g., 50 calls per week) and track progress
14. **And** Goal progress is visualized with progress bars and percentage completion
15. **And** Alerts: users receive notification when falling behind on activity goals
16. **And** Activity report can be exported to PDF/Excel
17. **And** Unit tests cover activity metrics calculation
18. **And** Integration tests verify report data accuracy

---

## Binding Implementation Contract

### A. Prisma schema, migration và ActivityGoal model (AC 13–15)

1. Thêm enum `ActivityGoalPeriod` với đúng hai giá trị: `WEEKLY`, `MONTHLY`.
2. Thêm model tenant-scoped `ActivityGoal` (mới hoàn toàn — không sửa model cũ nào):

   ```text
   id          String             @id @default(uuid())
   tenantId    String
   name        String             // ví dụ "50 calls per week"
   activityType ActivityType?     // null = tất cả loại activity (TOTAL)
   targetCount Int                // > 0, validate ở service
   period      ActivityGoalPeriod
   userId      String             // chủ thể goal (user được track)
   startsOn    DateTime           // UTC midnight, anchor period đầu tiên
   isActive    Boolean            @default(true)
   createdAt   DateTime           @default(now())
   updatedAt   DateTime           @updatedAt
   createdBy   String             @default("system")
   updatedBy   String             @default("system")
   deletedAt   DateTime?
   ```

   Relations: `Tenant` (onDelete: Cascade) + `User` (onDelete: Cascade) — cần inverse relations vào `Tenant` và `User`. Indexes tối thiểu: `[tenantId]`, `[tenantId, userId]`, `[tenantId, isActive]`, `[tenantId, activityType]`, `[tenantId, userId, isActive]`. Service kiểm tra duplicate để trả lỗi thân thiện, **và migration phải có partial unique index** trên `(tenantId, userId, period, COALESCE(activityType::text, '__TOTAL__')) WHERE deletedAt IS NULL AND isActive = TRUE` để hai request concurrent không tạo hai active goals cùng loại/kỳ. Catch unique violation thành `ConflictException`; không dựa vào check-then-create đơn thuần.
3. Viết đúng một hand-written timestamped migration theo house SQL style. Bảng mới + enum + FK/indexes đúng thứ tự; không rebuild/làm mất dữ liệu hiện có. Thêm model vào Tenant/User back-relations và mọi integration cleanup/TRUNCATE list liên quan; chạy `prisma generate`/`prisma validate` và kiểm tra migration SQL.
4. Không backfill gì bằng SQL — goals là data mới, chỉ tạo qua API.
5. `ActivityGoal` không được expose raw JSON; toàn bộ write qua service validation (name non-empty ≤ 200 chars, targetCount int 1..10_000, period hợp lệ, userId active trong tenant, activityType hợp lệ nếu có, startsOn UTC midnight).

6. Mở rộng **existing** Story 6.6 export schema trong cùng migration, không tạo model export mới:
   - thêm enum `ReportExportSourceType = SAVED_REPORT | ACTIVITY_REPORT`;
   - thêm `ReportExport.sourceType ReportExportSourceType @default(SAVED_REPORT)`;
   - đổi `ReportExport.reportId` thành `String?` và relation `report` thành optional, vẫn giữ existing cascade semantics cho saved report rows;
   - dùng existing `ReportExport.filters Json?` làm immutable, server-normalized snapshot: `ReportConfig` với `SAVED_REPORT`, `ActivityReportFilterInput` với `ACTIVITY_REPORT`;
   - thêm SQL CHECK: `(sourceType='SAVED_REPORT' AND reportId IS NOT NULL) OR (sourceType='ACTIVITY_REPORT' AND reportId IS NULL)`; mọi row cũ được default/backfill `SAVED_REPORT`, không mất history.
7. Cập nhật comment/type/select/view của `ReportExport`: expose `sourceType`; `report` đã nullable và activity row phải hiển thị fallback label `Activity report`. Không expose `filters`, `objectPath` hoặc signed URL trong row GraphQL. Các index/owner/history/lease fields hiện có giữ nguyên.
8. Migration là additive/backward-compatible: existing 6.6 rows vẫn chạy qua `exportReport`, worker, history, download, delete và notifications byte-for-byte; thêm integration regression cho saved sales/custom exports sau schema change.

### B. Định nghĩa metric deterministic (AC 4–5, 9, 17)

6. Tạo pure module `activity-report-metrics.ts` (không import Nest/Prisma) chứa closed const và hàm thuần:
   - `ACTIVITY_REPORT_MAX_RANGE_DAYS = 366` (đúng rule `ProductivityService.MAX_RANGE_DAYS`).
   - `ACTIVITY_REPORT_MAX_ROWS = 20000` — bounded by construction; vượt ngưỡng throw (không silent truncation, đúng tiền lệ `MAX_REPORT_ENTRIES`).
   - `LEADERBOARD_METRICS = ['ACTIVITIES_LOGGED','TASKS_COMPLETED','DEALS_CLOSED','TIME_TRACKED']` và `sortBy` vocabulary đóng `['ACTIVITIES','TASKS_COMPLETED','DEALS_CLOSED','TIME_TRACKED']`.
   - `completionRate(completedDue, totalDue)`: `totalDue === 0 → 0`, else round2(completedDue/totalDue), clamp 0..1; reject numerator > denominator thay vì che lỗi dữ liệu.
   - `avgCompletionHours(millisList)`: round1(avg), 0 khi rỗng; reject non-finite.
   - `heatmapKey(date)`: `(utcDayOfWeek 0..6, utcHour 0..23)`; `enumerateHeatmapCells()` trả đủ 168 cell zero-filled.
   - `goalPeriodWindow(startsOn, period, now)`: UTC midnight của period hiện tại (WEEKLY: 7 ngày bắt đầu từ startsOn-anchored week; MONTHLY: calendar UTC month chứa now).
   - `expectedPace(targetCount, elapsedFraction)`: clamp 0..targetCount; `isFallingBehind(actual, expected)`: `actual < expected`.
7. Định nghĩa metric (server-only, single source of truth):
   - `totalActivities` = count active Activity trong range/scope.
   - `activitiesByType[]` = count group by `type`.
   - `activitiesByUser[]` = count group by `createdBy` (join User lấy firstName/lastName/teamId cho display; createdBy không thuộc visibility scope thì row KHÔNG xuất hiện).
   - `activitiesByDate[]` = count group by UTC day (`YYYY-MM-DD`), zero-filled theo range.
   - `completionRate`, `completionRateNumerator`, `completionRateDenominator`: cohort active/non-cancelled tasks có `dueDate` trong range; numerator là status `COMPLETED` trong chính cohort đó.
   - `tasksCompleted` = count active Task `completedAt` trong range.
   - `avgCompletionTimeHours` theo B6.
   - `overdueTasks` = count active Task `status IN (TODO, IN_PROGRESS)`, `dueDate >= startInclusive`, `dueDate < min(endExclusive, clock.now())`.
   - `timeTrackedSeconds` = SUM `durationSeconds` entries `endTime != null` trong range/scope.
   - `meetingsScheduled` = count Activity `type = MEETING_SCHEDULED`.
   - `dealsClosed(userId)` = count active Deal `ownerId=userId`, active stage `isWon=true`, `actualCloseDate` trong range; won rows thiếu `actualCloseDate` không được period-attributed.
8. Mọi query aggregate chứa `tenantId` + parent scope; mọi date filter dùng UTC boundaries (`toUtcMidnight` pattern từ `tasks/task-due-status`); clamp future/bad clock thành 0, không âm.

### C. Typed GraphQL API và permission (AC 3, 10, 13)

9. Tạo `activity-reports.service.ts` + `activity-reports.graphql.ts`; register `registerActivityReportsGraphql(service, goalsService)` từ `ReportsModule.onModuleInit()` và thêm side-effect import `../reports/activity-reports.graphql` vào `apps/api/src/graphql/schema.ts` barrel (thiếu barrel = query biến mất im lặng — đúng cảnh báo trong schema.ts header). `ReportsModule` phải nằm trước `AppGraphqlModule`. Export existing `ActivityTypeEnum` từ `activities.graphql.ts` để input mới reuse đúng **một** Pothos enum; không đăng ký enum `ActivityType` lần hai.
10. Expose đúng query binding:

    ```graphql
    activityReport(
      filters: ActivityReportFilterInput!
    ): ActivityReport!
    ```

    Input typed/closed (không raw JSON/Prisma where/sort):
    - `startDate`, `endDate` (required, valid ISO, endDate >= startDate, range ≤ 366 ngày)
    - `userId`, `teamId` (optional primary scope; nếu cùng có thì user phải thuộc team)
    - `comparisonTeamIds: [ID!]` (optional, unique, tối đa 4, từng team phải tenant-local và nằm trong visibility scope) để trả side-by-side team comparison; không tự trả mọi team trong tenant
    - `activityTypes: [ActivityType!]` (reuse enum `ActivityType` từ activities.graphql — không khai báo enum thứ hai)
    - `contactId`, `dealId` (optional)
    - `bucket` (`DAY|WEEK|MONTH`, default DAY) cho trend
    - `sortBy` (`ACTIVITIES|TASKS_COMPLETED|DEALS_CLOSED|TIME_TRACKED`, default ACTIVITIES) cho leaderboard
11. Query yêu cầu JWT + `REPORT:READ` + `CONTACT:READ` + `TASK:READ` + `DEAL:READ`. ADMIN bypass giữ nguyên guard hiện có, nhưng integration tests phải dùng non-ADMIN để chứng minh gates thật sự.
12. User scope: userId/teamId/label của leaderboard/teamComparison/drill-down chỉ chứa user trong visibility scope của caller (pattern `resolveVisibilityFilter` từ `ProductivityService` AC 17). OWN → chỉ self; TEAM/ALL → theo array; ADMIN → không giới hạn. Không copy visibility logic.
13. Data scope: activities qua `ActivityService.buildFeedWhere(tenantId, callerUserId, {...})` (predicate chuẩn Story 4.4/6.3), tasks qua `TasksService.buildTaskWhere`, time entries qua `TimeEntriesService.buildTimeEntryWhere`, deals qua `DealsService.buildDealWhere`. Layer thêm range/type/contact/deal conditions lên predicate chuẩn — không hand-roll predicate thứ hai.
14. `dealId` filter: authorize deal bằng `DealsService.findOne`; fetch một lần bounded active task IDs của deal. Activity predicate là OR của direct deal provenance (`source='DEAL'`, `sourceId=dealId`) và task provenance (`source='TASK'`, `sourceId IN taskIds`). Không broaden sang mọi activity của `Deal.contactId`, không raw query và không N+1. `contactId` và `dealId` cùng có thì deal bắt buộc thuộc contact, nếu không trả `BadRequestException`.
15. Result type typed tối thiểu:
    - `summary`: `totalActivities`, `unattributedActivities`, `completionRate`, `completionRateNumerator`, `completionRateDenominator`, `tasksCompleted`, `avgCompletionTimeHours`, `overdueTasks`, `timeTrackedSeconds`, `meetingsScheduled`, `startDate`, `endDate`, `calculationNote`;
    - `activitiesByType[]`, `activitiesByUser[]`, `activitiesByDate[]`;
    - `heatmap[]` (168 cells: `dayOfWeek`, `hour`, `count`);
    - `trend[]` (buckets zero-filled theo `bucket`);
    - `leaderboard[]` (user id/name/team, 4 metric values, rank theo sortBy, tie-break id asc);
    - `teamComparison[]` chỉ cho `comparisonTeamIds` (per team: totalActivities, tasksCompleted, avgCompletionTimeHours, overdueTasks, timeTrackedSeconds, meetingsScheduled, completionRate);
    - query drill-down riêng, lazy theo click, không nhồi raw rows của mọi user vào overview:

      ```graphql
      activityUserDrillDown(
        userId: ID!
        filters: ActivityReportFilterInput!
        pagination: ActivityReportPaginationInput
      ): ActivityUserDrillDown!
      ```

      Result gồm `user`, cùng per-user summary/byType/byDate/dealsClosed và `recentActivities { items total page pageSize }` page mặc định 1/20, max 100, stable sort `createdAt DESC, id DESC`. Backend bỏ `userId/comparisonTeamIds` client-supplied trong filters và khóa subject bằng argument `userId` sau visibility authorization.
16. Pothos refs typed từ service return shapes; service `select` phải chứa mọi field ref expose (ref/select lockstep — crash at query time nếu lệch, tiền lệ Story 3.4/6.7). Schema test assert cả `activityReport`, `activityUserDrillDown`, enums, closed inputs và fields thật sự tồn tại sau `builder.toSchema()`.

### D. Activity goals: CRUD, progress, alert processor (AC 13–15)

17. Tạo `activity-goals.service.ts` + đăng ký trong cùng `activity-reports.graphql.ts` (hoặc file graphql riêng — nhất quán barrel/module). Contract GraphQL chính xác:

    ```graphql
    activityGoals(
      filter: ActivityGoalFilterInput
      pagination: ActivityReportPaginationInput
    ): ActivityGoalConnection!
    createActivityGoal(input: CreateActivityGoalInput!): ActivityGoal!
    updateActivityGoal(id: ID!, input: UpdateActivityGoalInput!): ActivityGoal!
    deleteActivityGoal(id: ID!): Boolean!
    ```

    `ActivityGoalFilterInput = { userId, activityType, period, activeOnly }`; connection dùng house shape `{ items total page pageSize }` với pagination input riêng nếu danh sách vượt 20. `CreateActivityGoalInput = { name, activityType, targetCount, period, userId, startsOn }`; update chỉ cho `name/activityType/targetCount/period/startsOn/isActive`, không đổi `userId` âm thầm.
    - Permission: mutations yêu cầu `REPORT:CREATE` / `REPORT:UPDATE` / `REPORT:DELETE`; `userId` của goal phải nằm trong visibility scope của caller (manager không thể đặt goal cho user ngoài tầm nhìn). Query goals: `REPORT:READ`.
    - Validation: name, targetCount 1..10_000, period hợp lệ, activityType hợp lệ (nullable), startsOn UTC midnight, isActive boolean; một user không có 2 goals active cùng (activityType, period) — throw BadRequest khi vi phạm.
18. Progress tính server-side deterministic: `qualifyingCount = count(Activity where tenantId, createdBy = goal.userId, type = goal.activityType ?? all, createdAt in goalPeriodWindow(startsOn, period, now))`; `progress = clamp(qualifyingCount / targetCount, 0, 1)`; `progressPercent = round1(progress × 100)`. Kết quả trả trong `activityGoals.items` (server tính — client không tính).
19. Thêm member `ACTIVITY_GOAL_AT_RISK` vào `NOTIFICATION_TYPES` trong `apps/api/src/notifications/notification-types.ts` (pure const tuple — không migration; Pothos enum `NotificationType` mirror tự động qua `values: NOTIFICATION_TYPES`). KHÔNG thêm cột/FK mới vào `Notification`; `resolveNotificationTarget` giữ nguyên — alert dùng target `NONE`, goalId chỉ nằm trong title/body text.
20. Tạo `ActivityGoalProcessor` provider trong `ReportsModule`, dùng shipped `@nestjs/schedule`, cron 6-field `0 0 7 * * *` (07:00 UTC mỗi ngày). Clock injectable/override trong unit tests (pattern `SYSTEM_CLOCK`/`Clock` từ `report-schedule-types.ts`).
21. Processor per-tenant theo batch (default 500, bounded concurrency — pattern `CustomerAnalyticsProcessor`): load active goals (tenantId, isActive=true, deletedAt=null, startsOn<=now), tính qualifyingCount bằng grouped/batched aggregate tenant-scoped (không N+1, không load toàn bộ Activity), so `isFallingBehind(actual, expectedPace)`; nếu đúng → `notifySafe` một notification/goal/period: type `ACTIVITY_GOAL_AT_RISK`, recipient = goal.userId, title ví dụ `Activity goal behind: <goal.name>`, body nêu actual/target và % (không PII ngoài cần thiết), `dedupeKey='activity-goal-at-risk:<goalId>:<periodStart YYYY-MM-DD>'` (P2002 → idempotent success). Không swallow failure thành success; failure batch log bằng Nest Logger với tenant/goal identifiers, không PII, tiếp tục batch khác; trả summary cho test/ops.
22. Một notification/goal/period tối đa kể cả rerun/concurrent; goal chưa bắt đầu, inactive hoặc soft-deleted thì bỏ qua. Không gửi alert khi `elapsedFraction = 0` hoặc actual đã đạt expected. Extend pure frontend `notificationHref`/label/icon mapping: `ACTIVITY_GOAL_AT_RISK` điều hướng trusted internal route `/reports/activity`; không cần thêm goalId/FK vào `Notification`.

### E. Frontend activity reports dashboard (AC 6–9, 11–14, 16)

23. Tạo thin route `apps/web/src/app/(dashboard)/reports/activity/page.tsx` chỉ render `ActivityReportsPage` (bọc `QueryProvider` như `/reports/productivity`). Logic ở `components/reports/ActivityReportsPage.tsx`; service ở `services/activity-report.service.ts`; pure transformations/formatting (heatmap matrix, duration format, rank labels) ở `lib/activity-report.ts` khi cần.
24. Frontend service dùng `graphqlRequest` (`@/lib/graphql-client`) với hand-written exact fragments/types và query keys rooted at `['activityReport']`; overview, drill-down và goals có child keys riêng chứa mọi filter/page/subject. Không Apollo/codegen, không tính metric ở client.
25. Thêm nav item `Activity` dưới Reports trong `AppShellNavigation.tsx`, permission `REPORT:READ`; thêm breadcrumb segment `activity: Activity` trong `Breadcrumbs.tsx`. `ActivityReportsPage` dùng `useMyPermissions` để phân biệt loading/denied, chỉ enable overview khi đủ REPORT/CONTACT/TASK/DEAL read, chỉ enable export khi có REPORT:EXPORT, và chỉ hiện goal CUD theo REPORT CREATE/UPDATE/DELETE. Route/UI xử lý permission-denied, không chỉ ẩn nav.
26. Dashboard hiển thị đủ binding:
    - metric cards: Total activities, Completion rate, Tasks completed, Avg completion time, Overdue tasks, Time tracked, Meetings scheduled;
    - activity heatmap: grid 7 (day-of-week) × 24 (hour), intensity bằng màu + số count tooltip + text/label không color-only (accessibility), `role="img"`/aria-label, sr-only table equivalent (pattern `hideSrTable=false` của CustomerAnalyticsPage);
    - activity trend: line/area chart qua `ReportChart` (zero-filled buckets);
    - top performers leaderboard: table rank theo `sortBy` với 4 cột metric, mỗi cột sortable;
    - team comparison: side-by-side cards/table per team;
    - user drill-down: click user → detail panel (per-user activities by type/date, tasks, time, meetings, deals closed);
    - goals: danh sách goal với progress bar + % + create/edit/delete dialog (React Hook Form + Zod), chỉ hiện management UI khi caller có REPORT:CREATE/UPDATE/DELETE;
    - export: reuse/refactor `ExportReportMenu` request/download/toast behavior với supported formats `PDF`/`EXCEL`; mutation trả durable `ReportExport` (`READY|PENDING|PROCESSING|FAILED`), không trả signed URL trực tiếp.
27. Reuse shipped `ReportChart`/Recharts framework, `LoadingSkeleton`/`TableSkeleton`, `ErrorState`, `EmptyState`, `ResponsiveTableWrapper`, shadcn Card/Badge/Input/Button, `react-hot-toast`/inline feedback. Không dựng duplicate primitives, không cài chart lib.
28. Filter toolbar: date range, user, team, activity type (multi), contact, deal. Apply/reset rõ ràng; active filters luôn nhìn thấy; đổi filter reset page về đầu; invalid range/date bị chặn inline, không gửi query.
29. Responsive/accessibility: hoạt động tại 320px không horizontal overflow; table chuyển wrapper/card pattern; touch targets ≥ 44px; keyboard access đầy đủ; focus visible; chart/list feedback qua polite live region; color contrast WCAG 2.1 AA; heatmap có legend + sr-only table.
30. Export phải đi qua Story 6.6 end-to-end:

    ```graphql
    exportActivityReport(
      filters: ActivityReportFilterInput!
      format: ReportDeliveryFormat!
    ): ReportExport!
    ```

    - Resolver yêu cầu JWT + `REPORT:READ` + `REPORT:EXPORT` + `CONTACT:READ` + `TASK:READ` + `DEAL:READ`; service reject `CSV` bằng `BadRequestException('Activity reports support PDF and EXCEL only')`.
    - `ReportExportsService.exportActivityReport(...)` validate/normalize filters bằng cùng pure validator của query, tạo `ReportExport { sourceType: ACTIVITY_REPORT, reportId: null, filters: snapshot, filterSummary, status: PENDING, tenantId/userId/audit fields từ JWT }`, ghi đúng một service-level audit `CREATE/REPORT_EXPORT`, rồi reserve/process qua **existing** `ReportExportProcessor` lease path.
    - Refactor `ReportExportProcessor` theo `sourceType`: `SAVED_REPORT` giữ nguyên report visibility/source gates + existing payload dispatch; `ACTIVITY_REPORT` re-check active owner và toàn bộ current permissions, parse immutable filter snapshot, gọi activity payload adapter. Cả hai dùng cùng retry/READY/FAILED transitions, 50 MB/row/column bounds, `ReportAttachmentService`, `chartPngForPayload`, private report-export bucket/path, `REPORT_EXPORT_READY/FAILED`, history, fresh signed URL và delete cleanup.
    - Activity adapter chuyển authoritative result thành existing `ReportDocumentPayload`: PDF có title/date/filter summary/metric summary/heatmap + trend chart/data tables/page numbers/tenant branding; EXCEL có sheets `Summary`, `By Type`, `By User`, `By Date`, `Leaderboard`, `Team Comparison`, `Goals`, formula-injection protection. Không reimplement PDFKit/ExcelJS renderer và không nhận client SVG/HTML.
    - Frontend mở signed URL chỉ khi returned row `READY` qua existing `reportExportDownloadUrl`; PENDING/PROCESSING dùng existing queued notification/history UX; FAILED hiển thị bounded error. Extend `ExportReportMenu` bằng callback/source mode + `supportedFormats` thay vì copy menu; existing sales/custom callers và CSV option không đổi.
    - `/reports/exports` tiếp tục là history duy nhất; activity rows hiển thị `Activity report` khi `report=null`, source type và filters. `reportExportDownloadUrl`, list/detail/delete vẫn owner-only, ADMIN không bypass row ownership.
31. Giữ nguyên `/reports/sales`, builder, schedules, exports, win/loss, productivity, customer-analytics, report query caches và export controls. Query invalidation của activity report không được làm mất state của report khác.

### F. Tests, integration evidence và quality gates (AC 17–18 và toàn bộ security contract)

32. Pure unit tests (`apps/api/src/reports/__tests__/activity-report-metrics.spec.ts`): completionRate 0/1/edges, avgCompletionHours rounding/reject non-finite, heatmap 168 cells zero-filled + key mapping UTC, goal period window WEEKLY/MONTHLY boundaries (start of week/month, month length), expectedPace clamp, isFallingBehind thresholds, date UTC boundary/clamp.
33. Service/GraphQL tests (`activity-reports.service.spec.ts`, `activity-reports.graphql.spec.ts`, `activity-goals.service.spec.ts`): validation exact (range > 366, endDate < startDate, sortBy closed, targetCount bounds), visibility scope OWN/TEAM/ALL + shared ids, dealId two-step, aggregate shapes/no-N+1, goal CRUD validation + duplicate (activityType, period) rejection, Pothos schema registration + no ref/select drift.
34. Processor tests (`activity-goals-processor.service.spec.ts`): batching/grouped count (no N+1), tenant filters, falling-behind exact threshold, one notification/goal/period idempotency (P2002), no-alert khi period mới/đạt target, not-started/inactive/soft-deleted goal skip, new period may alert again, failure isolation per batch, deterministic clock. Export unit tests phải chứng minh source dispatch `SAVED_REPORT` không đổi và `ACTIVITY_REPORT` dùng immutable snapshot/current permission re-check, cùng renderer/processor transitions, reject CSV và không tạo signed URL trước READY.
35. Testcontainers GraphQL integration test (`apps/api/test/integration/activity-reports.integration.spec.ts`) dùng real PostgreSQL và non-ADMIN roles:
    - exact total/byType/byUser/byDate, due-cohort completion numerator/denominator/rate, completedAt-based tasks/average, open-status overdue-as-of clock, completed TimeEntry duration, meetings và actualCloseDate-based won deals từ seeded Activities/Tasks/TimeEntries/Deals/DealStages;
    - filters: date range, user, team, activity type, contact, deal;
    - leaderboard rank + team comparison + drill-down exact;
    - own/team/all + sharing visibility và cross-tenant/soft-delete negatives trên mọi section;
    - missing REPORT/CONTACT/TASK/DEAL permission denial; export additionally denies missing REPORT:EXPORT;
    - goal progress exact theo period window; processor rerun tạo đúng một notification/period và period kế tiếp có dedupe identity mới;
    - `exportActivityReport` tạo durable `ReportExport(sourceType=ACTIVITY_REPORT, reportId=null)`, history/detail/download/delete owner-only, current permission re-check, ready/failed notification, fresh 86,400-second URL, valid PDF magic bytes/XLSX zip + exact metrics/filter content; CSV rejected;
    - regression `exportReport` cho saved sales/custom vẫn tạo `sourceType=SAVED_REPORT`, giữ reportId và valid artifacts sau migration/refactor.
36. Frontend service/Jest/RTL tests: exact operation/variables/unwrap, query key isolation, metric cards, heatmap (counts + sr-only), trend, leaderboard sort, team comparison, drill-down, goals CRUD/progress bars/%, export button + loading + download, loading/error/empty/permission states, keyboard và 320px layout.
37. Playwright critical flow (`tests/e2e/activity-reports.spec.ts`): mở `/reports/activity`, apply filters, verify metrics/heatmap/trend/leaderboard, drill-down user, tạo goal và thấy progress, export button visible. Mock GraphQL deterministic fixture; formula + daily processor workflow thuộc API integration tests.
38. Quality gates trước khi claim completion: focused tests; API unit + integration serially; web Jest/RTL; Playwright; `prisma validate`/`generate`/migration inspection; root/API/Web type-check; lint; Prettier check; builds. Không lower coverage threshold, không skip tenant/permission/visibility/idempotency assertions, không yêu cầu production secrets.
39. Cập nhật `docs/project-context.md` với as-built Story 6.8: metric definitions, ActivityGoal model, activityReport surface, goal processor schedule, export path, route/nav map và tests. Chỉ ghi deferred work thật sự còn lại.
40. Completion chỉ được claim khi đủ evidence cho cả 18 binding AC: query đủ metrics; dashboard đủ heatmap/trend/leaderboard/team/drill-down; goals + progress + alerts idempotent; export PDF/XLSX hợp lệ; Epic 4 + Story 6.2–6.7 regression suites vẫn green.

---

## Tasks / Subtasks

- [x] **Task 1 — ActivityGoal + ReportExport source schema migration + notification type** (Binding AC: 13, 15–16; Contract: A1–A8, D19)
  - [x] Add `ActivityGoalPeriod` + `ActivityGoal` + race-safe partial unique index; add `ReportExportSourceType`, nullable checked reportId/sourceType extension; add `ACTIVITY_GOAL_AT_RISK` to `NOTIFICATION_TYPES`.
  - [x] Hand-write one additive/backward-compatible migration, inspect FK/CHECK/index/order and old-row backfill/default; generate/validate Prisma Client; update cleanup/TRUNCATE lists; prove saved export rows remain valid.
- [x] **Task 2 — Pure metric contract** (Binding AC: 4–5, 9, 17; Contract: B6–B8)
  - [x] Implement closed constants, UTC day math, heatmap cells, completion rate, avg completion time, goal period window/expected pace helpers with exhaustive pure unit tests.
- [x] **Task 3 — Typed activityReport GraphQL API + visibility** (Binding AC: 3–5, 10; Contract: C9–C16)
  - [x] Implement filters/pagination-less bounded query, layered predicates (buildFeedWhere/buildTaskWhere/buildTimeEntryWhere/buildDealWhere), user scope via visibility, dealId two-step, typed result refs.
  - [x] Register in ReportsModule.onModuleInit + schema barrel; schema/ref-select lockstep tests.
- [x] **Task 4 — Activity goals CRUD + progress + daily alert processor** (Binding AC: 13–15; Contract: D17–D22)
  - [x] Implement goal service (create/update/delete/list) with validation, permission gates, visibility check on subject user, server-computed progress.
  - [x] Implement `ActivityGoalProcessor` cron 07:00 UTC with batched/grouped counts, expected-pace check, idempotent `notifySafe` alerts (dedupeKey per goal/period), notification route mapping, failure isolation.
- [x] **Task 5 — Extend Story 6.6 ReportExport for activity PDF/Excel** (Binding AC: 16; Contract: A6–A8, E30)
  - [x] Extend existing selects/views/GraphQL/frontend history with `sourceType`; add `exportActivityReport(filters, format)` to `ReportExportsService`/registrar using immutable snapshots and existing audit/lease/processor.
  - [x] Add activity `ReportDocumentPayload` adapter and source-aware current-permission validation; reuse existing renderer/chart/storage/notification/history/download/delete, reject CSV, and regression-test saved sales/custom exports.
- [x] **Task 6 — Frontend service, route, dashboard** (Binding AC: 6–9, 11–14, 16; Contract: E23–E31)
  - [x] Add hand-written GraphQL service/query keys, thin route, nav/breadcrumb, `ActivityReportsPage` with loading/error/empty/permission states.
  - [x] Render metric cards, heatmap, trend, leaderboard, team comparison, drill-down, goals with progress bars, export button by reusing ReportChart/shared UI.
  - [x] Implement filter toolbar, exact labels, keyboard/mobile accessibility, query-state isolation.
- [x] **Task 7 — Integration, E2E, docs và regression gates** (Binding AC: 1–2, 17–18; Contract: F32–F40)
  - [x] Add Testcontainers/GraphQL integration evidence including cross-tenant/non-ADMIN negatives, goal progress, processor idempotency, export validity.
  - [x] Add deterministic Playwright activity-report flow; update `docs/project-context.md`; run Prisma, test, type-check, lint, format and build gates without threshold reductions.

  **Completion notes:**
  - Integration evidence is recorded above: `activity-reports.integration.spec.ts` is 23/23 green with Testcontainers and non-ADMIN visibility/permission coverage; saved-export regressions remain green.
  - Added `tests/e2e/activity-reports.spec.ts` for the deterministic mocked-GraphQL critical flow covering route, filters, metrics, heatmap/trend/leaderboard, drill-down, goal progress, and export visibility.
  - Live dogfood used real login, the dev API/Supabase path, populated dashboard/team comparison, applied filters, drill-down, 320px mobile, and post-fix export/history evidence. DF-01 was fixed and re-verified; DF-02/DF-03 remain low concerns documented in `docs/workflow-artifacts/6-8-activity-reports-team-productivity-metrics/dogfood/report.md`.
  - Updated `docs/project-context.md` with the as-built ActivityGoal, server metric/visibility contract, GraphQL surfaces, 07:00 UTC processor, source-aware ReportExport path, `/reports/activity` route/nav, and test/evidence references.

---

## Dev Notes

### Cross-story dependency map

| Story/area | Đã ship | Story 6.8 phải reuse/preserve |
| --- | --- | --- |
| Story 4.1 / Epic 4 | `Task` CRUD với status/completedAt/dueDate/assignedTo/contactId/dealId, soft delete | `completedAt` là completion authority; đếm task luôn tenant-scoped + deletedAt null |
| Story 4.2 | `Activity` append-only + auto-logging, `ActivityType` vocabulary, dedupeKey | Không mutate timeline; đếm qua aggregate; `createdBy` là identity (join User, không FK) |
| Story 4.4 / 6.3 | `ActivityService.buildFeedWhere` + feed visibility helpers | Dùng predicate chuẩn cho activity scope; không copy logic |
| Story 4.5 | `TimeEntry` + `TimeEntriesService.buildTimeEntryWhere` + `ProductivityService` (bounded, layered filter, running-excluded) | Reuse predicate + AC 21 layered filter; KHÔNG sửa `/reports/productivity` |
| Story 4.8 | `NotificationsService.notifySafe` + `NOTIFICATION_TYPES` pure tuple + dedupeKey | Thêm member tuple (không migration); alert qua notifySafe với dedupe key |
| Story 6.2 | REPORT permission + ReportsModule + closed report vocabularies | Không thêm `ACTIVITY` vào `REPORT_TYPES`/`PLATFORM_REPORT_TYPES`; reuse module/registration |
| Story 6.4 | `ReportChart`/Recharts framework | Reuse cho heatmap/trend; không cài chart lib |
| Story 6.5/6.7 | Nest Schedule root registration, `SYSTEM_CLOCK`/`Clock`, bounded processor + failure-summary patterns | Reuse cho goal processor (07:00 UTC); analytics/activity report không phải scheduled email |
| Story 6.6 | `ReportExport` durable history, lease/retry processor, `ReportDocumentPayload`, PDFKit/ExcelJS renderer, private Storage/signed URLs, owner-only history/download, notifications | **Mở rộng source-aware và reuse nguyên khối**; activity export phải tạo `ReportExport` row, không fork libs/storage/processor/history/notifications |
| Story 6.7 | Module onModuleInit registration + schema barrel + ref/select lockstep + visibility via parent predicate | Follow nguyên văn conventions; không đụng CustomerAnalyticsSnapshot/Contact fields |

### Current state đã verify — extend, không replace

- `Activity` bắt buộc `tenantId/contactId`, append-only, `createdBy` String không FK, index `[tenantId, contactId, createdAt DESC]` + `[tenantId, createdAt DESC]`; metadata không exposed.
- **Không có Prisma model `ActivityLog`.** "Activity log" trong Epic 4 là behavior quanh `ActivityService`/auto-logging; schema chỉ có `Activity` và preference model `UserActivityLogPreference`. Không tạo/query một model tưởng tượng tên `ActivityLog`.
- `Task` có status/completedAt/dueDate/assignedTo FK/contactId/dealId, audit, soft delete; `TaskStatus = TODO|IN_PROGRESS|COMPLETED|CANCELLED`.
- `TimeEntry` có `durationSeconds` (single source of truth), `endTime` nullable (running timer).
- `Deal.ownerId` FK User; won/lost authority = active `DealStage.isWon/isLost`; `actualCloseDate` là period authority cho leaderboard deals-closed, giống Win/Loss report.
- `User` có firstName/lastName/teamId; `Team` có id/name/managerId/members.
- `ReportsModule` đã import Contacts/Deals/Tasks/Activities/TimeTracking/Notifications/Permissions/Storage — thêm providers không cần module mới hoặc dependency mới.
- `NOTIFICATION_TYPES` là const tuple pure module; thêm member không cần migration; `resolveNotificationTarget` giữ nguyên (alert target NONE).
- GraphQL schema chỉ có field từ explicit side-effect imports; thiếu barrel import sẽ drop query im lặng.
- `ReportExport.reportId` hiện là FK bắt buộc và payload dispatcher chỉ biết saved sales/custom; đây là integration seam phải refactor thành source-aware. Mọi lease/retry/render/storage/history/download/notification behavior còn lại đã ship và bắt buộc reuse.
- RLS không ship. Mọi query thiếu `tenantId` là security defect trực tiếp.
- Frontend có `ReportChart`, shared loading/error/empty/table primitives, hand-written GraphQL services (`graphqlRequest` từ `@/lib/graphql-client`), nav/breadcrumb permission-gated; `/reports/productivity` route đã tồn tại — route mới `/reports/activity` không trùng.

### Existing files dự kiến UPDATE — phải đọc lại trước khi sửa

| Existing file | Current behavior | Story 6.8 change | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/api/prisma/schema.prisma` | Activity/Task/TimeEntry/Deal/User/Team/Notification/Report + required-report `ReportExport` schema | Add `ActivityGoalPeriod`/`ActivityGoal`; add `ReportExportSourceType`, sourceType and nullable checked reportId | Mọi model/field hiện có; all 6.6 export rows/indexes/ownership/history |
| `apps/api/src/activities/activities.graphql.ts` | Owns the single Pothos `ActivityType` enum | Export existing enum ref for activity-report input reuse | Existing Activity SDL/resolvers/subscriptions |
| `apps/api/src/notifications/notification-types.ts` | Pure const tuple NOTIFICATION_TYPES | Add `ACTIVITY_GOAL_AT_RISK` member | Pure module (no Nest/Prisma), resolveNotificationTarget behavior |
| `apps/api/src/reports/reports.module.ts` | Registers report/schedule/export/analytics services | Provide/register activity-report + goals service + processor and inject activity service into export payload path | Registration order; existing reports |
| `apps/api/src/graphql/schema.ts` | Explicit Pothos side-effect import list | Add `../reports/activity-reports.graphql` | No silent field disappearance |
| `apps/api/src/reports/report-exports.service.ts` | Saved-report request/history/download/delete; reportId assumed non-null | Add `exportActivityReport`, source-aware validation/summary; keep owner-only semantics | Existing exportReport + sales/custom gates/audit |
| `apps/api/src/reports/report-export-payload.service.ts` | Dispatches saved sales/custom data to `ReportDocumentPayload` | Add activity source adapter over authoritative ActivityReportsService result/snapshot | Existing immutable sales/custom replay and paging |
| `apps/api/src/reports/report-export-processor.service.ts` | Durable lease/retry/render/upload/notify; always loads reportId | Branch only source access/payload step; reuse all processing/finalization | Lease, retry, bounds, storage path, notification, READY/FAILED invariants |
| `apps/api/src/reports/report-exports.graphql.ts` | ReportExport refs + saved export mutation/history/download/delete | Expose sourceType and add `exportActivityReport` using shared input/enum refs | Existing SDL names and owner gates |
| `apps/api/src/reports/report-document-payload.ts` | Shared normalized sales/custom document payload | Add pure activity-result normalization without duplicating renderer | Null/percentage/formula safety and renderer contract |
| `apps/web/src/components/layout/AppShellNavigation.tsx` | Permission-gated report routes | Add `Activity` route (REPORT:READ) | Existing active-route specificity and nav tests |
| `apps/web/src/components/layout/Breadcrumbs.tsx` | Explicit route labels | Add `activity: Activity` label | Existing labels |
| `apps/web/src/services/report-export.service.ts` | Hand-written saved-export operations/types | Add sourceType + `exportActivityReport`; reuse history/download functions | Existing fragments/query keys and no URL cache |
| `apps/web/src/components/reports/ExportReportMenu.tsx` | Saved reportId + PDF/EXCEL/CSV request/download UX | Add callback/source mode + supportedFormats so activity reuses the component | Existing saved report behavior and CSV option |
| `apps/web/src/components/reports/ReportExportsPage.tsx` | Owner export history assumes report summary may be null | Label activity source and retain actions/status | Existing pagination/download/delete/queued UX |
| `apps/web/src/lib/notification-format.ts` | Trusted internal href/label/icon mapping by notification type | Map `ACTIVITY_GOAL_AT_RISK` to `/reports/activity` + activity-goal label/icon | Existing deal/task/report-export routes |
| `apps/api/test/api/api-test-harness.ts` và integration TRUNCATE lists | DB cleanup | Add `ActivityGoal` before parents (Activity/Task/User) | Existing test isolation |
| `docs/project-context.md` | As-built code authority | Document shipped Story 6.8 reality after implementation | Code-wins accuracy |

### Planned implementation surface

**NEW — Backend**

- `apps/api/prisma/migrations/<timestamp>_add_activity_goal/migration.sql`
- `apps/api/src/reports/activity-report-metrics.ts`
- `apps/api/src/reports/activity-reports.service.ts`
- `apps/api/src/reports/activity-reports.graphql.ts`
- `apps/api/src/reports/activity-goals.service.ts`
- `apps/api/src/reports/activity-goals-processor.service.ts`
- activity `ReportDocumentPayload` adapter may live in `activity-report-export-payload.ts` or existing `report-document-payload.ts`; **không tạo standalone renderer/processor/storage service**
- mirrored unit specs dưới `apps/api/src/reports/__tests__/`
- `apps/api/test/integration/activity-reports.integration.spec.ts`

**NEW — Frontend / E2E**

- `apps/web/src/services/activity-report.service.ts` + mirrored spec
- `apps/web/src/lib/activity-report.ts` + mirrored spec nếu transformations được tách
- `apps/web/src/components/reports/ActivityReportsPage.tsx` + mirrored RTL spec
- `apps/web/src/app/(dashboard)/reports/activity/page.tsx` + thin-page spec
- `tests/e2e/activity-reports.spec.ts`

Test/helper filenames có thể tinh chỉnh, nhưng ActivityGoal model, pure metrics, typed query, goal CRUD/progress, processor idempotent alert, bounded export, required route/dashboard/heatmap/trend/leaderboard/team/drill-down và security tests là bắt buộc.

### Security, reliability và performance invariants

1. Every DB access includes `tenantId`; RLS không tồn tại làm backstop.
2. Query permission = REPORT:READ + CONTACT:READ + TASK:READ + DEAL:READ; goal mutations = REPORT:CREATE/UPDATE/DELETE.
3. Mọi user trong report phải nằm trong visibility scope của caller; cross-tenant/soft-deleted/not-visible data không xuất hiện ở bất kỳ section nào.
4. Không N+1: aggregate theo batch/groupBy; leaderboard và drill-down bounded; heatmap/trend zero-filled từ aggregate.
5. Date range bắt buộc, max 366 ngày; raw/drill row bound 20 000 (vượt → throw, không silent truncation); overview aggregates/database groupBy phải bounded.
6. Alerts: tối đa một notification/goal/period; rerun/concurrent không duplicate (dedupeKey), period mới có identity mới; failure không swallow thành success.
7. Export dùng durable Story 6.6 processor (inline khi bounded hoặc queued theo existing policy), file không chứa data ngoài visibility; signed URL TTL 24h, object path không vượt service boundary; permission được re-check lúc execution/download.
8. Client không tính metric/progress; mọi value server-owned.
9. Pothos ref/service select, module registration, barrel import và frontend fragments lockstep.
10. Không sửa Activity/Task/TimeEntry/Deal; không thêm ACTIVITY vào saved Report vocabulary. `ReportExport` chỉ được mở rộng source-aware ở integration seam, mọi existing 6.6 behavior phải regression-green.

### Các lỗi implementation phổ biến phải tránh

- Không dùng `TASK_COMPLETED` activity count làm completion rate — phải dùng `Task.completedAt`.
- Không recompute duration từ startTime/endTime; dùng `durationSeconds` và loại running entries (`endTime != null`).
- Không dùng `Deal.createdAt` làm ngày đóng — dùng `actualCloseDate` + active stage `isWon`; null date không period-attributed.
- Không đếm user/team ngoài visibility scope của caller; không bypass bằng cách dùng createdBy String không kiểm tra.
- Không thêm `ACTIVITY` vào `REPORT_TYPES`/`PLATFORM_REPORT_TYPES`, không tạo saved Report giả, và không fork export. Activity export **phải** tạo `ReportExport(sourceType=ACTIVITY_REPORT, reportId=null)` qua Story 6.6 machinery.
- Không cài chart lib, không thêm dependency, không nâng Prisma major.
- Không gửi alert mỗi lần processor chạy — dedupeKey per goal/period; không alert khi period mới bắt đầu hoặc đã đạt target.
- Không để heatmap/trend mất cell 0 (silent truncation) — luôn zero-filled.
- Không quên schema barrel/module registration/nav breadcrumb/test cleanup.
- Không sửa `/reports/productivity` route, service hay UI của Story 4.5.

### Git/dependency intelligence

- Baseline branch `dev`, commit `a9714f6` (`Merge pull request #66 ... customer-lifetime-value-churn-risk-analysis`); working tree sạch tại lúc authoring.
- Recent Story 6.7 commit `cdf2c8b` xác lập module/barrel/processor/visibility/ref-select conventions dùng làm pattern chính.
- Installed direct versions: API Prisma/client `^5.10.0`, `@nestjs/schedule ^6.1.3`, `exceljs`, `pdfkit`; Web Recharts `^3.10.1`, Next `14.2.35`, TanStack Query `^5.100.9`.
- Không có dependency mới; không cần sửa package manifests/lockfile.

---

## Traceability Notes

| Binding AC | Nguồn | Evidence target |
| --- | --- | --- |
| AC 1–2 | Story 6.8 context | Preserve Epic 4 Activity/Task/TimeEntry integrations and regressions |
| AC 3 | Exact query name | Registered typed `activityReport(filters)` SDL + GraphQL integration |
| AC 4 | Exact activity metrics list | Pure metric contract + aggregate unit + Testcontainers exact-value integration |
| AC 5 | Exact productivity metrics list | Task/TimeEntry/Deal-scoped aggregate unit + integration evidence |
| AC 6 | Exact route | Thin route + RTL/Playwright |
| AC 7–8 | Heatmap/trend/leaderboard | 168-cell heatmap + trend + leaderboard data/UI tests |
| AC 9 | Leaderboard rank keys | 4-metric rank + sortBy closed vocabulary tests |
| AC 10 | Filter list | Service variables + backend predicates integration |
| AC 11 | Team comparison | teamComparison data + UI tests |
| AC 12 | User drill-down | userDrillDown data + UI interaction test |
| AC 13 | Goals | ActivityGoal model + CRUD + progress computation tests |
| AC 14 | Progress bars | Progress % server-computed + RTL |
| AC 15 | Alerts | `ACTIVITY_GOAL_AT_RISK` + processor idempotency (one/goal/period) + notification route tests |
| AC 16 | Export PDF/Excel | Source-aware extension of Story 6.6 `ReportExport` + valid-file/history/download/notification regressions |
| AC 17 | Unit tests | Pure/service/processor/GraphQL suites |
| AC 18 | Integration accuracy | Testcontainers non-ADMIN exact-value + visibility/permission negatives |

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1710-1735`] — Story 6.8 statement và toàn bộ 18 binding AC.
- [Source: `_bmad-output/planning-artifacts/epics.md:1519-1735`] — Epic 6 cross-story reporting context.
- [Source: `_bmad-output/planning-artifacts/epics.md:342-350`] — FR40–FR47 mapping; FR63 Activity Reports chỉ trong PRD Journey 2, không có trong FR list.
- [Source: `_bmad-output/planning-artifacts/prd.md:629-633`] — Journey 2 (Sarah — Sales Manager): Activity Reports (#63) cho team productivity tracking.
- [Source: `_bmad-output/planning-artifacts/prd.md:948-949`] — FR19 (activity views), FR20 (time tracking & productivity reports).
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-242`] — stack, tenant/RBAC/type-safety/testing constraints.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-700`] — project structure, Reports mapping và API/data boundaries.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1600`] — Saved View Toolbar (report filter/toolbar pattern).
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1602-1641`] — component strategy, accessibility, reuse patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1692-2000`] — button hierarchy, feedback, empty/loading, table, status badge patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2110-2260`] — responsive + accessibility strategy (320px, keyboard, AA).
- [Source: `docs/project-context.md:39-105`] — shipped stack, Pothos/Prisma/Schedule và application-only tenant isolation.
- [Source: `docs/project-context.md:143-176`] — tests, coverage, audit/registration rules.
- [Source: `docs/project-context.md:181-224`] — permission/version/dependency reality.
- [Source: `docs/project-context.md:323-385`] — house Prisma/domain/module/frontend conventions; as-built route map (Story 4.4/4.5/6.2–6.7).
- [Source: `docs/project-context.md:794-829`] — Prisma migration rules và as-built report map (Story 6.7).
- [Source: `docs/rules/typescript-rules.md`] — strict TS, pure typed logic và error handling.
- [Source: `docs/rules/react-nextjs-rules.md`] — TanStack/UI state, accessibility, responsive/forms.
- [Source: `docs/rules/prisma-rules.md`] — tenant filters, indexes, batch/transaction/migration patterns.
- [Source: `docs/rules/nestjs-rules.md`] — service/DI/exception/testing conventions.
- [Source: `apps/api/prisma/schema.prisma:10-25,160-183,258-274,372-475,666-705,1154-1216,1320-1330`] — ActivityType/TaskStatus, User, Team, Contact, Activity, Deal, Task, TimeEntry models.
- [Source: `apps/api/src/activities/activities.service.ts:149,494-575`] — `ActivityService.buildFeedWhere` shared predicate.
- [Source: `apps/api/src/activities/activity-feed-visibility.ts`] — feed visibility helpers.
- [Source: `apps/api/src/time-tracking/time-entries.service.ts`] — `buildTimeEntryWhere` + running-entry semantics.
- [Source: `apps/api/src/reports/productivity.service.ts:54-56,98-171`] — bounded report pattern, layered filter (AC 21), visibility scope (AC 17), MAX range/entries.
- [Source: `apps/api/src/reports/productivity-buckets.ts`] — reusable bucket enumerate/collapse helpers (pure).
- [Source: `apps/api/src/reports/reports.module.ts`] — current reports DI/registration map (onModuleInit pattern).
- [Source: `apps/api/src/reports/report-types.ts`] — closed REPORT_TYPES/PLATFORM_REPORT_TYPES vocabulary (KHÔNG thêm ACTIVITY).
- [Source: `apps/api/prisma/schema.prisma:1683-1734`] — existing `ReportExport`, required reportId, format/status/filters/lease/storage metadata/indexes cần mở rộng backward-compatible.
- [Source: `apps/api/src/reports/report-exports.service.ts`] — owner-scoped request/history/detail/download/delete, audit và source permission checks cần preserve.
- [Source: `apps/api/src/reports/report-export-payload.service.ts`] — immutable saved-report snapshot + sales/custom dispatch cần refactor source-aware, không thay thế.
- [Source: `apps/api/src/reports/report-export-processor.service.ts`] — durable lease/retry/permission re-check/render/upload/notify machinery bắt buộc reuse.
- [Source: `apps/api/src/reports/report-document-payload.ts`] — shared document payload normalization cần thêm activity adapter.
- [Source: `apps/api/src/reports/report-attachment.service.ts`, `report-export-chart.ts`] — PDF/Excel renderer, limits và chart-as-image path đã ship; không reimplement.
- [Source: `apps/api/src/reports/report-exports.graphql.ts`, `apps/web/src/services/report-export.service.ts`, `apps/web/src/components/reports/ExportReportMenu.tsx`] — existing SDL/frontend export/history/download contract phải extend, không fork.
- [Source: `apps/api/src/notifications/notification-types.ts:14-28`] — NOTIFICATION_TYPES pure tuple + resolveNotificationTarget.
- [Source: `apps/api/src/notifications/notifications.service.ts`] — `notifySafe` + dedupeKey semantics (Story 4.8).
- [Source: `apps/api/src/graphql/schema.ts`] — explicit schema side-effect imports (barrel).
- [Source: `apps/api/src/activities/activities.graphql.ts:21-23`] — `ActivityType` GraphQL enum (reuse, không khai báo thứ hai).
- [Source: `apps/api/src/reports/customer-analytics.graphql.ts`, `customer-analytics-processor.service.ts`, `customer-analytics-score.ts`] — Story 6.7 conventions: typed filters, processor batching, pure score module.
- [Source: `apps/api/src/permissions/default-role-permissions.ts:27-32`] — REPORT READ/EXPORT/CREATE/UPDATE/DELETE permission vocabulary.
- [Source: `apps/web/src/app/(dashboard)/reports/productivity/page.tsx`] — thin route + QueryProvider pattern.
- [Source: `apps/web/src/services/productivity.service.ts:1-3`] — `graphqlRequest` from `@/lib/graphql-client` service pattern.
- [Source: `apps/web/src/components/reports/charting/ReportChart.tsx`] — reusable shipped Recharts framework.
- [Source: `apps/web/src/components/layout/AppShellNavigation.tsx:85-137`] — current report nav/permission map.
- [Source: `apps/web/src/components/layout/Breadcrumbs.tsx:17-60`] — required route segment labels.
- [Source: `_bmad-output/implementation-artifacts/6-7-customer-lifetime-value-churn-risk-analysis.md`] — previous-story module/barrel/processor/visibility/ref-select/testing intelligence.
- [Source: `_bmad-output/implementation-artifacts/6-6-report-export-in-multiple-formats-pdf-excel-csv.md`] — export libs, storage/signed-URL, bounded generation intelligence.
- [Source: `_bmad-output/implementation-artifacts/4-5-time-tracking-productivity-reports.md`] — TimeEntry/ProductivityService semantics (AC 15-24).

---

## Story Completion Status

- Status hiện tại: `review` — implementation, E2E, dogfood evidence, documentation, and regression gates are complete; awaiting PR integration.
- Đã preserve nguyên văn đầy đủ 18 binding acceptance statements từ Epic Story 6.8.
- Technical arbitration đã resolve theo code hiện tại: exact Activity/Task/TimeEntry/Deal semantics, due-cohort completion rate, actualCloseDate deals-closed period, visibility/team/deal provenance, goals model + race-safe uniqueness + idempotent alerts, và source-aware **reuse toàn bộ Story 6.6 ReportExport machinery** cho PDF/Excel.
- Đã hoàn tất Playwright flow và live dogfood ở Stage 9; screenshot evidence dùng cho PR được copy riêng dưới `docs/pr-screenshots/6-8-activity-reports-team-productivity-metrics/` và không commit các artifact gitignored.

---

## Dev Agent Record

### Agent Model Used

opencode-go/deepseek-v4-flash (Stage 5A-CONTINUATION — backend dispatch)

### Debug Log References

- Baseline state verified: `activity-report-metrics.ts` 33/33 green; `activity-reports.service.spec.ts` RED (module missing). Branch `feature/reports/activity-reports-team-productivity-metrics`; no commits made.
- `prisma validate` (dummy DATABASE_URL) passed; hand-written additive migration `20260822130000_add_activity_goal_report_export_source` inspected (ActivityGoalPeriod/ActivityGoal + partial unique index + ReportExportSourceType/sourceType/nullable reportId + CHECK constraint) — no data loss.
- Spec contradiction fixed in `activity-reports.service.spec.ts` OWN-scope test: the two `activity.groupBy` mock values were swapped so the byUser-shaped fixture is consumed by the SECOND groupBy call (byType-then-byUser order locked by the other three tests). Test intent (OWN → caller only) unchanged.
- `totalActivities` derives from the scoped byUser groupBy sum (identical where clause as a count; keeps "visible users only" semantics authoritative; reconciles the drill-down fixture's mock sequence).
- `report-exports.service.spec.ts` / `report-export-payload.service.spec.ts` / `notification-types.spec.ts` updated for the new constructor params / notification member.
- Export processor `processClaimed` now branches on `sourceType` BEFORE the saved-report report gate; `reportId ?? ''` fallbacks only reachable for corrupt SAVED_REPORT rows (DB CHECK guarantees non-null).
- **Migration fix (found by the first Testcontainers run):** the hand-written partial unique index `COALESCE("activityType"::text, '__TOTAL__')` FAILS on real PostgreSQL with 42P17 ("functions in index expression must be marked IMMUTABLE" — enum→text cast is STABLE). Replaced with TWO partial unique indexes expressing the same invariant without any cast: `(tenantId, userId, period, activityType) WHERE activityType IS NOT NULL` for typed goals + `(tenantId, userId, period) WHERE activityType IS NULL` for TOTAL goals (NULLs are distinct in plain unique indexes, so the second index is what makes concurrent TOTAL goals collide). Verified on a live postgres:15-alpine container (typed collision + TOTAL collision both raise duplicate-key).
- Final gates: API unit suite 134 suites / 2833 tests green WITH 80/80/80/80 coverage thresholds; `activity-reports.integration.spec.ts` 23/23 green (Testcontainers, non-ADMIN); existing `report-exports.integration.spec.ts` 19/19 and `report-export-artifacts.integration.spec.ts` 4/4 green (6.6 backward-compat regression); `pnpm lint` 0 errors; `tsc --noEmit` clean; `pnpm build` (nest build) exit 0; `prisma validate` + `prisma generate` green.

### Completion Notes List

- **Task 1-2 (earlier dispatch, preserved):** ActivityGoal + ReportExportSourceType schema/migration, `activity-report-metrics.ts` pure module (33/33).
- **Task 3:** `ActivityReportsService` (layered predicates via ActivityService.buildFeedWhere / TasksService.buildTaskWhere / TimeEntriesService.buildTimeEntryWhere / DealsService.buildDealWhere; visibility via shared `resolveVisibilityFilter`; dealId two-step authorization; bounded 20k rows + 366-day range; no-N+1 batched aggregates + single label lookup; leaderboard 4-metric sort + id-asc tie-break; teamComparison only for requested teams; drill-down subject-lock + pagination clamp). Registered in `ReportsModule.onModuleInit` + `schema.ts` barrel; `ActivityTypeEnum` exported from `activities.graphql.ts` (single enum reuse). Unit spec 22/22 + GraphQL schema spec 6/6.
- **Task 4:** `ActivityGoalsService` (validation bounds name<=200 / target 1..10_000 / UTC-midnight startsOn / closed period+type; subject visibility; duplicate (user,period,activityType) BadRequest + P2002→Conflict; batched window groupBy progress) 17/17; `ActivityGoalProcessor` cron `0 0 7 * * *`, per-tenant batches, grouped window counts, `isFallingBehind` threshold, `dedupeKey=activity-goal-at-risk:<goalId>:<periodStart>` idempotent alerts, failure isolation, summary `{tenants, goalsSucceeded, goalsFailed, notificationsCreated}` 9/9; `ACTIVITY_GOAL_AT_RISK` added to NOTIFICATION_TYPES (pure tuple — no migration).
- **Task 5:** `exportActivityReport(filters, format)` (CSV rejected `'Activity reports support PDF and EXCEL only'`; pure-validator snapshot persisted on `ReportExport { sourceType: ACTIVITY_REPORT, reportId: null }`; one service-level audit CREATE/REPORT_EXPORT; reserve → probe → processClaimed under the same lease); processor source dispatch (SAVED_REPORT byte-for-byte, ACTIVITY_REPORT re-checks REPORT:READ+EXPORT/CONTACT/TASK/DEAL:READ then replays immutable snapshot through the activity adapter); pure `activity-report-export-payload.ts` adapter (Summary metrics, sectioned Data rows, AREA trend chart series, formula-safe text); `sourceType` exposed on ReportExport GraphQL + `ReportExportSourceType` enum. Unit 10/10.
- **Task 6:** Frontend (apps/web only) — Hand-written `activity-report.service.ts` + query keys rooted at `['activityReport']` (overview, drillDown, goals); pure transformations and matrix builders in `lib/activity-report.ts` (100% covered); thin route `app/(dashboard)/reports/activity/page.tsx`; Nav & breadcrumbs integration in `AppShellNavigation.tsx` (gated on REPORT:READ) & `Breadcrumbs.tsx` (`activity: Activity`); Extended `report-export.service.ts` with `sourceType` and `exportActivityReport`, `ExportReportMenu.tsx` with callback mode and format filtering, and `ReportExportsPage.tsx` with activity source fallback labels; mapped `ACTIVITY_GOAL_AT_RISK` in `notification-format.ts` to `/reports/activity` + Target icon; Built `ActivityReportsPage.tsx` with 7 metric cards, 7x24 heatmap with SR-only table, trend chart via `ReportChart`, sortable leaderboard table, team comparison cards, individual drill-down panel, goal progress bars with CRUD dialogs (Zod + React Hook Form); All unit & RTL tests created and passing (241 test suites / 2047 tests passing in apps/web, meeting all 80/80/80/78 coverage thresholds).
- **Regression:** full API unit suite 134 suites / 2823 tests green; `prisma validate` green; API tsc clean; full Web test suite 241 suites / 2047 tests green; Web lint green; Web build exit 0.

### Stage 8 Backend Fix Loop 1 (code-review findings M2/M3/M5/M6/M8 — apps/api only)

- **Model:** opencode-go/deepseek-v4-flash (Stage 8 FIX LOOP backend dispatch). Branch giữ nguyên `feature/reports/activity-reports-team-productivity-metrics`; KHÔNG commit.
- **M2 (redundant totalCount) — RED→GREEN:** RED — spec assert `activity.count` gọi ĐÚNG 1 lần (chỉ meetings, `where.type === 'MEETING_SCHEDULED'`) và fixture OWN/aggregate chỉ mock meetings count; fail với 2 count calls (total + meetings). GREEN — xóa `activity.count({ where: activityWhere })` khỏi Promise.all + `void totalCount`; `totalActivities` vẫn derive từ scoped byUser groupBy sum.
- **M3 (silent task truncation) — RED→GREEN:** RED — 2 tests mới assert `calculationNote` chứa `activity scope truncated at 1000 tasks for deal deal-1` khi provenance fetch trả đúng 1000 tasks, và KHÔNG chứa khi 999 tasks; fail với note rỗng. GREEN — `resolveDealProvenance` trả `{ provenance, taskTruncated }`, `computeOverview` nhận `taskTruncated` và push note khi chạm cap.
- **M5 (notificationsCreated over-count) — RED→GREEN:** RED — processor tests assert dedupe (`notifySafe → false`) giữ `notificationsCreated` = 0 và mixed run đếm 1/2; notifications spec assert `notifySafe` trả `false` khi P2002 dedupe; fail vì count luôn += 1. GREEN — `NotificationsService.createWithStatus` trả `{ notification, created }`, `notifySafe` trả `Promise<boolean>` (true chỉ khi insert mới), processor increment chỉ khi `created === true`; `create()` public API giữ nguyên.
- **M6 (SDL item nullability) — FALSE POSITIVE, hardened:** verify bằng `printSchema(builder.toSchema({}))` trên schema thật: `t.idList()` / `t.field({ type: [ActivityTypeEnum] })` ĐÃ emit `[ID!]`/`[ActivityType!]` (Pothos v4 default input list items = non-null). Đổi sang dạng explicit `required: { items: true, list: false }` (SDL không đổi) + schema test riêng: positive `[ID!]`/`[ActivityType!]` và negative không có dạng nullable-item.
- **M8 (Clock shape) — RED→GREEN:** RED — mọi construction site trong spec đổi sang `{ now: (): Date => ... }` → TS `'now' does not exist in type '() => Date'` + runtime `this.clock is not a function` (28 tests fail). GREEN — cả `ActivityReportsService` và `ActivityGoalsService` nhận `Clock` từ `report-schedule-types.ts` (`@Optional() private readonly clock: Clock = SYSTEM_CLOCK`, gọi `this.clock.now()`), param `@Optional` cuối constructor.
- **Gates (real exit codes):** `pnpm --filter api test` → 134 suites / 2839 tests, coverage thresholds 80/80/80/80 KHÔNG hạ, exit 0. `pnpm --filter api lint` → exit 0. `pnpm --filter api exec tsc --noEmit` → exit 0. Integration `./node_modules/.bin/jest --config jest.integration.config.ts --coverage=false --runInBand --testPathPattern='activity-reports.integration.spec'` → 23/23, exit 0.
- **Changed files (apps/api only):** `src/reports/activity-reports.service.ts` (M2/M3/M8), `src/reports/activity-goals.service.ts` (M8), `src/reports/activity-goals-processor.service.ts` (M5), `src/notifications/notifications.service.ts` (M5), `src/reports/activity-reports.graphql.ts` (M6), `src/reports/__tests__/activity-reports.service.spec.ts` (M2/M3/M8 tests), `src/reports/__tests__/activity-goals.service.spec.ts` (M8), `src/reports/__tests__/activity-goals-processor.service.spec.ts` (M5), `src/notifications/__tests__/notifications.service.spec.ts` (M5), `src/reports/__tests__/activity-reports.graphql.spec.ts` (M6), story file này (Review resolutions + block này). Không chạm `apps/web/`.

### Stage 8 Frontend Fix Loop 1 (code-review findings I1/M4/M7 — apps/web only)

- **Model:** ag/gemini-3.7-flash-high (Stage 8 FIX LOOP frontend dispatch). Branch giữ nguyên `feature/reports/activity-reports-team-productivity-metrics`; KHÔNG commit.
- **I1 (Team comparison UI trigger) — RED→GREEN:** RED — spec `ActivityReportsPageInteractions.spec.tsx` assert chọn so sánh team (chip toggle "Alpha Team") gửi `comparisonTeamIds: ['t1']` vào query `getActivityReport` và reset về `null`; fail vì thiếu comparison team chips / state. GREEN — thêm state `selectedComparisonTeamIds`, chip multi-select "Compare Teams (Multi-select, max 4)" vào filter toolbar (kèm toast giới hạn 4 teams), truyền `comparisonTeamIds` vào `appliedFilters` và reset handler.
- **M4 (Drill-down error state) — RED→GREEN:** RED — spec `ActivityReportsPage.spec.tsx` assert lazy drill-down query `isError` render `<ErrorState title="Could not load drill-down data" ... />` kèm retry button ("Try again"); fail vì panel chỉ render header rỗng. GREEN — thêm nhánh `drillDownQuery.isError` render `ErrorState` kèm `onRetry={() => drillDownQuery.refetch()}`.
- **M7 (Touch target >= 44px) — RED→GREEN:** RED — spec `ActivityReportsPage.spec.tsx` assert nút Edit & Delete goal có class `min-h-[44px]` và `min-w-[44px]`; fail vì nút dùng `min-h-[32px] min-w-[32px]`. GREEN — nâng kích thước nút Edit & Delete goal lên `min-h-[44px] min-w-[44px]` (giữ `p-1`).
- **Gates (real exit codes):** `pnpm --filter web test` → 241 suites / 2050 tests passing (thresholds 80/80/80/78 giữ nguyên), exit 0. `pnpm --filter web lint` → exit 0. `pnpm --filter web build` → exit 0.
- **Changed files (apps/web only):** `apps/web/src/components/reports/ActivityReportsPage.tsx` (I1/M4/M7), `apps/web/src/components/reports/__tests__/ActivityReportsPage.spec.tsx` (M4/M7 tests), `apps/web/src/components/reports/__tests__/ActivityReportsPageInteractions.spec.tsx` (I1 tests), story file này. Không chạm `apps/api/`.

### Stage 8 Frontend Dogfood Fix Loop — DF-01 (2026-08-22)

- **Model:** `openai-codex/gpt-5.6-luna`; branch giữ nguyên `feature/reports/activity-reports-team-productivity-metrics`; **KHÔNG commit**.
- **Finding:** live dogfood observed `/reports/activity` stuck at `Exporting PDF...` after the backend export was READY; `/reports/exports` and a 50,018-byte `%PDF-1.3` download proved backend/storage completion.
- **Root cause:** `ExportReportMenu` used an `async onSuccess` mutation lifecycle callback. READY handling awaited `getReportExportDownloadUrl` and the existing Blob download before TanStack Query could settle the mutation, so `isPending` kept the trigger in the loading/disabled state. The direct activity `onExport` callback shared this path.
- **RED → GREEN:** Added a deferred READY activity `onExport` RTL regression in `ExportReportMenu.spec.tsx`; RED focused run failed (exit 1) because `Exporting PDF...` remained while the signed URL promise was pending. Minimal fix: close the popover and clear `activeFormat` synchronously in `onSuccess`, invoke the existing READY URL/download flow as detached handled async work, and preserve queued/failed toasts. GREEN focused run: 11 tests passed, exit 0. The READY test proves URL/download is invoked only for READY and only after the control has left loading; queued and failed tests prove menu close/loading reset and no download URL call.
- **Gates (real exit codes):** `pnpm --filter web test` → 241 suites passed; 2,050 passed, 1 skipped / 2,051 total; exit 0. `pnpm --filter web lint` → exit 0 (pre-existing Next ESLint warnings only). `pnpm --filter web build` → production build completed successfully; exit 0. No coverage thresholds were lowered.
- **Changed files:** `apps/web/src/components/reports/ExportReportMenu.tsx`; `apps/web/src/components/reports/__tests__/ExportReportMenu.spec.tsx`; `docs/workflow-artifacts/6-8-activity-reports-team-productivity-metrics/dogfood/report.md`; this story record. No API/E2E/fixture changes; no commit.


### File List

NEW:
- apps/api/src/reports/activity-reports.service.ts
- apps/api/src/reports/activity-reports.graphql.ts
- apps/api/src/reports/activity-goals.service.ts
- apps/api/src/reports/activity-goals-processor.service.ts
- apps/api/src/reports/activity-report-export-payload.ts
- apps/api/src/reports/__tests__/activity-goals.service.spec.ts
- apps/api/src/reports/__tests__/activity-goals-processor.service.spec.ts
- apps/api/src/reports/__tests__/activity-reports.graphql.spec.ts
- apps/api/src/reports/__tests__/activity-report-export.spec.ts
- apps/api/test/integration/activity-reports.integration.spec.ts
- apps/web/src/services/activity-report.service.ts
- apps/web/src/services/__tests__/activity-report.service.spec.ts
- apps/web/src/lib/activity-report.ts
- apps/web/src/lib/__tests__/activity-report.spec.ts
- apps/web/src/app/(dashboard)/reports/activity/page.tsx
- apps/web/src/app/(dashboard)/reports/activity/__tests__/page.spec.tsx
- apps/web/src/components/reports/ActivityGoalDialog.tsx
- apps/web/src/components/reports/__tests__/ActivityGoalDialog.spec.tsx
- apps/web/src/components/reports/ActivityReportsPage.tsx
- apps/web/src/components/reports/__tests__/ActivityReportsPage.spec.tsx
- apps/web/src/components/reports/__tests__/ActivityReportsPageBranches.spec.tsx
- apps/web/src/components/reports/__tests__/ActivityReportsPageInteractions.spec.tsx

MODIFIED:
- apps/api/prisma/schema.prisma (earlier dispatch)
- apps/api/prisma/migrations/20260822130000_add_activity_goal_report_export_source/migration.sql (earlier dispatch + THIS dispatch: 42P17 fix — single COALESCE index → two partial unique indexes)
- apps/api/src/reports/activity-report-metrics.ts (earlier dispatch)
- apps/api/src/reports/__tests__/activity-report-metrics.spec.ts (earlier dispatch)
- apps/api/src/reports/__tests__/activity-reports.service.spec.ts (earlier dispatch; ONE mock-order fix)
- apps/api/src/activities/activities.graphql.ts (export ActivityTypeEnum)
- apps/api/src/notifications/notification-types.ts (+ACTIVITY_GOAL_AT_RISK)
- apps/api/src/notifications/__tests__/notification-types.spec.ts (7-member list)
- apps/api/src/reports/report-exports.service.ts (sourceType select/view, exportActivityReport, download branch, validateActivityExportAccess)
- apps/api/src/reports/report-export-payload.service.ts (activity execution adapter)
- apps/api/src/reports/report-export-processor.service.ts (source dispatch + processActivityExport + validateActivityExportAccess)
- apps/api/src/reports/report-exports.graphql.ts (sourceType + exportActivityReport mutation + ReportExportSourceType enum)
- apps/api/src/reports/reports.module.ts (new providers + registration)
- apps/api/src/graphql/schema.ts (barrel import)
- apps/api/src/reports/__tests__/report-exports.service.spec.ts (constructor mocks)
- apps/api/src/reports/__tests__/report-export-payload.service.spec.ts (constructor mocks)
- apps/api/test/api/api-test-harness.ts (ActivityGoal in TRUNCATE list)
- apps/web/src/components/layout/AppShellNavigation.tsx (add Activity under Reports)
- apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx
- apps/web/src/components/layout/Breadcrumbs.tsx (add activity segment)
- apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx
- apps/web/src/services/report-export.service.ts (sourceType + exportActivityReport)
- apps/web/src/services/__tests__/report-export.service.spec.ts
- apps/web/src/components/reports/ExportReportMenu.tsx (onExport callback + supportedFormats)
- apps/web/src/components/reports/__tests__/ExportReportMenu.spec.tsx
- apps/web/src/components/reports/ReportExportsPage.tsx (sourceType label)
- apps/web/src/lib/notification-format.ts (ACTIVITY_GOAL_AT_RISK href/label/icon)
- apps/web/src/lib/__tests__/notification-format.spec.ts
- _bmad-output/implementation-artifacts/6-8-activity-reports-team-productivity-metrics.md

PENDING (E2E/docs — Stage 7): Task 7 Playwright + docs/project-context.md.

---

## Review — Stage 8 Code Review (adversarial, 2026-08-22)

**Verdict: FINDINGS** — 0 Critical / 1 Important / 7 Minor (không tính KNOWN-MISSING).

Phạm vi review: toàn bộ diff Story 6.8 trên working tree (HEAD == dev == a9714f6; 25 file modified + 25 file mới, không commit). Ba lớp: Blind Hunter (bảo mật/tenant/permission/audit), Edge Case Hunter (boundary/race/idempotency), Acceptance Auditor (18 AC binding + Contract A–F). Đã đọc: `docs/rules/naming-conventions.md`, `docs/rules/nestjs-rules.md`, `docs/rules/prisma-rules.md`, `docs/rules/typescript-rules.md`, `docs/rules/react-nextjs-rules.md`, `docs/rules/git-workflow.md`, `docs/project-context.md` (mục liên quan), toàn bộ backend mới/modified, migration SQL, frontend service/lib/page/dialog, integration spec `activity-reports.integration.spec.ts` (23 tests) và các unit spec liên quan. Không chạy lại test suites (Dev Record đã ghi nhận green; review này xác minh sự tồn tại và phủ của spec).

### Đã xác minh ĐẠT (không phải findings)

- **Tenant isolation**: mọi aggregate/lookup qua predicate chuẩn `buildFeedWhere`/`buildTaskWhere`/`buildTimeEntryWhere`/`buildDealWhere` (đều chứa `tenantId` + `deletedAt: null` cho soft-delete), team/user lookups đều `tenantId` + `deletedAt: null`; `ActivityGoal` FK Tenant/User CASCADE; TRUNCATE list + partial unique index race-safe (2 index không dùng COALESCE — đúng fix 42P17).
- **Permission gates**: mọi resolver `await requirePermission` đúng resource/action; goal mutations REPORT:CREATE/UPDATE/DELETE; export REPORT:READ+EXPORT+CONTACT/TASK/DEAL:READ; processor + download re-check `validateActivityExportAccess` (owner active + ADMIN bypass + 5 gates).
- **Visibility**: `resolveVisibilityFilter` OWN/TEAM/ALL/ADMIN đúng pattern; drill-down subject-lock + NotFound; team comparison filter theo scope; goal subject `assertSubjectVisible`; byUser/leaderboard chỉ chứa user hợp lệ trong scope (createdBy string không bypass).
- **Audit**: `exportActivityReport` ghi đúng MỘT audit `CREATE/REPORT_EXPORT` (entityId=row.id), không chứa signed URL/data.
- **Export source-aware**: SAVED_REPORT path giữ nguyên (reportId ?? '' chỉ reachable khi row corrupt — DB CHECK); ACTIVITY_REPORT re-check quyền hiện tại + replay immutable snapshot; CSV reject đúng message; không có signed URL trước READY (view không expose objectPath/filters); lease/reserve→probe→processClaimed atomic; migration additive (sourceType default SAVED_REPORT, CHECK constraint, reportId nullable giữ cascade cũ).
- **Metrics**: completion rate due-cohort (không dùng TASK_COMPLETED); tasksCompleted/avgCompletionTime theo completedAt; overdue theo `dueDate < min(end, now)` + status TODO/IN_PROGRESS; timeTrackedSeconds = SUM durationSeconds với `endTime != null`; dealsClosed theo actualCloseDate + active stage isWon, null-date note trong calculationNote.
- **Bounded**: không N+1 (groupBy batch + 1 label lookup; goal progress 1 groupBy/window); MAX_ROWS 20000 throw (không truncate); range ≤ 366 ngày (đúng precedent ProductivityService.MAX_RANGE_DAYS).
- **Processor idempotent**: dedupeKey `activity-goal-at-risk:<goalId>:<periodStart>`; unique `[tenantId, dedupeKey]`; skip not-started/inactive/deleted; elapsedFraction=0 không alert; failure isolation per batch/goal.
- **Frontend**: phân biệt loading (skeleton) vs denied (PermissionLimitedState); query keys chứa đủ filter; không tính metric ở client; heatmap sr-only table + role="img" + tooltip; 320px không overflow page (heatmap tự scroll); live region polite.
- **GraphQL/Pothos**: `nullable: false` trên mọi field contract `!`; enum `ActivityType` reuse 1 lần (export từ activities.graphql.ts); barrel import có; ref/select lockstep; schema spec 6/6.
- **KNOWN-MISSING (không phải code-review finding)**: `tests/e2e/activity-reports.spec.ts` ABSENT (thuộc Stage 9a) và `docs/project-context.md` as-built 6.8 ABSENT (thuộc Stage 9b/10) — đúng như thiết kế pipeline.

### Critical

(không có)

### Important

1. **Team comparison (AC 11) không thể kích hoạt từ UI** — `apps/web/src/components/reports/ActivityReportsPage.tsx:105-115, 191-239` (filter state + `handleApplyFilters`): không có control nào populate `comparisonTeamIds`; section "Team Comparison" (dòng 897-952) chỉ render khi `teamComparisonRows.length > 0`, mà backend chỉ trả rows khi `comparisonTeamIds` được gửi. Kết quả: người dùng thật không bao giờ thấy so sánh team — binding AC 11 chưa đạt trên bề mặt sản phẩm (backend + integration test đã đủ, thiếu UI trigger).
   - Fix: thêm multi-select team comparison (tối đa 4, backend đã validate tenant-local + visibility) vào filter toolbar (mẫu Saved View Toolbar), đưa `comparisonTeamIds` vào `appliedFilters`, query key đã bao gồm filter nên không cần đổi key structure.
   - **Resolution (Stage 8 frontend fix loop):** Đã thêm chip-based multi-select control "Compare Teams (Multi-select, max 4)" vào filter toolbar của `ActivityReportsPage.tsx`, kèm validation client-side tối đa 4 teams (toast warning nếu vượt quá 4), tích hợp `selectedComparisonTeamIds` vào `appliedFilters` (`comparisonTeamIds: selectedComparisonTeamIds.length > 0 ? selectedComparisonTeamIds : null`) và reset handler. Viết test RTL RED→GREEN trong `ActivityReportsPageInteractions.spec.tsx` xác minh việc chọn team toggle, gửi đúng `comparisonTeamIds` vào query `getActivityReport` khi Apply Filters, và reset về `null` khi Reset Filters.

### Minor

2. **Query `totalCount` thừa** — `apps/api/src/reports/activity-reports.service.ts:543-545, 570` (`void totalCount`): count activity gửi kèm nhưng kết quả luôn bằng sum of byUserGroups (createdBy NOT NULL → groupBy không mất row). Gây 1 query vô ích mỗi request.
   - Fix: bỏ `totalCount` khỏi Promise.all (hoặc dùng nó làm totalActivities và bỏ sum).
   - **Resolution (Stage 8 backend fix loop):** Đã xóa query `activity.count({ where: activityWhere })` khỏi Promise.all trong `computeOverview`; `totalActivities` tiếp tục derive từ scoped byUser groupBy sum (cùng where clause — createdBy NOT NULL nên groupBy không mất row). Spec cập nhật: fixture OWN/aggregate chỉ mock meetings count; thêm assertion `activity.count` được gọi ĐÚNG 1 lần (chỉ meetings, where có `type: 'MEETING_SCHEDULED'`) — RED khi còn 2 calls, GREEN sau khi xóa. Full API suite 134 suites / 2839 tests green, thresholds 80/80/80/80 giữ nguyên.
3. **`MAX_TEAM_TASK_IDS = 1000` truncate âm thầm** — `apps/api/src/reports/activity-reports.service.ts:178, 431-441`: deal có >1000 active tasks → task-provenance activity bị cắt mà không có ghi chú; metrics (dealsClosed vẫn đủ nhưng activity scope thiếu). Contract C14 cho phép bounded nhưng không cho silent truncation.
   - Fix: nếu `tasks.length === MAX_TEAM_TASK_IDS` (có thể còn task), thêm ghi chú vào `calculationNote` hoặc nâng bound kèm kiểm tra.
   - **Resolution (Stage 8 backend fix loop):** `resolveDealProvenance` giờ trả `{ provenance, taskTruncated }`; khi `tasks.length === MAX_TEAM_TASK_IDS` (1000), summary `calculationNote` thêm `activity scope truncated at 1000 tasks for deal <id>.` — visible, không silent. Unit tests mới: 1000 tasks → note xuất hiện (RED trước fix: note rỗng), 999 tasks → note KHÔNG xuất hiện (boundary).
4. **Drill-down thiếu error state** — `apps/web/src/components/reports/ActivityReportsPage.tsx:982-1039`: chỉ xử lý `isLoading` và `data`; khi `drillDownQuery.isError` panel render rỗng (chỉ header), không có retry/feedback.
   - Fix: thêm nhánh `drillDownQuery.isError` → `ErrorState` với `onRetry={() => drillDownQuery.refetch()}`.
   - **Resolution (Stage 8 frontend fix loop):** Đã thêm nhánh `drillDownQuery.isError` render `<ErrorState title="Could not load drill-down data" message={...} onRetry={() => drillDownQuery.refetch()} />` vào section Individual Performance Drill-Down của `ActivityReportsPage.tsx`. Viết test RTL RED→GREEN trong `ActivityReportsPage.spec.tsx` xác minh hiển thị ErrorState kèm retry button khi lazy drill-down query thất bại.
5. **`notificationsCreated` đếm thừa khi dedupe** — `apps/api/src/reports/activity-goals-processor.service.ts:270`: `summary.notificationsCreated += 1` bất kể notifySafe có thực sự tạo row hay bị P2002 dedupe (notifySafe nuốt lỗi). Rerun cùng period → summary over-count (chỉ ảnh hưởng log/tests, không ảnh hưởng dữ liệu).
   - Fix: cho `notifySafe`/`create` trả về boolean created (hoặc đếm qua P2002 result) và chỉ increment khi thực sự tạo.
   - **Resolution (Stage 8 backend fix loop):** `NotificationsService.notifySafe` giờ trả `Promise<boolean>` — `true` chỉ khi insert row MỚI; `false` khi P2002 dedupe (existing row returned) hoặc lỗi — qua private `createWithStatus` trả `{ notification, created }` (`create()` public API không đổi). Processor chỉ `notificationsCreated += 1` khi `notifySafe` resolves `true`. Spec: notifications spec assert true/false + case P2002-dedupe; processor spec thêm 2 tests — dedupe (`false` → count 0, RED trước fix vì count = 1) và mixed run (1 của 2).
6. **SDL item nullability lệch contract** — `apps/api/src/reports/activity-reports.graphql.ts:58-59`: `comparisonTeamIds: t.idList()` và `activityTypes: t.field({ type: [ActivityTypeEnum] })` sinh SDL `[ID]`/`[ActivityType]` (item nullable) trong khi Contract C10 quy định `[ID!]`/`[ActivityType!]`. Validator từ chối null item nên không phải lỗ hổng, chỉ lệch khế ước SDL.
   - Fix: dùng `t.field({ type: [ActivityTypeEnum], required: true })` style item non-null (Pothos: `type: [ActivityTypeEnum]` kèm per-item required) hoặc cập nhật contract.
   - **Resolution (Stage 8 backend fix loop):** Xác minh là FALSE POSITIVE — Pothos v4 mặc định input list items là non-null, nên `t.idList()` / `t.field({ type: [ActivityTypeEnum] })` ĐÃ emit `[ID!]`/`[ActivityType!]` (verify bằng `printSchema` trên `schema` thật). Hardening để chống regression: đổi sang dạng explicit `t.idList({ required: { items: true, list: false } })` và `t.field({ type: [ActivityTypeEnum], required: { items: true, list: false } })` — SDL không đổi. Thêm schema test riêng assert cả dạng non-null (positive) lẫn không-có dạng nullable-item (negative).
7. **Touch target 32px < 44px** — `apps/web/src/components/reports/ActivityReportsPage.tsx:620-635`: nút Edit/Delete goal dùng `min-h-[32px] min-w-[32px]`, dưới ngưỡng Contract E29 (touch targets ≥ 44px).
   - Fix: nâng lên `min-h-[44px] min-w-[44px]` (giữ `p-1` để icon không phình).
   - **Resolution (Stage 8 frontend fix loop):** Đã nâng kích thước nút Edit & Delete goal trong `ActivityReportsPage.tsx` lên `min-h-[44px] min-w-[44px]` (giữ `p-1` để icon không phình), tuân thủ Contract E29 về minimum touch targets. Viết test RTL RED→GREEN trong `ActivityReportsPage.spec.tsx` assert `min-h-[44px]` và `min-w-[44px]`.
8. **Clock injectable không nhất quán shape** — `apps/api/src/reports/activity-reports.service.ts:198` và `activity-goals.service.ts:122` dùng `() => Date`, trong khi pattern chuẩn (Contract D20) là `Clock = { now(): Date }` từ `report-schedule-types.ts` (processor dùng đúng `Clock`). Nếu sau này bind provider SYSTEM_CLOCK cho 2 service này sẽ vỡ type/DI.
   - Fix: đổi kiểu clock của 2 service thành `Clock` (`@Optional() private readonly clock: Clock = SYSTEM_CLOCK`, gọi `this.clock.now()`), đồng bộ unit tests.
   - **Resolution (Stage 8 backend fix loop):** Cả `ActivityReportsService` và `ActivityGoalsService` giờ nhận house `Clock = { now(): Date }` từ `report-schedule-types.ts` (`@Optional() private readonly clock: Clock = SYSTEM_CLOCK`, gọi `this.clock.now()` — 2 call site mỗi service), khớp processor + Contract D20; param `@Optional` giữ ở vị trí CUỐI constructor (tránh TS1016). Mọi construction site trong spec đổi sang `{ now: (): Date => ... }` (lint yêu cầu return type tường minh). RED: TS `'now' does not exist in type '() => Date'` + runtime `this.clock is not a function`; GREEN sau fix.

### Ghi chú chung

- Không tìm thấy lỗ hổng Critical: tenant isolation, permission (awaited), visibility scope, audit service-level, claim atomicity, terminal transitions, metric correctness và bounded queries đều đạt so với contract; migration additive đúng house SQL style (2 partial unique index không cast — verified 42P17 rationale).
- E2E spec (`tests/e2e/activity-reports.spec.ts`) và `docs/project-context.md` as-built 6.8 cố tình ABSENT tại Stage 8 — đánh dấu KNOWN-MISSING cho Stage 9a/9b-10, không phải finding.
