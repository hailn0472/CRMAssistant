---
Status: done
Story Key: 6-7-customer-lifetime-value-churn-risk-analysis
Story ID: "6.7"
Epic: "6 — Reporting & Analytics Dashboard"
FR: "FR47 — Users can analyze customer lifetime value and churn risk"
Depends On:
  - "Contact Management / Contact model and visibility rules (shipped)"
  - "Deal Management / Deal + DealStage won/lost semantics (shipped)"
  - "Story 4.1 — Task CRUD and assignment workflow (done)"
  - "Story 4.2 / 5.4 — persisted Contact Activity timeline (done)"
  - "Story 4.8 — task-assignment notifications (done)"
  - "Stories 6.2–6.4 — Reports permission, report module and reusable chart framework (done)"
Baseline Commit: "938c5a01cd64fe98d7f6caa1cad21f64ee2e5241"
Created: "2026-08-19"
Document Language: Vietnamese
---

# Story 6.7: Customer Lifetime Value & Churn Risk Analysis

## Bối cảnh và quyết định phạm vi — ĐỌC TRƯỚC KHI IMPLEMENT

Story này bổ sung một read-model phân tích khách hàng vào module `reports` hiện có. Hệ thống phải tính và lưu CLV/rủi ro churn theo ngày cho từng `Contact`, hiển thị dashboard tenant-safe/visibility-safe tại `/reports/customer-analytics`, lưu snapshot lịch sử, phân tích cohort theo ngày thu nhận contact, và tạo task follow-up có idempotency khi contact chuyển sang mức rủi ro `HIGH`.

Không được xây một Contact/Deal/Task song song, không được tính lại analytics riêng ở frontend, không được bỏ qua `tenantId`, không được dùng Redis/in-memory queue như durable job, không được dùng AI/ML hoặc package mới cho công thức rule-based này, và không được cộng tiền đa tiền tệ rồi gắn nhãn thành một loại tiền duy nhất.

| Câu hỏi | Hiện trạng repository | Quyết định binding cho Story 6.7 |
| --- | --- | --- |
| Contact, customer và account manager là gì? | Sản phẩm là CRM B2C; `Account` bị deferred. `Contact.ownerId` là owner bắt buộc và là cột visibility. | “Customer” trong story là active `Contact`; “account manager” là active owner tại `Contact.ownerId`. Không tạo `Account`, `Customer` hay Lead model mới. |
| Deal nào đóng góp vào LTV/win rate? | `Deal` liên kết trực tiếp `contactId`; trạng thái đóng được xác định bởi `DealStage.isWon/isLost`, không phải `actualCloseDate` hay `winLossReason`. | LTV cộng `Deal.value` của active deal có active stage `isWon=true`. Win rate dùng active closed deals: won / (won + lost). Deal đang mở không vào mẫu số. |
| Làm gì với nhiều currency? | Không có tenant base currency hay FX service. Story 6.2 đã cấm gộp mixed currencies thành một số tiền có nhãn currency. | `Contact.lifetimeValue` vẫn là tổng raw `Deal.value` theo đúng AC binding, nhưng API phải trả breakdown theo ISO currency và cờ `mixedCurrencies`. Khi mixed, UI hiển thị cảnh báo “no FX conversion” và không gắn một currency symbol sai cho total/average/distribution. Không gọi FX API. |
| “Last activity” là gì? | `Activity` là append-only, tenant-scoped và bắt buộc `contactId`; có index `[tenantId, contactId, createdAt DESC]`. | `lastActivityDate` là `MAX(Activity.createdAt)` của contact trên tất cả activity types. Nếu chưa có activity thì field là `null`; riêng công thức inactivity dùng `Contact.createdAt` làm mốc fallback và API đánh dấu dữ liệu chưa có activity. |
| Engagement score lấy từ đâu? | Các touchpoint có thật trong `ActivityType`: `EMAIL_SENT`, `CALL_MADE`, `MEETING_SCHEDULED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`; các type khác chủ yếu là thay đổi nội bộ/hệ thống. | Engagement score là pure, deterministic: số qualifying customer-touch activities trong rolling 90 UTC days × 10, clamp 0..100. Không tính `NOTE_ADDED`, `TASK_COMPLETED`, `DEAL_STAGE_CHANGED`, contact CRUD hay activity ngoài 90 ngày. |
| Daily job có dùng visibility của một user không? | Visibility chỉ áp dụng khi user đọc dữ liệu; background tenant-wide không có caller. `@nestjs/schedule` đã shipped và được đăng ký một lần ở root. | Processor tính cho toàn bộ active contacts của từng tenant, luôn lọc tenant/soft-delete, xử lý theo batch; query sau đó áp dụng `ContactsService.buildContactWhere()` để không lộ contacts. Không scope job theo một user. |
| Task churn được tạo khi nào? | `Task` đã có assignee/contact/due date/priority, audit, pub/sub và `TASK_ASSIGNED` notification. Không có automation idempotency key. | Khi current risk là `HIGH` và snapshot gần nhất trước đó không phải `HIGH` (bao gồm lần tính đầu), tạo đúng một follow-up task gán cho `Contact.ownerId`. Dùng internal `automationKey=CHURN_RISK:<contactId>:<snapshotDate>` để retry/concurrent run không tạo trùng. Không tạo task mới mỗi ngày khi vẫn `HIGH`. |
| Historical LTV và cohort lưu ở đâu? | `Contact` chỉ phù hợp current materialized values; chưa có bảng snapshot analytics. | Thêm daily `CustomerAnalyticsSnapshot` với unique `(tenantId, contactId, snapshotDate)`, score inputs/output và acquisition cohort `YYYY-MM`. Đây là nguồn cho trend/cohort; không suy diễn trend từ current value. |
| GraphQL surface đặt ở đâu? | Reports dùng Pothos thủ công, module registration + side-effect import là load-bearing. Frontend dùng `graphqlRequest`, không Apollo/codegen. | Tạo focused `customer-analytics.*` trong `apps/api/src/reports`, đăng ký từ `ReportsModule.onModuleInit()`, side-effect import trong `graphql/schema.ts`; frontend tạo service riêng và query keys rooted at `['customerAnalytics']`. |
| Có cần thư viện mới/upgrade không? | Shipped: `@nestjs/schedule ^6.1.3`, Prisma `^5.10.0`, Recharts `^3.10.1`; npm tại thời điểm authoring cho thấy schedule/recharts latest trùng bản shipped, Prisma latest major là 7.x nhưng repo đang ở 5.x. | Không thêm dependency và không nâng Prisma. Reuse Nest Schedule, Prisma 5 APIs, `ReportChart`, shadcn/ui và TanStack Query hiện có. Upgrade framework là ngoài phạm vi. |

### Ngoài phạm vi rõ ràng

- Không tạo Account/Company, Customer, Subscription, Invoice, payment hoặc FX-rate model.
- Không dùng AI/ML, Vertex AI, external scoring service, Redis, BullMQ, Kafka hoặc in-memory queue.
- Không thêm UI chỉnh weights/thresholds; các hằng số của AC là closed server constants và được test.
- Không biến CLV thành revenue forecast, ARR/MRR, margin hoặc predictive LTV; binding yêu cầu tổng closed-won deal values.
- Không thay đổi logic Deal Health của Story 3.7; deal health và customer churn là hai score độc lập.
- Không ghi raw analytics score từ client; calculated fields là server-owned/read-only.
- Không tạo task lặp mỗi ngày cho cùng một chu kỳ HIGH; không gửi email riêng ngoài task-assignment notification hiện có.
- Không sửa `/contacts` thành analytics workspace; route bắt buộc là `/reports/customer-analytics`.
- Không export/schedule customer analytics trong story này; Stories 6.5/6.6 chỉ áp dụng unified saved `Report` hiện có.

---

## Story

Là một **sales manager**,
Tôi muốn **phân tích customer lifetime value và churn risk**,
Để **xác định khách hàng có giá trị cao và chủ động ngăn churn**.

---

## Acceptance Criteria

### Acceptance Criteria binding — giữ nguyên từ `epics.md` Story 6.7

18 statement dưới đây là tập acceptance binding đầy đủ. Implementation Contract chỉ làm rõ cách build/test trên codebase hiện tại; không thay thế hoặc nới lỏng bất kỳ statement nào.

1. **Given** Contact Management and Deal Management are implemented from Epics 2 and 3
2. **When** I implement CLV and churn risk analysis
3. **Then** `Contact` model is extended with calculated fields: `lifetimeValue`, `churnRisk`, `lastActivityDate`
4. **And** **Lifetime Value (LTV) calculation:** Sum of all closed won deal values for contact
5. **And** **Churn Risk calculation:** Based on factors: days since last activity (weight: 40%), deal win rate (weight: 30%), engagement score (weight: 30%)
6. **And** Churn risk categories: `LOW` (score < 30), `MEDIUM` (30-70), `HIGH` (> 70)
7. **And** GraphQL query `customerAnalytics(filters)` returns CLV and churn risk data
8. **And** Background job runs daily to recalculate LTV and churn risk for all contacts
9. **And** Frontend `/reports/customer-analytics` page displays customer analytics dashboard
10. **And** Dashboard shows: total LTV, average LTV per customer, LTV distribution chart, churn risk distribution
11. **And** Customer list can be filtered by: LTV range, churn risk level, last activity date
12. **And** Customer list shows: name, LTV, churn risk badge, last activity, recommended action
13. **And** Recommended actions: "Schedule follow-up" (high churn risk), "Upsell opportunity" (high LTV + low churn)
14. **And** Churn prevention workflow: high-risk customers trigger automated task creation for account manager
15. **And** Historical LTV tracking: chart shows LTV trend over time
16. **And** Cohort analysis: group customers by acquisition date and compare LTV
17. **And** Unit tests cover LTV and churn risk calculation logic
18. **And** Integration tests verify analytics data accuracy

---

## Binding Implementation Contract

### A. Prisma schema, migration và current/daily materialization (AC 3–6, 8, 14–16)

1. Mở rộng `Contact` bằng các field server-owned, nullable để migration an toàn với rows hiện có:
   - `lifetimeValue Float?`
   - `churnRisk String?` — chỉ nhận `LOW | MEDIUM | HIGH` qua const tuple/service validation
   - `lastActivityDate DateTime?`
   - `churnRiskScore Float?` — score 0..100 phục vụ sort/explanation; bổ trợ chứ không thay thế `churnRisk`
   - `analyticsCalculatedAt DateTime?` — freshness marker
   Client không được set các field này qua `CreateContactInput`/`UpdateContactInput`.
2. Thêm index phục vụ filters/sort: `[tenantId, churnRisk]`, `[tenantId, lifetimeValue]`, `[tenantId, lastActivityDate]`. Giữ nguyên unique email, owner/team indexes và mọi contact CRUD behavior.
3. Thêm model tenant-scoped `CustomerAnalyticsSnapshot`:

   ```text
   id                      String   @id @default(uuid())
   tenantId                String
   contactId               String
   snapshotDate            DateTime // UTC midnight, one row/contact/day
   acquisitionCohort       String   // YYYY-MM derived from Contact.createdAt
   lifetimeValue           Float
   churnRiskScore          Float
   churnRisk               String
   lastActivityDate        DateTime?
   inactivityRisk          Float
   dealWinRate             Float
   engagementScore         Float
   wonDealCount            Int
   lostDealCount           Int
   qualifyingActivityCount Int
   churnPreventionTaskId   String?
   createdAt               DateTime @default(now())
   updatedAt               DateTime @updatedAt
   createdBy               String   @default("system")
   updatedBy               String   @default("system")
   deletedAt               DateTime?
   ```

   Relations: `Tenant`/`Contact` `onDelete:Cascade`; optional `Task` `onDelete:SetNull`. Thêm inverse relations vào `Tenant`, `Contact`, `Task`. Indexes tối thiểu: unique `[tenantId, contactId, snapshotDate]`, `[tenantId, snapshotDate]`, `[tenantId, acquisitionCohort, snapshotDate]`, `[tenantId, churnRisk, snapshotDate]`, `[tenantId, contactId, snapshotDate(sort: Desc)]`.
4. Mở rộng `Task` bằng nullable internal-only fields `automationSource String?` và `automationKey String?`; thêm `@@unique([tenantId, automationKey])`. NULL không collide; deterministic non-null key cố ý được giữ kể cả task soft-delete để cùng một trigger không tái tạo task. Không expose fields này trong public create/update GraphQL inputs.
5. Viết đúng một hand-written timestamped migration theo house SQL style. Alter-existing-table columns phải nullable; tạo snapshot table/FKs/indexes đúng thứ tự; không rebuild hoặc làm mất Contact/Deal/Task/Report data. Thêm model vào Tenant back-relations và mọi integration cleanup/TRUNCATE list liên quan; chạy Prisma generate/validate và kiểm tra migration SQL.
6. Không backfill score bằng migration SQL. Sau deploy, rows chưa được processor tính có calculated fields `null`; query/UI hiển thị trạng thái “Not calculated yet” thay vì giả `LOW`/0. Daily processor là nguồn materialization đầu tiên.

### B. Công thức CLV/churn deterministic (AC 4–6, 13, 17)

7. Tạo pure module `customer-analytics-score.ts`, không import Nest/Prisma, chứa closed const tuples và constants:
   - `CUSTOMER_CHURN_RISKS = ['LOW','MEDIUM','HIGH']`
   - weights: inactivity `0.40`, win-rate risk `0.30`, engagement risk `0.30`
   - engagement window `90` UTC days; `10` points mỗi qualifying activity; clamp 0..100
   - inactivity horizon `90` UTC days; `inactivityRisk = clamp(daysSinceReference / 90 * 100, 0, 100)`
8. `lastActivityDate = MAX(Activity.createdAt)` cho contact. `daysSinceReference` dùng `lastActivityDate`; nếu null dùng `Contact.createdAt`. Chuẩn hóa cả hai về UTC midnight và clamp future/bad clock-skew thành 0 ngày, không tạo negative risk.
9. `lifetimeValue = round2(sum(active Deal.value where active DealStage.isWon=true))`. Zero won deals → 0. Dùng stage flags là authority; `actualCloseDate`, `probability`, `winLossReason` không thay đổi eligibility. Không tính soft-deleted deal hoặc deal trên soft-deleted stage.
10. `dealWinRate = won / (won + lost) * 100`. Nếu chưa có closed deal, dùng neutral `50` để tránh chia 0 và tránh tự động gắn rủi ro tối đa chỉ vì thiếu lịch sử. `winRateRisk = 100 - dealWinRate`.
11. Qualifying engagement activity types chỉ gồm `EMAIL_SENT`, `CALL_MADE`, `MEETING_SCHEDULED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT` trong `[snapshotDate-90d, end-of-snapshot-day]`. `engagementScore = clamp(count * 10, 0, 100)`; `engagementRisk = 100 - engagementScore`.
12. `churnRiskScore = round1(0.40*inactivityRisk + 0.30*winRateRisk + 0.30*engagementRisk)`, clamp 0..100. Category mapping giữ đúng biên của epic:
   - `LOW`: score `< 30`
   - `MEDIUM`: score `>= 30 && <= 70`
   - `HIGH`: score `> 70`
   Vì vậy chính xác 30 và 70 đều là `MEDIUM`.
13. Recommended action là output server-derived, không persist free text:
   - `HIGH` → `SCHEDULE_FOLLOW_UP` / label chính xác `Schedule follow-up`.
   - Else nếu `LOW` và contact thuộc high-LTV group → `UPSELL_OPPORTUNITY` / label chính xác `Upsell opportunity`.
   - Else → `MONITOR` / label `Monitor`.
14. High-LTV group được xác định ổn định từ current tenant snapshot: `lifetimeValue > 0` và `>=` percentile 75 của active contacts có positive LTV. Nếu tenant chưa có positive LTV thì không contact nào được gắn upsell. Filter hiện tại của UI không được làm thay đổi threshold/recommended action.
15. Money safety: pure math reject/normalize non-finite values; round money theo repository rule ở mỗi materialized write. Top-level analytics trả `currencyBreakdown` từ won deals. Nếu hơn một currency, `mixedCurrencies=true`, money charts/metrics dùng neutral number formatting + ISO breakdown/warning, không hiển thị một symbol duy nhất và không FX conversion.

### C. Daily processor, batching, idempotency và automated task (AC 8, 14–16)

16. Tạo `CustomerAnalyticsProcessor` provider trong `ReportsModule`, dùng shipped `@nestjs/schedule`, cron 6-field chạy một lần/ngày tại `02:00 UTC` (`0 0 2 * * *`). Clock, batch size và concurrency phải injectable/override được trong unit tests.
17. Processor đọc tenant IDs theo batch, rồi active contacts theo stable `(createdAt,id)` order/batches (mặc định 500; bounded concurrency). Không load 1M contacts/10M activities vào memory, không gọi ContactsService list bị clamp 100, không có unbounded `findMany`.
18. Cho mỗi contact batch, dùng tenant-filtered aggregate queries thay vì N+1:
   - latest Activity grouped by `contactId`;
   - qualifying 90-day Activity count grouped by `contactId`;
   - won and lost Deal aggregates grouped by `contactId` (won additionally sum `value`; currency breakdown grouped separately khi cần).
   Mọi query chứa `tenantId`, parent IDs của batch và active/deleted constraints phù hợp.
19. Mỗi contact/day được materialize idempotently trong short transaction: update current Contact calculated fields + upsert unique daily snapshot. Không giữ DB transaction xuyên toàn tenant hoặc qua notification/pub-sub side effects.
20. Daily rerun/concurrent instances phải tạo cùng current values/snapshot và không tạo duplicate task. Xử lý unique/P2034 bằng bounded retry; không swallow partial failure thành success. Failure một batch được log bằng Nest `Logger` với tenant/batch identifiers nhưng không PII/raw score rows, rồi tiếp tục batch khác; summary trả tenants/contacts succeeded/failed/tasksCreated để test/ops quan sát.
21. Churn prevention transition:
   - tìm snapshot active gần nhất trước `snapshotDate`;
   - nếu current `HIGH` và previous không `HIGH`, gọi internal TasksService automation path;
   - task: title `Follow up with <contact name> — high churn risk`, `priority=HIGH`, `status=TODO`, `assignedTo=Contact.ownerId`, `contactId`, `dealId=null`, `dueDate=snapshotDate+1 UTC day`, description nêu score/last activity và link intent tới contact nhưng không chứa bí mật;
   - `automationSource='CHURN_RISK'`, `automationKey='CHURN_RISK:<contactId>:<YYYY-MM-DD>'`;
   - lưu returned task ID vào `CustomerAnalyticsSnapshot.churnPreventionTaskId`.
22. Internal TasksService path phải reuse task validation/select/audit/pub-sub và existing `TASK_ASSIGNED` notification semantics, nhưng không mở `automationKey` cho client. P2002 trên automation key trả existing same-tenant task như idempotent success; không trả task cross-tenant.
23. Nếu previous đã `HIGH`, không tạo task mới dù task cũ completed/deleted; một transition mới chỉ xảy ra sau ít nhất một snapshot `LOW`/`MEDIUM`. Nếu contact owner không còn active tại processing time, snapshot/current score vẫn được lưu nhưng task creation được ghi failure an toàn để retry ở lần run sau, không assign sang user khác.
24. Snapshot trend giữ one row/contact/UTC day. `customerAnalytics` trả LTV trend cho 90 ngày gần nhất từ snapshots, mỗi point gồm `snapshotDate`, total LTV, average LTV, customer count; không cộng nhiều snapshot của cùng contact trong cùng ngày.
25. Cohort dùng `acquisitionCohort=YYYY-MM` từ `Contact.createdAt`, group trên current/latest visible snapshot để trả customer count, total LTV, average LTV. Sort tăng dần theo cohort; không group theo `company` và không tạo Account.

### D. Typed GraphQL API, permission và visibility (AC 7, 10–13, 15–16)

26. Tạo `customer-analytics.service.ts` + `customer-analytics.graphql.ts`; register `registerCustomerAnalyticsGraphql(service)` từ `ReportsModule.onModuleInit()` và side-effect import file trong `apps/api/src/graphql/schema.ts`. `ReportsModule` phải nằm trước `AppGraphqlModule`; không thêm Apollo/codegen/Prisma Pothos plugin.
27. Expose đúng query binding:

   ```graphql
   customerAnalytics(
     filters: CustomerAnalyticsFilterInput
     pagination: CustomerAnalyticsPaginationInput
   ): CustomerAnalytics!
   ```

   Input typed/closed:
   - `minLifetimeValue`, `maxLifetimeValue` (finite, min <= max)
   - `churnRisks: [CustomerChurnRisk!]`
   - `lastActivityFrom`, `lastActivityTo` (valid ISO, from <= to; null activity không match date filter)
   - optional `search`, `ownerId`
   - `page` default 1; `pageSize` default 20, max 100
   Unknown/raw JSON/Prisma where/sort strings không được expose.
28. Query yêu cầu JWT + `REPORT:READ` + `CONTACT:READ` + `DEAL:READ`. Đây là analytics kết hợp contact/deal; ADMIN bypass giữ nguyên guard hiện có, nhưng integration tests phải dùng non-ADMIN để chứng minh gates thật sự.
29. Tất cả current list/summary/distribution/trend/cohort/currency aggregates derive từ một base contact predicate do `ContactsService.buildContactWhere(tenantId,userId,{search,ownerId})` tạo, sau đó AND thêm analytics filters. Không copy own/team/all/sharing logic và không mở rộng scope vì report access.
30. Cross-tenant/soft-deleted/not-visible contacts không xuất hiện trong list, counts, trends, cohorts hoặc currency breakdown. Snapshot là child không có ownerId; visibility luôn derive qua active parent Contact, không gọi `resolveVisibilityFilter` trực tiếp trên snapshot.
31. Return type typed tối thiểu:
   - `summary`: `totalLifetimeValue`, `averageLifetimeValue`, `customerCount`, `calculatedCustomerCount`, `highLtvThreshold`, `latestCalculatedAt`, `mixedCurrencies`, `currencyBreakdown[]`;
   - `ltvDistribution[]`: numeric min/max, count và label; server tạo tối đa 5 equal-width bins từ visible filtered min/max, không fetch toàn bộ rows;
   - `churnRiskDistribution[]`: `LOW|MEDIUM|HIGH|NOT_CALCULATED`, count, percentage;
   - `customers`: paginated items gồm contact ID/name/owner, `lifetimeValue`, `churnRiskScore`, `churnRisk`, `lastActivityDate`, `analyticsCalculatedAt`, recommended-action code/label, `isHighLifetimeValue`;
   - `ltvTrend[]`, `cohorts[]` theo contract C24–C25.
32. Summary/distributions phải database-aggregate/bounded-query, không fetch toàn visible contact set vào Node. Customer list stable sort: risk score desc (null last), lifetimeValue desc, contact ID asc; pagination không duplicate/skip khi values bằng nhau.
33. `Contact` Pothos ref có thể expose read-only calculated fields nếu UI contact khác cần dùng, nhưng nếu expose thì bắt buộc cập nhật `contactListSelect`/all return shapes cùng lúc. Không thêm calculated fields vào create/update inputs. Analytics query không được dựa vào frontend Contact fragment để tránh làm nặng mọi contact list request.
34. Pothos refs phải typed từ service return shapes và service `select` phải chứa mọi field ref expose. Dates serialize ISO strings; null calculated fields giữ nullable. Schema test phải assert query/enum/input/fields thật sự tồn tại sau `builder.toSchema()`.

### E. Frontend customer analytics dashboard (AC 9–13, 15–16)

35. Tạo thin route `apps/web/src/app/(dashboard)/reports/customer-analytics/page.tsx` chỉ render `CustomerAnalyticsPage`. Logic ở `components/reports/CustomerAnalyticsPage.tsx`; service ở `services/customer-analytics.service.ts`; pure transformations/formatting ở `lib/customer-analytics.ts` khi cần.
36. Frontend service dùng `graphqlRequest` với hand-written exact fragments/types và query keys rooted at `['customerAnalytics']` bao gồm mọi filter/page. Không Apollo/codegen, không copy server formula, không tính score/CLV/recommended action ở client.
37. Thêm nav item `Customer Analytics` dưới Reports, permission `REPORT:READ`; thêm breadcrumb segment `customer-analytics: Customer Analytics`. Route/UI cũng xử lý permission-denied, không chỉ ẩn nav.
38. Dashboard hiển thị đủ binding:
   - metric cards: Total LTV, Average LTV per customer, analyzed/total customer count;
   - LTV distribution chart;
   - churn risk distribution chart;
   - historical LTV trend chart;
   - acquisition cohort comparison chart/table;
   - customer list.
39. Reuse shipped `ReportChart`/Recharts framework và approved chart theme; không cài chart library khác. Charts phải có tooltip/legend khi phù hợp, responsive container, text+pattern/label (không color-only), `role="img"`/aria label và semantic sr-only/table equivalent. LTV distribution dùng bar, churn distribution donut/bar, trend line/area, cohort bar/table.
40. Filter toolbar gồm min/max LTV, multi-select risk level, last activity from/to, search và owner (nếu pattern hiện có hỗ trợ). Apply/reset rõ ràng; active filters luôn nhìn thấy; thay filter reset page về 1; invalid range bị chặn/hiển thị inline, không gửi query.
41. Customer list hiển thị chính xác name, LTV, churn risk badge, last activity và recommended action. Badge luôn có text `Low/Medium/High/Not calculated`; HIGH không chỉ màu đỏ. Action label exact: `Schedule follow-up`, `Upsell opportunity`; `Monitor` cho trường hợp còn lại. Link name/action tới `/contacts/<id>`; action không tự mutate dữ liệu vì background workflow đã tạo task.
42. Mixed-currency state hiển thị persistent actionable warning và per-currency breakdown; total/average/distribution không gắn một currency symbol duy nhất. Single currency dùng formatter hiện có. Null analytics hiển thị em dash/`Not calculated yet`, không biến thành 0/LOW.
43. Reuse `LoadingSkeleton`/`TableSkeleton`, `ErrorState`, `EmptyState`, `ResponsiveTableWrapper`, shadcn Cards/Badge/Inputs/Buttons và `react-hot-toast`/inline feedback theo repository. Không dựng duplicate loading/error/table primitives.
44. Responsive/accessibility: hoạt động tại 320px không horizontal page overflow; table chuyển wrapper/card pattern; touch targets >=44px; keyboard access đầy đủ; focus visible; chart/list feedback qua polite live region; color contrast WCAG 2.1 AA.
45. Giữ nguyên `/reports/sales`, builder, schedules, exports, win/loss, productivity, report query caches và chart export controls. Customer analytics query invalidation không được làm mất sales/custom report state.

### F. Tests, integration evidence và quality gates (AC 17–18 và toàn bộ security contract)

46. Pure unit tests bao phủ:
   - LTV: zero/won/lost/open/mixed currency/soft-delete input normalization/rounding;
   - inactivity exact day boundaries, no-activity fallback, future timestamps, 90-day clamp;
   - win rate 0/50/100, no-closed neutral 50;
   - engagement qualifying/non-qualifying types, 90-day boundary, clamp;
   - weighted score arithmetic và exact category boundaries 29.9/30/70/70.1;
   - recommended action precedence và tenant-level percentile threshold.
47. Processor service tests bao phủ batching/no-N+1 aggregate shape, tenant filters, UTC snapshot date, current Contact + snapshot write, same-day idempotency, concurrent/P2002/P2034 handling, HIGH transition task, sustained-HIGH no duplicate, HIGH→MEDIUM→HIGH new task, inactive owner failure isolation và per-batch continuation.
48. API service/GraphQL tests bao phủ validation, exact typed contract, summary/distributions/pagination/stable sort, null analytics, mixed currencies, 90-day trend, cohort grouping, schema registration và no ref/select drift.
49. Testcontainers GraphQL integration test dùng real PostgreSQL và non-ADMIN roles để chứng minh:
   - exact CLV/score/category từ seeded Contacts/Deals/DealStages/Activities;
   - `customerAnalytics(filters)` LTV/risk/last-activity filters;
   - own/team/all + sharing visibility và cross-tenant/soft-delete negatives trên list, summary, trend, cohort;
   - missing REPORT/CONTACT/DEAL permission denial;
   - processor rerun tạo một snapshot/day và một task đúng owner; sustained HIGH không duplicate;
   - mixed-currency warning/breakdown và không nhãn currency sai.
50. Frontend service/Jest/RTL tests bao phủ exact operation/variables/unwrap, query key isolation, cards, all four analytics charts/semantic tables, filters/reset/pagination, badges/action labels, not-calculated/mixed-currency/loading/error/empty/permission states, keyboard và 320px layout.
51. Playwright critical flow: mở `/reports/customer-analytics`, apply LTV/risk/date filters, verify metrics/charts/list, mở high-risk contact/task intent và kiểm tra mobile layout. Mock GraphQL có deterministic fixture; công thức và daily DB task workflow vẫn thuộc API integration tests.
52. Quality gates trước khi claim completion: focused tests; API unit + integration serially; web Jest/RTL; Playwright; Prisma validate/generate/migration inspection; root/API/Web type-check; lint; Prettier check; builds. Không lower coverage threshold, không skip tenant/permission/task-idempotency assertions, không yêu cầu production secrets.
53. Cập nhật `docs/project-context.md` với as-built Story 6.7: công thức/thresholds, snapshot/current fields, daily schedule, mixed-currency rule, task idempotency, GraphQL/route map và tests. Chỉ ghi deferred work thật sự còn lại; không tuyên bố predictive/FX support đã ship.
54. Completion chỉ được claim khi đủ evidence cho cả 18 binding AC: current fields đã materialize; daily run đúng; query accuracy/tenant visibility đúng; dashboard đủ summary/list/distribution/trend/cohort; task HIGH transition idempotent; Story 4.1/4.2/4.8/6.2–6.6 regression suites vẫn green.

---

## Tasks / Subtasks

- [x] **Task 1 — Prisma calculated fields, daily snapshot và task automation identity** (Binding AC: 3, 8, 14–16; Contract: A1–A6)
  - [x] Add nullable Contact analytics fields/indexes, `CustomerAnalyticsSnapshot`, inverse relations và internal-only Task automation fields.
  - [x] Hand-write one additive migration, inspect FK/index/order, generate/validate Prisma Client và update all relevant test cleanup lists.
- [x] **Task 2 — Pure CLV/churn formula contract** (Binding AC: 4–6, 13, 17; Contract: B7–B15)
  - [x] Implement closed constants, UTC day math, LTV/win/engagement/inactivity/weighted risk calculations and exact category boundaries.
  - [x] Implement high-LTV percentile/recommended-action and mixed-currency-safe outputs with exhaustive pure unit tests.
- [x] **Task 3 — Daily bounded analytics processor** (Binding AC: 8, 15–16; Contract: C16–C20, C24–C25)
  - [x] Implement daily 02:00 UTC tenant/contact batching and aggregate queries with no N+1/unbounded reads.
  - [x] Atomically materialize current Contact values + one snapshot/contact/day, with retry/failure summary and deterministic clock tests.
- [x] **Task 4 — Idempotent churn-prevention task workflow** (Binding AC: 14; Contract: C21–C23)
  - [x] Add internal TasksService automation path that reuses validation/audit/pub-sub/notification behavior without exposing automation keys to clients.
  - [x] Implement HIGH-transition detection, deterministic automation key, exact owner/contact/due/priority fields, same-day/concurrent/sustained-HIGH idempotency tests.
- [x] **Task 5 — Visibility-safe typed customerAnalytics GraphQL API** (Binding AC: 7, 10–13, 15–16; Contract: D26–D34)
  - [x] Implement typed filters/pagination/result, permission gates and shared Contacts visibility predicate for every result section.
  - [x] Implement bounded summary/distributions/customer list/trend/cohort/currency breakdown and register Pothos schema in module + barrel.
- [x] **Task 6 — Customer analytics frontend service and dashboard** (Binding AC: 9–13, 15–16; Contract: E35–E45)
  - [x] Add hand-written GraphQL service/query keys, thin route, nav/breadcrumb and `CustomerAnalyticsPage` loading/error/empty/permission states.
  - [x] Render metric cards, distributions, trend, cohort and responsive filtered customer list by reusing ReportChart/shared UI.
  - [x] Implement exact risk badges/actions, not-calculated and mixed-currency UX plus keyboard/mobile accessibility.
- [x] **Task 7 — Integration, E2E, docs và regression gates** (Binding AC: 1–2, 17–18; Contract: F46–F54)
  - [x] Add formula/processor/API Testcontainers/GraphQL and frontend service/RTL evidence including cross-tenant/non-ADMIN negatives.
  - [x] Add deterministic Playwright analytics flow (Stage 9a complete); update project context; run Prisma, test, type-check, lint, format and build gates without threshold reductions.

> Split Stage 5 note: backend portion of Task 7 (formula/processor/API Testcontainers/GraphQL evidence + Prisma/test/type-check/lint/format gates) is COMPLETE — see Dev Agent Record. Frontend service/RTL, Playwright, and `docs/project-context.md` as-built update remain for the frontend worker (Task 6 + Task 7 frontend/doc subtasks).

---

## Dev Notes

### Cross-story dependency map

| Story/area | Đã ship | Story 6.7 phải reuse/preserve |
| --- | --- | --- |
| Contacts / Stories 2.4, 5.4 | `Contact.ownerId`, own/team/all + sharing predicate, activity timeline | Dùng `ContactsService.buildContactWhere`; không copy visibility; calculated fields read-only. |
| Deals / Story 3.1 | `Deal.contactId`, `DealStage.isWon/isLost`, currency/value | Stage flags là closed outcome authority; không dùng Account; mọi aggregate tenant-scoped. |
| Story 3.7 | Pure deal-health score và daily-ish reminder patterns | Reuse UTC-day style/lessons only; không reuse hoặc đổi deal-health formula/status. |
| Stories 4.1/4.8 | Task CRUD/audit/pub-sub/calendar hooks và persisted task notification | Extend internal automation path; không direct-insert một task “nửa chức năng” bỏ qua side effects. |
| Stories 4.2/5.4 | Append-only `Activity` và qualifying customer touchpoint types | Dùng Activity aggregate/index; không mutate timeline để “cache” score. |
| Stories 6.2–6.4 | REPORT permission, Reports module, ReportChart/Recharts framework | Reuse permission/module/schema/chart conventions; không thêm report model hoặc chart lib. |
| Stories 6.5/6.6 | Nest Schedule root registration, durable/bounded processor lessons | Reuse injected clock/batching/Logger patterns; daily analytics không phải export/schedule job queue. |

### Current state đã verify — extend, không replace

- `Contact` hiện chưa có `lifetimeValue`, `churnRisk`, `lastActivityDate`; contact list select/ref là hand-written và phải sync nếu expose fields.
- `Activity` bắt buộc `tenantId/contactId`, append-only, có index `[tenantId, contactId, createdAt DESC]`; metadata không exposed.
- `Deal` liên kết trực tiếp Contact; won/lost nằm ở `DealStage`; `actualCloseDate` có thể null hoặc tồn tại sau reopen nên không phải status authority.
- `Task` có assignedTo/contactId/dealId/priority/due date, audit, calendar, activity/pub-sub/notification hooks; chưa có automation key.
- `ReportsModule` đã import Contacts/Deals/Tasks/Activities/Permissions và đã có `@nestjs/schedule`; thêm analytics providers không cần module mới hoặc dependency mới.
- GraphQL schema chỉ có field từ explicit side-effect imports; thiếu `customer-analytics.graphql` trong barrel sẽ drop query im lặng.
- Frontend có `ReportChart`, shared loading/error/empty/table primitives, hand-written GraphQL services và report nav; không có Apollo/codegen.
- RLS không ship. Mọi current/snapshot/deal/activity/task query thiếu `tenantId` là security defect trực tiếp.
- `SalesReportsService` đã có mixed-currency precedent: money values không được gắn một currency sai khi chưa filter/convert. Story 6.7 phải giữ nguyên nguyên tắc no-FX.

### Existing files dự kiến UPDATE — phải đọc lại trước khi sửa

| Existing file | Current behavior | Story 6.7 change | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/api/prisma/schema.prisma` | Contact/Activity/Deal/Task/Report schema | Add current analytics fields, snapshot model, task automation identity, relations/indexes | Existing data/FKs/soft delete and Story 6.5/6.6 models |
| `apps/api/src/contacts/contacts.service.ts` | Canonical Contact select + visibility predicate | Optionally include read-only calculated fields in select; never accept writes | CRUD, owner/team/sharing, pagination |
| `apps/api/src/contacts/contacts.graphql.ts` | Hand-written Contact ref/inputs | Optional nullable calculated read fields only | No analytics fields in create/update input; ref/select sync |
| `apps/api/src/tasks/tasks.service.ts` | Validated task creation + side effects | Add internal idempotent automation create path | Public input/visibility, audit, calendar, notifications, pub/sub |
| `apps/api/src/tasks/tasks.module.ts` | Exports TasksService | Keep/export service used by ReportsModule | Acyclic module direction |
| `apps/api/src/reports/reports.module.ts` | Registers report/schedule/export services | Provide/register analytics service/processor | Registration order; existing reports |
| `apps/api/src/graphql/schema.ts` | Explicit Pothos side-effect import list | Add customer analytics GraphQL import | No silent field disappearance |
| `apps/api/test/api/api-test-harness.ts` and integration TRUNCATE lists | DB cleanup | Add snapshot table before parents | Existing test isolation |
| `apps/web/src/components/layout/AppShellNavigation.tsx` | Permission-gated report routes | Add Customer Analytics route | Existing active-route specificity and nav tests |
| `apps/web/src/components/layout/Breadcrumbs.tsx` | Explicit route labels | Add `customer-analytics` label | Existing labels |
| `docs/project-context.md` | As-built code authority | Document shipped Story 6.7 reality after implementation | Code-wins accuracy |

### Planned implementation surface

**NEW — Backend**

- `apps/api/prisma/migrations/<timestamp>_add_customer_analytics/migration.sql`
- `apps/api/src/reports/customer-analytics-score.ts`
- `apps/api/src/reports/customer-analytics.service.ts`
- `apps/api/src/reports/customer-analytics-processor.service.ts`
- `apps/api/src/reports/customer-analytics.graphql.ts`
- mirrored unit specs under `apps/api/src/reports/__tests__/`
- `apps/api/test/integration/customer-analytics.integration.spec.ts`

**NEW — Frontend / E2E**

- `apps/web/src/services/customer-analytics.service.ts` + mirrored spec
- `apps/web/src/lib/customer-analytics.ts` + mirrored spec if transformations are extracted
- `apps/web/src/components/reports/CustomerAnalyticsPage.tsx` + mirrored RTL spec
- `apps/web/src/app/(dashboard)/reports/customer-analytics/page.tsx` + thin-page spec
- `tests/e2e/customer-analytics.spec.ts`

Test/helper filenames có thể tinh chỉnh, nhưng current Contact fields, daily snapshot, pure score, processor, idempotent task, typed query, required route/dashboard/trend/cohort và security tests là bắt buộc.

### Security, reliability và performance invariants

1. Every DB access includes `tenantId`; RLS không tồn tại làm backstop.
2. Query permission = REPORT:READ + CONTACT:READ + DEAL:READ; parent Contact visibility áp dụng cho mọi analytics section.
3. Background calculation tenant-wide không dùng một user visibility filter; exposure vẫn user-scoped ở query.
4. Calculated fields, score inputs, automation source/key không client-writable.
5. No N+1: aggregate by contact batch; list paginated max 100; dashboard aggregates in DB/bounded queries.
6. One active snapshot/contact/day; one task per HIGH transition event; retry/concurrency không duplicate.
7. Mixed currencies không được hiển thị như cùng một currency và không FX conversion.
8. Processor failures không tạo fabricated LOW/0 hoặc completion false; null/stale states visible.
9. Task automation phải preserve audit/pub-sub/notification semantics; không bypass public Task invariants bằng raw writes không kiểm soát.
10. Pothos ref/service select, module registration, barrel import và frontend fragments phải lockstep.

### Các lỗi implementation phổ biến phải tránh

- Không dùng `actualCloseDate != null` làm won; phải dùng active `DealStage.isWon`.
- Không tính win rate trên open deals và không chia 0; no-closed = neutral 50 theo contract.
- Không dùng `Contact.updatedAt` làm last customer activity; contact edits không phải engagement.
- Không tính internal activities (`TASK_COMPLETED`, CRUD, stage change) là engagement touchpoint.
- Không để score 70 thành HIGH; epic nói HIGH chỉ `>70`.
- Không load toàn bộ contacts/activities/deals rồi reduce trong Node.
- Không copy visibility logic hoặc áp visibility lên snapshot child không có ownerId.
- Không tạo task HIGH mỗi ngày hoặc mỗi processor retry.
- Không expose automationKey/calculated fields trong contact/task mutation inputs.
- Không cộng mixed currencies rồi format bằng most-frequent currency.
- Không tạo chart components riêng khi `ReportChart` đã ship.
- Không quên schema barrel/module registration/nav breadcrumb/test cleanup.
- Không nâng Prisma lên major 7 hoặc thêm Redis/AI/chart dependency trong story này.

### Git/dependency intelligence

- Baseline branch `dev`, commit `938c5a0` (`Merge pull request #65 ... report-export-multiple-formats`); working tree sạch tại lúc authoring.
- Recent Story 6.6 commit `a64c016` xác lập report module/schema registration, Recharts/report chart reuse, bounded jobs và mixed-currency safety patterns.
- Installed direct versions: API `@nestjs/schedule ^6.1.3`, Prisma/client `^5.10.0`; Web Recharts `^3.10.1`, Next `14.2.35`, TanStack Query `^5.100.9`. Npm check tại 2026-08-19: schedule `6.1.3`, Recharts `3.10.1`; Prisma latest `7.9.1` không phù hợp pin major hiện tại và không được nâng trong story.
- Không có dependency mới; không cần sửa package manifests/lockfile trừ khi implementation chứng minh một yêu cầu binding không thể đáp ứng bằng stack shipped (không dự kiến).

---

## Traceability Notes

| Binding AC | Nguồn | Evidence target |
| --- | --- | --- |
| AC 1–2 | Story 6.7 context | Preserve shipped Contact/Deal integrations and regressions |
| AC 3 | Exact epic model fields | Prisma schema/migration + read-only typed fields + current materialization |
| AC 4 | Exact LTV statement | Stage-isWon aggregate unit + real PostgreSQL exact-value integration |
| AC 5–6 | Exact factors/weights/categories | Pure score constants/math and boundary tests |
| AC 7 | Exact query name | Registered typed `customerAnalytics(filters)` SDL + GraphQL integration |
| AC 8 | Exact daily job | 02:00 UTC cron + direct processor integration/idempotency evidence |
| AC 9–10 | Exact route/dashboard metrics | Thin route + cards + both distributions RTL/Playwright |
| AC 11–13 | Filters/list/actions | Service variables, backend predicates, table/badge/action RTL |
| AC 14 | Automated task | HIGH transition, owner assignment, deterministic key, no duplicates |
| AC 15 | Historical tracking | Daily snapshot + 90-day LTV trend chart/data tests |
| AC 16 | Cohort analysis | Acquisition YYYY-MM current cohort aggregation + chart/table tests |
| AC 17–18 | Unit/integration requirements | Pure score suites + Testcontainers GraphQL/processor accuracy |

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1683-1708`] — Story 6.7 statement và toàn bộ 18 binding AC.
- [Source: `_bmad-output/planning-artifacts/epics.md:1520-1735`] — Epic 6 cross-story reporting context.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR40–FR47, đặc biệt FR47.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1169`] — performance, security, tenant isolation, integrity, accessibility, maintainability NFRs.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-242`] — stack, tenant/RBAC/type-safety/testing constraints.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-700`] — project structure, Reports mapping và API/data boundaries.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-960`] — implementation rules, B2C/Account-deferred, task/notification transport decisions.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1548-1641`] — risk/health indicator, report toolbar, accessibility/reuse strategy.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1692-1774`] — buttons, warnings, feedback, ARIA-live requirements.
- [Source: `docs/project-context.md:39-105`] — shipped stack, Pothos/Prisma/Schedule và application-only tenant isolation.
- [Source: `docs/project-context.md:143-176`] — tests, coverage, audit/registration rules.
- [Source: `docs/project-context.md:181-224`] — permission/version/dependency reality.
- [Source: `docs/project-context.md:323-385`] — house Prisma/domain/module/frontend conventions.
- [Source: `docs/project-context.md:811-829`] — migration rules và as-built report/export map.
- [Source: `docs/rules/typescript-rules.md`] — strict TS, pure typed logic và error handling.
- [Source: `docs/rules/react-nextjs-rules.md`] — TanStack/UI state, accessibility, responsive/forms.
- [Source: `docs/rules/prisma-rules.md`] — tenant filters, indexes, batch/transaction/migration patterns.
- [Source: `docs/rules/nestjs-rules.md`] — service/DI/exception/testing conventions.
- [Source: `apps/api/prisma/schema.prisma:105-157,369-459,626-696,1132-1188,1360-1496`] — current Tenant/Contact/Activity/Deal/Task/Notification/Report models.
- [Source: `apps/api/src/contacts/contacts.service.ts:83-115,444-558`] — canonical Contact select và shared visibility predicate.
- [Source: `apps/api/src/contacts/contacts.graphql.ts:10-158`] — current hand-written Contact ref/select lockstep surface.
- [Source: `apps/api/src/activities/activities.service.ts:12-28,72-114,170-256`] — current Activity types/log/select semantics.
- [Source: `apps/api/src/deal-health/deal-health-score.ts`] — pure UTC-day scoring precedent; không phải churn formula.
- [Source: `apps/api/src/deal-health/deal-health.service.ts:122-193,311-495`] — batched last-activity/daily sweep/idempotency lessons.
- [Source: `apps/api/src/tasks/tasks.service.ts:24-151,260-422`] — task create/select/audit/notification/pub-sub path phải reuse.
- [Source: `apps/api/src/reports/sales-reports.service.ts:365-395,975-994`] — mixed-currency/no-FX và bounded aggregate precedent.
- [Source: `apps/api/src/reports/reports.module.ts`] — current reports DI/registration map.
- [Source: `apps/api/src/graphql/schema.ts`] — explicit schema side-effect imports.
- [Source: `apps/web/src/components/reports/charting/ReportChart.tsx`] — reusable shipped Recharts framework.
- [Source: `apps/web/src/components/layout/AppShellNavigation.tsx:53-132`] — current report nav/permission map.
- [Source: `apps/web/src/components/layout/Breadcrumbs.tsx:17-60`] — required route segment labels.
- [Source: `_bmad-output/implementation-artifacts/6-6-report-export-in-multiple-formats-pdf-excel-csv.md`] — previous-story report security/bounds/registration/testing intelligence.

---

## Story Completion Status

- Status hiện tại: `done` — Stage 5A (backend) + Stage 5B (frontend) hoàn tất Tasks 1–7; Stage 8 review Round 3 CLEAN; Stage 9a Playwright 6/6; Stage 9b dogfood D1–D9 PASS; Stage 10 (AUTO-APPROVE) hoàn tất commit/push/PR, PR mở tới `dev` chờ user review/merge.
- Đã preserve nguyên văn đầy đủ 18 binding acceptance statements từ Epic Story 6.7.
- Technical arbitration đã resolve theo code hiện tại: Contact/Deal/Activity/Task semantics, exact score, currency safety, snapshots, batching, visibility, task idempotency, GraphQL registration, frontend reuse và tests.
- Ultimate context engine analysis completed - comprehensive developer guide created.

---

## Stage 10 Final Gate (AUTO-APPROVE) — 2026-08-20

- **Status:** `done` — Stage 10.0 auto-approved (không hỏi user, không merge); Stage 10.1–10.5 thực thi bởi integration worker; PR để OPEN chờ user review/merge.
- **Fresh final gates (real direct exits):**
  - `pnpm run test` → exit 0 — API **128/128 suites, 2726/2726 tests**; Web **234/234 suites, 2009 pass + 1 skipped**; coverage thresholds (80/80/80/80) preserved.
  - `pnpm run type-check` → exit 0; `pnpm run lint` → exit 0 (pre-existing warnings only); `pnpm run format:check` → exit 0; `pnpm run build` → exit 0 (`/reports/customer-analytics` emitted).
  - `pnpm exec playwright test tests/e2e/customer-analytics.spec.ts` → **6/6 pass, 0 skipped, exit 0** (parent + worker stability runs).
  - Full API integration sau khi xóa `dist`: **34 passed suites + 1 intentionally skipped, 450 passed + 5 skipped tests, exit 0** — customer-analytics integration **11/11** included.
- **Integration cleanup stabilization:** `import-export.integration.spec.ts` từng RED 2 lần vì deadlock `ForecastSnapshot`/TRUNCATE (async forecast snapshot capture) — cleanup đã hardened với explicit `ForecastSnapshot` + bounded retry chỉ cho Prisma P2010/meta code 40P01; focused rerun **37/37 passed**; full integration sau đó passed. Focused ESLint trên import-export integration + `git diff --check` → exit 0.
- **Stage 9 dogfood D1–D9:** PASS — 13 screenshots, real Web/API/shared dev DB, không có Story-blocking defect.
- **Sprint status:** Story 6.7 → `done` trong `sprint-status.yaml`.

---

## Dev Agent Record

### Agent Model Used

- Stage 5A (backend TDD worker): `opencode-go/deepseek-v4-flash` — split dispatch của AUTO-APPROVE pipeline (backend-first; frontend worker riêng sẽ tiếp tục Task 6 + phần frontend của Task 7).
- Stage 5B (frontend TDD worker): `9router/ag/gemini-3.7-flash-high` — frontend TDD worker hoàn tất Task 6 + phần frontend/RTL/docs của Task 7.
- Stage 9a (Playwright E2E worker): `9router/ag/gemini-3.7-flash-high` — triển khai và thực thi toàn diện 6 Playwright E2E flows (`tests/e2e/customer-analytics.spec.ts`), 6/6 tests pass (exit code 0).
- Stage 9b (real-data dogfood orchestrator): `openai-codex/gpt-5.6-sol` — áp migration bằng `prisma db execute`, seed real DB, chạy production processor/rerun, live GraphQL/browser checks và giữ 13 screenshots cho D1–D9.

### Debug Log References

- `pnpm --filter api exec prisma validate` / `prisma generate` — PASS (schema valid; client generated, `CustomerAnalyticsSnapshot` + Contact fields + Task automation fields present).
- `prisma migrate diff --from-migrations --to-schema-datamodel` vs throwaway Postgres 15 — `No difference detected` (hand-written migration khớp schema, 0 drift).
- Unit (focused): `pnpm exec jest src/reports/__tests__/customer-analytics src/tasks/__tests__/tasks-automation.spec.ts` → 87/87 pass.
- Full API unit: `pnpm exec jest --coverage` → 128 suites / 2705 tests pass, exit 0 (thresholds 80/80/80/80 giữ nguyên).
- API harness: `pnpm exec jest --config jest.api.config.ts` → 2 suites / 9 tests pass (graphql-api + rest-api).
- Integration: `pnpm exec jest --config jest.integration.config.ts customer-analytics.integration.spec.ts` → 9/9 pass (Testcontainers Postgres 15 + migrate deploy + real AppModule, non-ADMIN).
- `pnpm exec tsc --noEmit` → exit 0. `pnpm exec eslint "src/**/*.ts"` → exit 0. Prettier check → clean.
- Full integration suite: `pnpm exec jest --config jest.integration.config.ts` → 34 suites passed, 1 pre-existing skip, 0 failed (448 passed / 5 skipped) — gồm cả regression contacts/deals/tasks/activities/6.2–6.6. `import-export.integration.spec.ts` có TRUNCATE deadlock flake (40P01) — **tái hiện trên baseline stash (24 failed)** nên là pre-existing, không phải regression 6.7; lần chạy cuối pass. Truncate lists toàn bộ integration specs đã thêm `CustomerAnalyticsSnapshot` (trước Contact) theo Contract A5.
- `pnpm exec nest build` → exit 0.
- Debug finding trong processor: `createAutomatedTask` ban đầu audit với actor `'system'` gây `AuditLog_userId_fkey` violation → đổi audit actor thành task assignee (user thật cùng tenant); task/notification/calendar/pub-sub side effects giữ nguyên.
- Frontend TDD (Stage 5B):
  - `pnpm --filter web exec jest --coverage=false customer-analytics` → 3 suites / 21 tests pass.
  - `pnpm --filter web exec jest --coverage=false CustomerAnalyticsPage` → 1 suite / 12 tests pass.
  - `pnpm --filter web exec jest --coverage=false AppShellNavigation.spec.tsx Breadcrumbs.spec.tsx` → 2 suites / 31 tests pass.
  - Full Web Jest: `pnpm --filter web test` → 234 suites / 2004 tests pass (1 skipped), coverage gates met (80/78/80/80).
  - Web Type-Check: `pnpm --filter web type-check` → exit 0.
  - Web Lint: `pnpm --filter web lint` → exit 0.
  - Prettier: `pnpm format:check` → All matched files use Prettier code style!
  - Web Build: `pnpm --filter web build` → exit 0 (Next.js 14 production build cleanly generated `/reports/customer-analytics`).
- `git status`: chỉ sửa frontend & doc/tracking files; KHÔNG commit/push.
- Stage 9a Playwright parent verification (CI-like, self-contained): `pnpm exec playwright test tests/e2e/customer-analytics.spec.ts --list` → 6 tests; direct run → **6/6 pass, 0 skipped, exit 0**.
- Stage 9b dogfood: real API/Web/shared dev DB; processor first/rerun → `tasksCreated 9 → 0`, `contactsFailed 0`; Story fixtures → 19 calculated + one GraphQL-created `Not calculated`, 5 HIGH tasks/notifications, admin 19 calculated rows vs Sales Rep 9 owned rows; 320px `scrollWidth=clientWidth=320`, representative controls 44px, 4 painted charts + 4 semantic tables; 0 console/page errors and 0 unexpected analytics mutations.

### Fix Loop 1 (review findings F1–F4) — 2026-08-19, backend fix worker

- **F1 — bounded p75 threshold (verify + keep):** `p75OrderStatisticIndices`/`percentile75FromOrderStatistics` (score) + `resolveHighLtvThreshold` (service) verified: parity vs full-set Tukey-hinges `percentile75` locked for n=0..1000; `findMany` `take ≤ 2` (skip = first index); count+fetch scoped to the UNFILTERED visible predicate (`buildContactWhere(tenantId, userId, {})` + `lifetimeValue: { gt: 0 }`); UI analytics filters never reach the threshold query (B14/D32); no unbounded full-set fetch. Fixed 1 lint error in the interrupted worker's test helper (`thresholdCall` missing return type). Unit: score+service 70/70 pass; tsc/eslint/prettier clean.
- **F2 — cohort latest-day tenant-wide leak (RED→GREEN):** `buildCohorts` ran `customerAnalyticsSnapshot.aggregate(_max snapshotDate)` with `where: { tenantId, deletedAt: null }` BEFORE building `visibleWhere` — an invisible contact's newer snapshot pushed the cohort day past the visible data → caller got `[]` instead of the visible N-1 cohort. RED regression added (`derives the cohort latest day from VISIBLE contacts only`): invisible contact latest at day N, visible at N-1 → caller must receive the visible N-1 cohort, and the aggregate `where` must include `contact: visibleWhere`. Fix: build `visibleWhere` first and include `contact: visibleWhere` in BOTH the max aggregate and the cohort groupBy. Service spec 27/27 pass.
- **F3 — processor id-only writes/reads (RED→GREEN):** 3 exact-where unit tests added; fixed all three: `tx.contact.update where {id}` → `{id, tenantId, deletedAt: null}`; snapshot task-link read `findUnique({where:{id}})` → `findFirst({where:{id, tenantId, deletedAt: null}})` (mock type adjusted — `findUnique` removed from processor spec mock, rerun test now sequences `findFirst` previous→linked); snapshot task-link `update where {id}` → `{id, tenantId, deletedAt: null}`. Sibling Story 6.7 paths audited: `createAutomatedTask` (tasks.service.ts) already tenant-scoped everywhere; processor's previous-snapshot read + owner lookup already scoped; compound `tenantId_contactId_snapshotDate` upsert unchanged. Processor spec 22/22 pass.
- **F4 — products integration redundant TRUNCATE (fixed):** every one of ~15 TRUNCATE calls included `CustomerAnalyticsSnapshot`. Cleanup now truncates `CustomerAnalyticsSnapshot` ONCE in the first statement (before Contact/Tenant) and restores all remaining statements to their original table lists. Products integration 3/3 pass.
- **Fix-loop gates (all real exit codes):** unit `customer-analytics*` 4 suites 100/100; `tasks-automation` 7/7; full `src/reports` 32 suites 858/858; integration `customer-analytics` 9/9 + `products` 3/3 (run serially, Testcontainers Postgres 15); `prisma validate` + `prisma generate` via Infisical env pass (no migrate dev/deploy on shared DB); API `tsc --noEmit` exit 0; eslint exit 0; Prettier check clean. No threshold lowered; no frontend files touched; no commit/push.

### Frontend Fix Loop 1 (findings F1–F6) — 2026-08-19, frontend fix worker

- **F1 HIGH — Currency correctness/no-FX (RED→GREEN):** Derived sole display currency only when `!mixedCurrencies && currencyBreakdown.length === 1`; otherwise `null`/neutral. Threaded `displayCurrency` into `formatCustomerLtv`, `CustomerAnalyticsPage` summary/table, and `buildLtvTrendChartData` / `buildCohortChartData` semantic tables. Single non-USD currency (e.g. EUR) formats with `€`/EUR symbol and suffix `(EUR)`. Mixed currencies state has no currency symbol in metrics, customer rows or chart semantic tables. Filter label updated to neutral "Khoảng LTV".
- **F2 HIGH — Chart semantic tables always present & no fake toggle (RED→GREEN):** Removed misleading "Bảng dữ liệu" toggle states and buttons in `CustomerAnalyticsPage`. All four `ReportChart` instances now render with default `hideSrTable=false`, ensuring accessible sr-only semantic table equivalents are present on initial render. Added RTL regression test verifying all 4 semantic tables exist on mount and no fake toggle buttons are rendered.
- **F3 HIGH — Touch targets >= 44px (RED→GREEN):** Updated all interactive elements owned by `CustomerAnalyticsPage` to at least 44 CSS px (`min-h-11` on buttons, inputs, page-size select, pagination prev/next, and risk checkbox labels). Added RTL assertions for classes on representative buttons, inputs, combobox, and checkbox labels.
- **F4 IMPORTANT — 320px responsive robustness and honest test (RED→GREEN):** Verified container and toolbar responsive flex-wrapping with no fixed page min-width, `ResponsiveTableWrapper` encapsulation for tables, and 44px touch targets. Added honest RTL spec simulating 320px viewport width and asserting responsive classes and keyboard focusability.
- **F5 IMPORTANT — Breadcrumbs duplicate React key warning fix (RED→GREEN):** Fixed duplicate React key warning by using stable index-prefixed keys (`${index}-${crumb.href}`) in `Breadcrumbs.tsx`. Added spy test asserting zero console errors on `/dashboard` and top-level routes.
- **F6 IMPORTANT — Finite number filter validation (RED→GREEN):** Updated `validateAnalyticsFilterRange` in `lib/customer-analytics.ts` to reject non-finite inputs (`Number.isFinite`) such as `1e309` (Infinity) or NaN before queries are sent. Switched inputs in `CustomerAnalyticsPage` to `type="text" inputMode="numeric"` with `Number()` parsing to preserve non-finite strings for validation. Pure unit and RTL specs added and passing.
- **Frontend Fix-loop gates:**
  - Focused specs: 6 suites / 69 tests pass (exit code 0).
  - Full web test suite: `pnpm --filter web test` → 234 suites / 2010 tests pass (2009 passed, 1 skipped), coverage gates met (80/78/80/80).
  - Web TypeScript check: `pnpm --filter web type-check` → exit code 0.
  - Web Lint: `pnpm --filter web lint` → exit code 0.
  - Prettier check: `pnpm format:check` → All matched files use Prettier code style!
  - Web production build: `pnpm --filter web build` → exit code 0.
  - Zero API or E2E edits. Task 6 complete, Task 7 Playwright open, status `in-progress`.

### Stage 8 Fix Loop 2 (backend review findings R1–R3) — 2026-08-19, agent `opencode-go/deepseek-v4-flash`

- **R1 — C21 task description evidence (RED→GREEN):** `CustomerAnalyticsProcessor.buildTaskDescription(churnRiskScore, lastActivity, contactId)` now emits a deterministic, concise description — score to one decimal, last activity as full ISO UTC instant or explicit `No activity recorded`, and follow-up intent `Open /contacts/<id> to re-engage the customer.` `churnRiskScore`/`lastActivity` are threaded from the already-computed `processContact` results into `maybeCreateChurnTask` (no extra DB query); title/priority/status/assignee/contact/due/automationKey semantics untouched; no secrets/PII (score + timestamp + contact id only). RED: 2 new processor spec tests failed on the generic prose (`85.0` / ISO date / `/contacts/contact-1` missing; `No activity recorded` missing) → GREEN: processor spec 24/24. Integration: task-description assertions added to the rerun-idempotency test (`100.0`, `No activity recorded`, `/contacts/<contactB>`) → integration 10/10.
- **R2 — null-safe average LTV (RED→GREEN):** `CustomerAnalyticsService.customerAnalytics` summary now requests `_avg: { lifetimeValue: true }` on the existing bounded contact aggregate and derives `averageLifetimeValue` from it (SQL AVG excludes NULL — NOT_CALCULATED contacts never dilute the average and are never treated as zero). Mixed currencies and zero-calculated both return `null` (never `0`); `customerCount`, `calculatedCustomerCount`, `totalLifetimeValue` unchanged. RED: 2 new service spec tests failed (`350.5` vs received `175.25`; `null` vs received `0`) → GREEN: service spec 30/30. Integration +1 test: 7 visible / 6 calculated (E created after run + D soft-deleted), single USD → `customerCount 7`, `calculatedCustomerCount 6`, total `1350.5`, average exactly `225.08` (calculated-0 contacts B/F/G/H still in denominator).
- **R3 — exact 90-day trend bounds (RED→GREEN):** `buildLtvTrend` start corrected to `today - (TREND_DAYS - 1) * MS_PER_DAY` (today-89 … today inclusive; `endExclusive = today + 1` unchanged) — the old `today - 90d` covered 91 UTC calendar days. Tenant/visibility/deletedAt scope untouched. RED: new service spec test failed on exact bounds (received `2026-05-17`, expected `2026-05-18`) → GREEN: service spec 30/30; asserts start `2026-05-18`, today-90 `2026-05-17` excluded, exclusive span exactly 90 days. B11 engagement window `[snapshotDate-90d, end-of-snapshot-day]` intentionally NOT changed (that clause defines its own interval); trend/cohort `_avg` semantics already null-excluding (no change).
- **Same-class Story 6.7 audit (R1–R3 scope):** only `buildTaskDescription` builds churn-task descriptions (fixed); the only summary average dividing by all contacts was `customerAnalytics` line 280 (fixed; trend/cohort already use Prisma `_avg`); the only 90-day *trend* window was `buildLtvTrend` (fixed) — B11 engagement window in `customer-analytics-score.ts`/processor `loadBatchAggregates` intentionally kept.
- **Gates (real exits, no pipe-to-tail):** focused `customer-analytics*` + `tasks-automation` unit → 5 suites / 112 tests pass, exit 0; full API unit `pnpm exec jest --coverage` → 128 suites / 2723 tests pass, exit 0 (80/80/80/80 thresholds unchanged); API harness `jest.api.config.ts` → 2 suites / 9 tests pass; Testcontainers `customer-analytics.integration.spec.ts` → 10/10 pass (Postgres 15, real AppModule, non-ADMIN); `pnpm exec tsc --noEmit` → exit 0; eslint on the 5 touched source/test files → exit 0; Prettier check clean. No frontend/e2e/schema/migration/package/doc edits by this worker; no commit/push. Task 7 Playwright remains `[ ]`; Tasks 1–6 and sprint/story status (`in-progress`) untouched.
- **Changed files (this fix loop):** `apps/api/src/reports/customer-analytics-processor.service.ts`, `apps/api/src/reports/customer-analytics.service.ts`, `apps/api/src/reports/__tests__/customer-analytics-processor.service.spec.ts`, `apps/api/src/reports/__tests__/customer-analytics.service.spec.ts`, `apps/api/test/integration/customer-analytics.integration.spec.ts`, `_bmad-output/implementation-artifacts/6-7-customer-lifetime-value-churn-risk-analysis.md` (Resolution lines + this record).

### Stage 8 Fix Loop 3 (backend review findings R2-F1/R2-F2) — 2026-08-19, agent `opencode-go/deepseek-v4-flash`

- **R2-F1 — null-safe total LTV (D31/E42/AC 10, RED→GREEN):** `CustomerAnalyticsService.customerAnalytics` summary now derives `totalLifetimeValue = mixedCurrencies || calculatedCustomerCount === 0 ? null : round2(rawTotal)` — the `?? 0` fallback is kept ONLY for the actual-calculated-zero case (with ≥1 calculated contact the raw SQL SUM is a real value, so a genuine sum of 0 stays numeric 0). A fresh tenant (no processor run) no longer sees a fabricated Total LTV `0` while Average shows `—` and analyzed-count shows `0 / N`. RED: extended service spec zero-calculated test failed on `expect(totalLifetimeValue).toBeNull()` — received `0`; GREEN: service spec 31/31 (30 prior + 1 new pin test `keeps 0 total when a calculated customer truly has LTV 0`, which guards the null guard against over-nulling). Integration +1 test: no processor run + soft-delete D (single USD) → `calculatedCustomerCount 0`, `mixedCurrencies false`, `totalLifetimeValue null` → integration 11/11.
- **R2-F2 — batch aggregate failure accounting/continuation (C20, RED→GREEN):** `processTenant` wraps `loadBatchAggregates` per contact batch. On failure: `summary.contactsFailed += contacts.length`, log `Customer analytics batch failed [tenant=<id>, offset=<n>, count=<n>]: <message>` (tenant id + deterministic batch metadata — never contact ids/names/PII), advance offset by `contacts.length`, `continue` to the next batch; the failed batch's contacts are never processed per-contact (no double counting, per-contact failure counting unchanged). `contact.findMany` failures keep the outer `runDailyProcessing` tenant catch (batch size unknown — unloaded contacts cannot be counted). Stable `(createdAt, id)` paging and bounded batch queries unchanged. RED: 2 new processor spec tests failed on `contactsFailed 0` (expected 2 / 4) and missing `offset=0` batch log; GREEN: processor spec 26/26 — (a) batchSize=2, 4 contacts, first batch aggregate rejects → `failed 2 / succeeded 2`, exactly 2 upserts (later batch processed), error log contains tenant + `offset=0` + `count=2`, no emails/contact ids; (b) every batch rejects → `failed 4 / succeeded 0`, zero upserts (no false success).
- **Same-class Story 6.7 audit (R2-F1/R2-F2 scope):** summary `?? 0` sites re-audited — the only null→0 fabrication before processor materialization was the total (fixed); average null-safe (R2), `latestCalculatedAt` null-safe, `ltvDistribution` empty when min/max null, `currencyBreakdown` per-group real values, `toCustomerItem` keeps `lifetimeValue: null` (the `?? 0` there is only the internal `isHighLifetimeValue` comparison, verified R2), trend/cohort `_sum ?? 0` are time-series display defaults explicitly left unchanged (review verdict; engagement/trend semantics untouched). Processor failure paths: per-contact catch counts, aggregate-batch catch now counts (fixed), outer tenant catch intentionally does not (unknown batch size) — no other aggregate-batch path silently aborts with known contacts. Prior R1–R3/C21 fixes untouched.
- **Gates (real exits, no pipe-to-tail):** focused `customer-analytics*` + `tasks-automation` unit → 5 suites / 115 tests pass, exit 0; API harness `jest.api.config.ts` → 2 suites / 9 tests pass; Testcontainers `customer-analytics.integration.spec.ts` → 11/11 pass (Postgres 15, real AppModule, non-ADMIN); `npx tsc --noEmit` → exit 0; eslint on the 5 touched source/test files → exit 0; Prettier check clean on the 5 touched files. No frontend/e2e/schema/migration/package/doc edits by this worker; no commit/push. Task 7 Playwright remains `[ ]`; Tasks 1–6 and sprint/story status (`in-progress`) untouched. Full API unit `npx jest --coverage` → 128 suites / 2726 tests pass, exit 0 (80/80/80/80 thresholds unchanged — +3 tests over the 2723 baseline).

### Completion Notes List

- **Task 1 (AC 3, 8, 14–16; A1–A6):** `Contact` +5 nullable server-owned fields (`lifetimeValue`, `churnRisk`, `churnRiskScore`, `lastActivityDate`, `analyticsCalculatedAt`) + 3 indexes `[tenantId, churnRisk]`, `[tenantId, lifetimeValue]`, `[tenantId, lastActivityDate]`; model `CustomerAnalyticsSnapshot` (unique `(tenantId, contactId, snapshotDate)` + 5 indexes + FKs Tenant/Contact CASCADE, Task SET NULL); `Task.automationSource?/automationKey?` + `@@unique([tenantId, automationKey])`; inverse relations ở Tenant/Contact/Task. Migration hand-written `20260819120000_add_customer_analytics` — additive, nullable, đúng thứ tự FK/index, `migrate diff` = 0 drift. TRUNCATE list harness thêm `CustomerAnalyticsSnapshot`. Rows cũ giữ NULL (không fake 0/LOW). Sibling fixtures (contacts/facebook service specs) cập nhật 5 field nullable.
- **Task 2 (AC 4–6, 13, 17; B7–B15):** `customer-analytics-score.ts` thuần (no Nest/Prisma): const tuples/weights (0.4/0.3/0.3, window 90 UTC days, 10 pts/activity), UTC day math, LTV round2 + currency breakdown + mixed flag, inactivity (fallback createdAt, future clamp), win rate (neutral 50 khi chưa closed), engagement qualifying types + 90d boundary, weighted score round1 clamp, categories LOW<30 / MEDIUM 30–70 / HIGH>70, percentile 75 Tukey hinges (null khi không có positive LTV), recommended actions exact `Schedule follow-up`/`Upsell opportunity`/`Monitor`. Spec 44 tests phủ F1–F28 (29.9/30/70/70.1 exact qua inputs đã hiệu chỉnh trọng số), money non-finite reject.
- **Task 3 (AC 8, 15–16; C16–C20, C24–C25):** `CustomerAnalyticsProcessor` — `@Cron('0 0 2 * * *')`, clock/batchSize(500)/concurrency(4)/retryAttempts(3) injectable; tenant batches + contact batches stable `(createdAt, id)`; 4 fixed aggregate groupBy/batch (latest activity, qualifying 90d count, won theo (contactId, currency) sum+count, lost count) — KHÔNG N+1/unbounded; per-contact short transaction (update current Contact + upsert unique snapshot); P2034 bounded retry; per-batch failure log (tenant/batch ids, không PII) + continuation; summary `{tenants, contactsSucceeded, contactsFailed, tasksCreated, taskFailures}`. Spec 19 tests (cron metadata, no-N+1 query shape 200 contacts, UTC snapshot date, idempotency, P2034 retry/exhaustion, tenant failure, null aggregates).
- **Task 4 (AC 14; C21–C23):** `TasksService.createAutomatedTask` — internal automation path reuse validation/select/audit/TASK_ASSIGNED pub-sub + notification/calendar side effects; P2002 trên automation key → existing same-tenant task (idempotent); không expose automation fields qua public input; owner inactive → task creation fail an toàn (retry lần sau), không reassign. Processor: transition chỉ khi previous snapshot không HIGH (kể cả lần đầu); snapshot link `churnPreventionTaskId` là idempotency marker; key `CHURN_RISK:<contactId>:<YYYY-MM-DD>`; task fields exact (title/priority HIGH/TODO/assignedTo owner/contactId/dealId null/dueDate +1 UTC day). Spec 7 tests + integration rerun/sustained/HIGH→LOW→HIGH/inactive-owner.
- **Task 5 (AC 7, 10–13, 15–16; D26–D34):** `CustomerAnalyticsService` — validation đóng (finite bounds, min<=max, ISO dates, from<=to, churnRisks closed); base predicate từ `ContactsService.buildContactWhere` (không copy visibility) + AND analytics filters; summary/distributions DB-aggregate (count/aggregate/groupBy, ≤5 bins từ filtered min/max, NOT_CALCULATED + percentage); customers list stable sort (risk desc null last, LTV desc, id asc) pageSize ≤100; currency breakdown qua deal.groupBy với relation filter; threshold p75 từ visible unfiltered set (B14); trend 90d từ snapshots (không double-count); cohorts theo acquisitionCohort trên latest snapshot date, sort tăng dần; mixed currencies → total/average null + breakdown + flag. `customer-analytics.graphql.ts` — Pothos refs typed từ service shapes, enums `CustomerChurnRisk`/`CustomerRecommendedActionCode`, closed inputs, query `customerAnalytics(filters, pagination)` với REPORT:READ + CONTACT:READ + DEAL:READ; đăng ký từ `ReportsModule.onModuleInit()` + side-effect import trong `graphql/schema.ts`. Spec 20 service tests + 7 SDL tests (registration, closed input, permission propagation, ref/select lockstep). **Không expose calculated fields trên Contact ref** — frontend dùng analytics query riêng (tránh nặng contact list); không cần sync `contactListSelect`.
- **Task 6 & Task 7 Frontend (AC 9–13, 15–16; E35–E45, F50, F53):**
  - `apps/web/src/services/customer-analytics.service.ts`: Hand-written GraphQL service với exact query/variables/fragments, unwrap typed result, query keys isolated và rooted strictly tại `['customerAnalytics']`.
  - `apps/web/src/lib/customer-analytics.ts`: Pure formatters & normalizers (`formatCustomerLtv`, `formatRiskScore`, `getChurnRiskBadgeDetails`, `validateAnalyticsFilterRange`) và 4 chart adapters chuyển đổi typed data cho `ReportChart` (LTV distribution, Churn risk donut, 90-day LTV trend, acquisition cohort analysis).
  - `apps/web/src/components/reports/CustomerAnalyticsPage.tsx`: Dashboard component với 4 metric cards (Total LTV, Avg LTV, Analyzed customer count, High-Risk count), persistent mixed-currency warning banner kèm ISO currency breakdown, 4 analytical charts tái sử dụng `ReportChart` kèm always-present sr-only semantic tables (`hideSrTable=false` default), filter toolbar (LTV range, churn risks checkboxes, last activity dates, search, owner) với inline validation, và customer list table với exact risk badge (`Low`, `Medium`, `High`, `Not calculated`), link `/contacts/<id>`, action labels (`Schedule follow-up`, `Upsell opportunity`, `Monitor`), responsive wrapper và pagination controls. Xử lý triệt để loading skeleton, permission limited state (yêu cầu REPORT:READ + CONTACT:READ + DEAL:READ), error state với retry, và empty state.
  - Thin route: `apps/web/src/app/(dashboard)/reports/customer-analytics/page.tsx` và breadcrumbs segment `'customer-analytics': 'Customer Analytics'`.
  - Navigation: Thêm mục `Customer Analytics` dưới nhóm Reports trong `AppShellNavigation.tsx`, bảo vệ bởi quyền `REPORT:READ`.
  - Specs: Unit/RTL specs cho `customer-analytics.service.spec.ts`, `customer-analytics.spec.ts`, `CustomerAnalyticsPage.spec.tsx`, `customer-analytics-page.spec.tsx`, `Breadcrumbs.spec.tsx`, `AppShellNavigation.spec.tsx`.
  - Project context: Cập nhật `docs/project-context.md` phản ánh trung thực bản build Story 6.7.
- **Task 7 (backend portion; F46–F49, F52):** `customer-analytics.integration.spec.ts` — Testcontainers + real AppModule, non-ADMIN roles: exact CLV 350.5/score 55.1/MEDIUM từ seeded data; snapshot exact fields; rerun idempotency (1 snapshot/contact/day, tasksCreated 0 ở rerun); HIGH transition task exact fields + TASK_ASSIGNED notification; HIGH→LOW→HIGH → 2 tasks; sustained HIGH → 1 task; inactive owner → snapshot lưu + taskFailures; mixed currency breakdown + null totals; NOT_CALCULATED + percentages 100%; filters (LTV range/risk/last-activity/search/ownerId); own-scope visibility + threshold từ visible set + upsell action; soft-delete/cross-tenant negatives; permission denial REPORT/CONTACT/DEAL; stable sort pagination no dup/skip. Gates: full unit 2705 green + coverage thresholds giữ nguyên; api suite 9/9; integration regression suite (chạy full, kết quả bên dưới); tsc/eslint/prettier clean; Prisma validate/generate pass; migration SQL inspected.
- **Stage 9 status:** Tasks 1–7 hoàn thành. Playwright Stage 9a pass 6/6; real-data dogfood D1–D9 pass với 13 screenshots và reproducible runtime/DB/GraphQL evidence. Story & sprint status tạm giữ `in-progress` cho đến Stage 10 final gate/auto-approval.

### File List

- `_bmad-output/implementation-artifacts/6-7-customer-lifetime-value-churn-risk-analysis.md` (story context — tasks/status/record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status tracking: 6-7 → in-progress)
- `apps/api/prisma/schema.prisma` (Contact analytics fields/indexes, CustomerAnalyticsSnapshot, Task automation fields, inverse relations)
- `apps/api/prisma/migrations/20260819120000_add_customer_analytics/migration.sql` (hand-written additive migration)
- `apps/api/src/reports/customer-analytics-score.ts` (pure CLV/churn formula, NEW)
- `apps/api/src/reports/customer-analytics-processor.service.ts` (daily 02:00 UTC processor, NEW)
- `apps/api/src/reports/customer-analytics.service.ts` (typed analytics query service, NEW)
- `apps/api/src/reports/customer-analytics.graphql.ts` (Pothos schema surface, NEW)
- `apps/api/src/reports/__tests__/customer-analytics-score.spec.ts` (F1–F28, NEW)
- `apps/api/src/reports/__tests__/customer-analytics-processor.service.spec.ts` (NEW)
- `apps/api/src/reports/__tests__/customer-analytics.service.spec.ts` (NEW)
- `apps/api/src/reports/__tests__/customer-analytics.graphql.spec.ts` (SDL/registration, NEW)
- `apps/api/src/tasks/tasks.service.ts` (CreateAutomatedTaskInput + createAutomatedTask internal path)
- `apps/api/src/tasks/__tests__/tasks-automation.spec.ts` (NEW)
- `apps/api/src/reports/reports.module.ts` (provide/register analytics service + processor + graphql)
- `apps/api/src/graphql/schema.ts` (barrel side-effect import customer-analytics.graphql)
- `apps/api/test/api/api-test-harness.ts` (TRUNCATE + CustomerAnalyticsSnapshot)
- `apps/api/test/integration/customer-analytics.integration.spec.ts` (Testcontainers evidence, NEW)
- `apps/api/test/integration/*.integration.spec.ts` (28 specs — TRUNCATE lists thêm `CustomerAnalyticsSnapshot` theo Contract A5)
- `apps/api/src/contacts/__tests__/contacts.service.spec.ts` (fixture +5 nullable fields)
- `apps/api/src/facebook/__tests__/facebook.service.spec.ts` (fixture +5 nullable fields)
- `apps/web/src/services/customer-analytics.service.ts` (hand-written GraphQL service + query keys, NEW)
- `apps/web/src/services/__tests__/customer-analytics.service.spec.ts` (service unit spec, NEW)
- `apps/web/src/lib/customer-analytics.ts` (pure formatters & ReportChart adapters, NEW)
- `apps/web/src/lib/__tests__/customer-analytics.spec.ts` (pure format & chart transformation spec, NEW)
- `apps/web/src/components/reports/CustomerAnalyticsPage.tsx` (dashboard component, NEW)
- `apps/web/src/components/reports/__tests__/CustomerAnalyticsPage.spec.tsx` (RTL component spec, NEW)
- `apps/web/src/app/(dashboard)/reports/customer-analytics/page.tsx` (thin page route, NEW)
- `apps/web/src/app/(dashboard)/reports/__tests__/customer-analytics-page.spec.tsx` (page spec, NEW)
- `apps/web/src/components/layout/AppShellNavigation.tsx` (added Customer Analytics nav item)
- `apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx` (nav item regression tests)
- `apps/web/src/components/layout/Breadcrumbs.tsx` (added customer-analytics segment label)
- `apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx` (breadcrumb segment tests)
- `docs/project-context.md` (as-built Story 6.7 update)
- `tests/e2e/customer-analytics.spec.ts` (6 deterministic Story 6.7 Playwright flows, NEW)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/report.md` (D1–D9 report)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/runtime-evidence.json` (browser/request/layout evidence)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/db-verification.json` (real score/snapshot/task/notification evidence)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/graphql-verification.json` (real analytics query evidence)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/processor-run.json` (first run + idempotent rerun)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/run-dogfood.cjs` (reproducible browser evidence collector)
- `docs/workflow-artifacts/6-7-customer-lifetime-value-churn-risk-analysis/dogfood/screenshots/*.png` (13 real-data screenshots)

---

## Review Findings (Stage 8 — Independent Adversarial Code Review, 2026-08-19)

> Stage 8 fresh review by an independent reviewer (leaf executed all layers itself: Blind Hunter, Edge Case Hunter, Acceptance Auditor, Security Scanner, Test Quality Check, then dedupe/triage). Inputs: baseline `938c5a0`, `git diff 938c5a0`, all untracked Story 6.7 files read directly, 18 binding ACs + Contract A–F from this story only, `docs/rules/*`. Dev Agent Record/Completion Notes were NOT consumed as evidence — source/tests were inspected independently. Gate context (234 web suites / 128 API suites green, tsc/lint/format/build exit 0) treated as background only; focused re-run of backend analytics suites: **5 suites / 107 tests PASS** (score, service, processor, graphql, tasks-automation). No commit, no push, no production/test/doc edits — this section only.

### Verdict: FINDINGS (3 Minor — no Critical/Important). AC 18/18 PASS. Rules compliant. Recommend proceed to Stage 9.

### Findings (deduped, actionable)

1. **[Minor][Contract C21] Churn-prevention task description omits score/last-activity requirement**
   - Location: `apps/api/src/reports/customer-analytics-processor.service.ts:482-485` (`buildTaskDescription`), called at `:457-466`.
   - Violated: Binding Contract C21 — "description nêu score/last activity và link intent tới contact nhưng không chứa bí mật".
   - Expected: description states the churn score and last activity date (plus follow-up intent).
   - Actual: `'Automated follow-up: contact moved to HIGH churn risk. Review recent activity and re-engage the customer.'` — generic; no score, no last activity.
   - Minimal fix: pass `churnRiskScore` and `lastActivityDate` into `maybeCreateChurnTask`/`buildTaskDescription` (both already computed in `processContact`) and interpolate e.g. `score ${churnRiskScore.toFixed(1)}` / `last activity ${lastActivityDate?.toISOString().slice(0,10) ?? 'none'}`. No secrets involved. Note: `tasks-automation.spec.ts` fixture already models the richer description, so only the processor call site + one processor spec assertion need updating.
   - **Resolution (Stage 8 Fix Loop 2, 2026-08-19):** `buildTaskDescription(churnRiskScore, lastActivity, contactId)` now emits a deterministic, concise description — score formatted to one decimal, last activity as full ISO UTC instant or explicit `No activity recorded`, and follow-up intent `Open /contacts/<id> to re-engage the customer.` Values are threaded from the already-computed `processContact` results (no extra DB query); title/priority/status/assignee/contact/due/automation semantics and the no-secrets rule are unchanged. RED→GREEN: processor spec +2 tests (activity date case + null case) and integration task-description assertions (`100.0`, `No activity recorded`, `/contacts/<id>`) — see Dev Agent Record → Stage 8 Fix Loop 2.

2. **[Minor][D31/AC 10] `averageLifetimeValue` denominator includes not-calculated customers, diluting the metric**
   - Location: `apps/api/src/reports/customer-analytics.service.ts:277-280`.
   - Violated: AC 10 ("average LTV per customer") — ambiguous in contract; AUTO-APPROVE reading: customers with null analytics have no LTV, yet they dilute the average.
   - Expected: average over customers that actually have calculated LTV (or an explicit documented denominator).
   - Actual: `averageLifetimeValue = mixedCurrencies || customerCount === 0 ? null : round2(rawTotal / customerCount)` — `_sum` ignores null LTVs, denominator counts ALL visible customers. A tenant with many new (not-yet-calculated) contacts sees a collapsed average that contradicts the UI's own "null ≠ 0" (em dash / Not calculated) stance. Integration test locks the behavior only in the all-calculated case (7/7 calculated).
   - Minimal fix: `const avgDenominator = calculatedCustomerCount > 0 ? calculatedCustomerCount : customerCount` (or return null when 0 calculated); add a unit + integration assertion with a mix of calculated/NOT_CALCULATED contacts.
   - **Resolution (Stage 8 Fix Loop 2, 2026-08-19):** `averageLifetimeValue` now derives from the bounded DB aggregate `_avg: { lifetimeValue: true }` added to the existing contact aggregate (SQL AVG excludes NULL — NOT_CALCULATED contacts never dilute the average and are never treated as zero). Mixed currencies and zero-calculated both return `null`, never `0`; `customerCount`/`calculatedCustomerCount`/`totalLifetimeValue` unchanged. RED→GREEN: service spec +2 tests (2 visible / 1 calculated 350.5 → 350.5, not 175.25; no-calculated → null) and integration +1 test (7 visible / 6 calculated, single USD → 225.08, with calculated-0 contacts still in the denominator) — see Dev Agent Record → Stage 8 Fix Loop 2.

3. **[Minor][Contract C24] LTV trend window covers 91 calendar days instead of "90 ngày gần nhất"**
   - Location: `apps/api/src/reports/customer-analytics.service.ts:496-498` (`buildLtvTrend`: `start = today - 90d`, `endExclusive = today + 1d`).
   - Violated: C24 "trả LTV trend cho 90 ngày gần nhất" (literal reading).
   - Expected: exactly 90 snapshot days (today-89 … today) per the literal contract text.
   - Actual: snapshot days today-90 … today (91 days). Consistent with the story's own 90×24h window convention (B11 engagement bracket `[snapshotDate-90d, end-of-snapshot-day]`), so behavior is defensible — but the UI copy ("90 ngày UTC gần nhất") and contract text say 90.
   - Minimal fix (optional): `const start = new Date(today.getTime() - (TREND_DAYS - 1) * MS_PER_DAY)`; or accept the convention and note it in `docs/project-context.md`. No test currently asserts the boundary — add one if changed.
   - **Resolution (Stage 8 Fix Loop 2, 2026-08-19):** trend window corrected to exactly 90 snapshot days — `start = today - (TREND_DAYS - 1) * MS_PER_DAY` (today-89 … today), `endExclusive = today + 1` unchanged; tenant/visibility/deletedAt scope untouched. RED→GREEN: service spec +1 test asserts exact bounds (start `2026-05-18`, today-90 `2026-05-17` excluded, exclusive span exactly 90 days). B11 engagement window `[snapshotDate-90d, end-of-snapshot-day]` intentionally NOT changed (that clause defines its own interval) — see Dev Agent Record → Stage 8 Fix Loop 2.

### Acceptance Criteria matrix (18/18 PASS)

| # | AC | Verdict | Source + Test evidence |
| --- | --- | --- | --- |
| 1 | Contact + Deal mgmt implemented (Epics 2/3) | PASS | Pre-existing shipped modules; Story 6.7 diff preserves them; regression integration suites green (gate) |
| 2 | Implement CLV + churn risk analysis | PASS | score/processor/service/graphql/frontend all present |
| 3 | Contact extended: lifetimeValue, churnRisk, lastActivityDate | PASS | schema.prisma:394-398 + migration.sql (5 nullable cols, additive); not in Create/UpdateContactInput; processor materializes |
| 4 | LTV = sum of closed-won deal values | PASS | customer-analytics-score.ts:96-101 (stage isWon only); integration exact 350.5 |
| 5 | Churn factors inactivity 40% / win rate 30% / engagement 30% | PASS | CHURN_WEIGHTS + calculateChurnRiskScore; score spec F14 |
| 6 | Categories LOW<30, MEDIUM 30–70, HIGH>70 | PASS | categorizeChurnRisk; spec F15–F18 exact 29.9/30/70/70.1 |
| 7 | GraphQL customerAnalytics(filters) | PASS | customer-analytics.graphql.ts + SDL spec + integration non-ADMIN |
| 8 | Daily background recalc | PASS | `@Cron('0 0 2 * * *')` + processor; integration rerun idempotency |
| 9 | Frontend /reports/customer-analytics page | PASS | thin route + CustomerAnalyticsPage + RTL |
| 10 | Dashboard: total/average LTV, LTV distribution, churn distribution | PASS | metric cards + 2 charts; RTL + integration |
| 11 | Filters: LTV range, risk level, last activity date | PASS | service validation + applyAnalyticsFilters + integration filter test |
| 12 | List: name, LTV, badge, last activity, recommended action | PASS | table + getChurnRiskBadgeDetails + RTL |
| 13 | Recommended actions exact | PASS | recommendedActionFor + integration (Schedule follow-up / Upsell opportunity / Monitor) |
| 14 | HIGH → automated task for account manager | PASS | maybeCreateChurnTask + createAutomatedTask; P2002 idempotent; integration (owner/priority/due/key/TASK_ASSIGNED, sustained-HIGH no dup, HIGH→LOW→HIGH 2 tasks, inactive owner safe fail) |
| 15 | Historical LTV tracking (trend) | PASS | snapshot model + buildLtvTrend + trend chart/RTL |
| 16 | Cohort analysis by acquisition date | PASS | acquisitionCohort YYYY-MM + buildCohorts + cohort chart/RTL |
| 17 | Unit tests cover LTV + churn logic | PASS | score spec F1–F28 + processor/service/graphql/tasks-automation specs (107 focused tests re-run PASS) |
| 18 | Integration tests verify analytics accuracy | PASS | customer-analytics.integration.spec.ts Testcontainers Postgres 15 + real AppModule, non-ADMIN, exact CLV/score/category, tenant/visibility/permission negatives |

### Adversarial checks — all clean (no additional findings)

- **Tenant/visibility**: every DB access carries `tenantId` (+ `deletedAt: null` where applicable); no ID-only DML (F3 lockstep re-verified); visibility derived solely via `ContactsService.buildContactWhere` (no copy; service spec asserts); snapshot child never resolves visibility directly; cross-tenant + soft-delete negatives integration-tested on list/summary/trend/currency.
- **Snapshot rerun / concurrency**: upsert on `(tenantId, contactId, snapshotDate)`; task P2002 → same-tenant existing task (spec asserts tenant-scoped lookup); linked-task marker on today's snapshot; transaction boundaries never span notification/pub-sub (task created outside tx); P2034 bounded retry (3 attempts, exhaustion → counted failure, never swallowed into success).
- **HIGH transitions**: first-run (no prev snapshot) creates task; sustained HIGH blocked even if task completed/deleted; HIGH→MEDIUM→HIGH creates new; inactive/deleted owner → snapshot saved, taskFailures logged, no reassignment (all integration-tested).
- **Batching/bounds**: tenant batches (1000) + contact batches (500) stable `(createdAt,id)`; exactly 4 groupBy aggregates per batch (no N+1, spec asserts 200-contact batch = 4 calls); no full-set materialization; p75 = count + ≤2 order-statistic rows, parity locked n=0..1000; pagination stable sort risk desc null-last → LTV desc → id asc, no dup/skip (integration); threshold from unfiltered visible set (filtered vs unfiltered locked).
- **Mixed currency**: no FX anywhere; raw-sum LTV per contract; total/average null when mixed; currencyBreakdown ISO-sorted; UI neutral formatting + persistent warning; single non-USD (EUR) formatted with EUR/€ + suffix; semantic tables neutral — integration + RTL.
- **GraphQL/Pothos**: refs typed from service shapes; select ⊇ exposed fields (lockstep); enums from const tuples; closed inputs (unknown keys rejected, spec G5); permission REPORT+CONTACT+DEAL via typed gates, non-ADMIN integration negatives; barrel import + `ReportsModule.onModuleInit()` registration present.
- **Migration**: additive, nullable, FK order (Tenant/Contact CASCADE, Task SET NULL), all 6 snapshot indexes + 3 Contact indexes + Task unique match schema 1:1; no backfill; Testcontainers `migrate deploy` green.
- **Frontend**: no permission-denied flash (skeleton gate + `enabled: hasAccess`); query key `['customerAnalytics', {filters, pagination}]` covers all variables; finite/date/range validation blocks query; filter change resets page 1; null analytics → em dash / Not calculated / NOT_CALCULATED (never 0/LOW); 4 charts with always-present sr-only semantic tables (`hideSrTable=false` default); touch targets ≥44px; 320px responsive (RTL); links exact `/contacts/<id>`.
- **Negative constraints**: no new dependency, no Prisma upgrade, no Account/Customer/AI/FX/Redis, no public task automation fields (inputs untouched), no client-writable calculated fields.

### Rules compliance

- **naming-conventions**: PASS — kebab-case service/route files, PascalCase component, const objects over enums.
- **typescript-rules**: PASS — no `any`/`@ts-ignore`, explicit return types, strict-mode clean (tsc exit 0).
- **nestjs-rules**: PASS — constructor DI, thin controllers/typed services, module registration order (`ReportsModule` before `AppGraphqlModule`).
- **prisma-rules**: PASS — tenantId on every query, indexes for filter/sort, batch/aggregate patterns, no N+1, parameterized, additive migration, Testcontainers testing.
- **react-nextjs-rules**: PASS — TanStack keys isolated, no client-side formula copy, shared primitives reused, a11y (aria-live, role=img, sr-only tables, keyboard, contrast).

### Test quality

- **High fidelity overall**: Testcontainers Postgres 15 + full AppModule + non-ADMIN JWT; exact-value assertions (350.5 / 55.1 / MEDIUM, threshold 250550, percentages 100±, trend/cohort exact rows); mocks mirror Prisma groupBy/aggregate shapes and Pothos/ReportChart behavior; assertions prove no-N+1 (4 calls/200 contacts), tenant isolation, P2002/P2034, mixed currency, permission gates, idempotency.
- **Gaps (minor)**: (a) average-denominator semantics only tested in all-calculated case (see Finding 2); (b) trend 90-vs-91-day boundary never asserted (see Finding 3); (c) task description content only asserted via fixture in tasks-automation spec, not from the real processor call (see Finding 1). No claim relies solely on implementation-aware mocks for security-critical behavior — tenant/permission/task idempotency all have real-DB integration coverage.
- Playwright E2E (`tests/e2e/customer-analytics.spec.ts`) intentionally absent — story Task 7 checkbox remains `[ ]` (Stage 9a scope), status honestly `in-progress`.

### Recommendation

**Proceed to Stage 9** (or optionally fix the 3 Minor items in a short fix loop — none blocks AC completion; all 18 ACs PASS, no Critical/Important findings, rules compliant). Story status and task checkboxes left untouched per review workflow.

---

## Review Findings (Stage 8 — Round 2, 2026-08-19)

> Stage 8 Round 2 fresh adversarial review by an independent reviewer (leaf executed Blind Hunter, Edge Case Hunter, Acceptance Auditor, Security Scanner, Test Quality Check itself, then dedupe/triage). Inputs: baseline `938c5a0`, `git diff 938c5a0` (40 files) + all 22 untracked Story 6.7 files read directly, the 18 binding ACs + Contract A–F from this story only, `docs/rules/*`. Dev Agent Record / Completion Notes / Round 1 findings were NOT consumed as evidence for any claim — the three Round 1 fixes were re-verified from source + tests + fresh test runs. Gate context (parent: API 5 suites / 112 tests exit 0, customer-analytics Testcontainers 10/10, touched API tsc/eslint/prettier) treated as background only; reviewer independently re-ran: `npx jest src/reports/__tests__/customer-analytics src/tasks/__tests__/tasks-automation.spec.ts` → **5 suites / 112 tests PASS exit 0** (API) and `npx jest customer-analytics` + `npx jest CustomerAnalyticsPage` → **4 suites / 38 tests PASS exit 0** (Web). No commit, no push; the only edit is this section.

### Verdict: FINDINGS (2 Minor — no Critical/Important). AC 18/18 PASS. Rules compliant. Recommend proceed to Stage 9.

### Round 1 fix verification (R1–R3) — ALL VERIFIED RESOLVED

1. **R1 — C21 task description (VERIFIED):** `CustomerAnalyticsProcessor.buildTaskDescription(churnRiskScore, lastActivity, contactId)` (`customer-analytics-processor.service.ts:491-503`) emits `score <1dp>`, full ISO UTC last-activity instant or literal `No activity recorded`, and intent `Open /contacts/<id> to re-engage the customer.` Values are threaded from the already-computed `processContact` results (`:287-296`) — no extra DB query, no secrets (score + timestamp + contact id only; the contact name lives in the contract-mandated title). No regression in task semantics: title/priority HIGH/status TODO/assignee owner/contactId/dealId null/dueDate snapshotDate+1d/automationKey `CHURN_RISK:<contactId>:<YYYY-MM-DD>` unchanged (`:460-470`); P2002 idempotency still tenant-scoped with no duplicate side effects (tasks-automation.spec.ts `returns the existing same-tenant task on P2002…`, asserts pubsub/notify/audit NOT re-fired); concurrent snapshot-link marker read/write still `{id, tenantId, deletedAt: null}` (`:441-444`, `:471-474`). Independent evidence: processor spec tests `states score, ISO last activity and /contacts/<id> intent…` + `uses 'No activity recorded'…` (`:327-375`), integration rerun test asserts `100.0` / `No activity recorded` / `/contacts/<contactB>` (`customer-analytics.integration.spec.ts:549-551`); re-ran suites green.

2. **R2 — summary average null-safe (VERIFIED):** `CustomerAnalyticsService.customerAnalytics` summary derives `averageLifetimeValue` from the bounded DB aggregate `_avg: { lifetimeValue: true }` (`customer-analytics.service.ts:254-259, 284-286`) — SQL AVG excludes NULL, so NOT_CALCULATED contacts never dilute the average and are never treated as zero; mixed currencies and zero-calculated both return `null` (never `0`). Independent evidence: service spec `averages LTV only over calculated customers — NOT_CALCULATED never counts as zero (D31, AC 10)` (350.5, not 175.25) + `returns null average (never 0) when no customer has calculated LTV`; integration `averages LTV only over calculated customers` with real DB (7 visible / 6 calculated, single USD → `averageLifetimeValue 225.08`, calculated-0 contacts B/F/G/H still in denominator). **Challenge outcome (total/distribution/current-row null-vs-zero):** current rows correct (`toCustomerItem` keeps `lifetimeValue: null` → UI em dash, `isHighLifetimeValue false`, `MONITOR`); distribution correct (no calculated → min/max null → `[]`; churn NOT_CALCULATED 100%); **total has one remaining 0-vs-null inconsistency — see new Finding 1 below.**

3. **R3 — exact 90-day trend window (VERIFIED):** `buildLtvTrend` start = `today - (TREND_DAYS - 1) * MS_PER_DAY` (today-89 … today inclusive, `endExclusive = today + 1` unchanged) — exactly 90 UTC snapshot calendar days (`customer-analytics.service.ts:502-507`). B11 engagement window `[snapshotDate-90d, end-of-snapshot-day]` intentionally NOT changed (that clause defines its own interval; processor `loadBatchAggregates` `:321-322` and `isQualifyingActivity` in score still use it). Independent evidence: service spec `covers exactly 90 snapshot days: today-89 … today, excluding today-90 (C24)` (start `2026-05-18T00:00:00.000Z`, today-90 `2026-05-17` excluded, exclusive span exactly 90 days); integration asserts trend days `['2026-08-13','2026-08-14','2026-08-15']` with no per-day double counting.

### Findings (deduped, actionable)

1. **[Minor][D31/E42/AC 10] `totalLifetimeValue` fabricates `0` when zero visible customers are calculated**
   - Location: `apps/api/src/reports/customer-analytics.service.ts:278-279` (`const rawTotal = aggregate._sum?.lifetimeValue ?? 0`; `const totalLifetimeValue = mixedCurrencies ? null : round2(rawTotal)`).
   - Contract: D31 (`totalLifetimeValue: number | null`), E42/security invariant 8 — null analytics must render "Not calculated", never a fabricated 0.
   - Expected: `totalLifetimeValue` null when no visible customer has a calculated LTV (same null semantics the R2 fix gave the average and the empty `ltvDistribution`), 0 only when ≥1 calculated customer exists (sum of real zeros/values).
   - Actual: when `calculatedCustomerCount === 0` (fresh tenant, no processor run yet) `_sum` is SQL-NULL → `?? 0` → summary shows Total LTV `0` while Average shows `—` and the analyzed-count card shows `0 / N`. A brand-new tenant sees a fabricated `0` — the one remaining inconsistency with the R2-fixed average and the "null ≠ 0" UI stance. Mixed-currency nulling works; only the zero-calculated case is wrong.
   - Test gap: service spec `returns null average (never 0)…` asserts only the average; no test pins the zero-calculated total.
   - Minimal fix: `const totalLifetimeValue = mixedCurrencies || calculatedCustomerCount === 0 ? null : round2(rawTotal)` (calculatedCustomerCount is already computed from the same filtered `where`; when ≥1 calculated, `_sum` is a real value and 0 stays correct for calculated-0 tenants) + one service-spec assertion (zero-calculated → total null) and one integration assertion if a zero-calculated tenant fixture is cheap.
   - **Resolution (Stage 8 Fix Loop 3, 2026-08-19):** `totalLifetimeValue` now returns `null` when `mixedCurrencies` OR `calculatedCustomerCount === 0` — the raw SQL SUM normalization (`?? 0`) is kept only for the actual-calculated-zero case (with ≥1 calculated contact the SUM is a real value, so a genuine 0 stays numeric 0). No value is fabricated before processor materialization; average/empty-distribution/trend semantics unchanged. RED→GREEN: service spec +2 tests (extended zero-calculated test now asserts total `null` — RED failure was received `0`; new pin test asserts one calculated-zero contact → total `0`) and integration +1 test (no processor run + soft-deleted D → single USD, 0 calculated → total null) — see Dev Agent Record → Stage 8 Fix Loop 3.

2. **[Minor][C20] Batch/tenant aggregate failure leaves the batch's contacts unaccounted in the processor summary**
   - Location: `apps/api/src/reports/customer-analytics-processor.service.ts:128-140` (per-tenant catch in `runDailyProcessing`) and `:166-197` (`processTenant` — no per-batch try/catch around `loadBatchAggregates`).
   - Contract: C20 — batch failures must be logged with tenant/batch identifiers and processing must continue; the summary must report contacts succeeded/failed for ops observation.
   - Expected: contacts whose batch failed to load aggregates are reflected in `contactsFailed` (or a dedicated batch-failure counter), so the summary never implies a clean run.
   - Actual: when `contact.findMany` or `loadBatchAggregates` throws, the whole tenant aborts to the `runDailyProcessing` catch (logged with tenant id, no PII — that part is correct) and continues to the next tenant, but those contacts are counted neither in `contactsSucceeded` nor `contactsFailed`. A run that failed mid-tenant can return `contactsFailed: 0`. The processor spec `logs a tenant failure and continues…` (`:505-518`) asserts only `contactsSucceeded 0` and never asserts the failed count — confirming the gap.
   - Minimal fix (optional): in `processTenant`, wrap the aggregate load per batch (`try { aggregates = await loadBatchAggregates… } catch { summary.contactsFailed += contacts.length; logger.error(tenant+batch ids, no PII); return }`), or accept and document that `contactsFailed` counts only per-contact failures.
   - **Resolution (Stage 8 Fix Loop 3, 2026-08-19):** `processTenant` now wraps `loadBatchAggregates` per contact batch. On failure: `summary.contactsFailed += contacts.length`, logs `Customer analytics batch failed [tenant=<id>, offset=<n>, count=<n>]: <message>` (tenant id + deterministic batch metadata, never contact ids/names/PII), advances the offset by `contacts.length` and continues with the next batch; the failed batch's contacts are never processed per-contact (no double counting). `contact.findMany` failures keep the outer tenant catch (the batch size is unknown, so those contacts cannot be counted). RED→GREEN: processor spec +2 tests (batchSize=2, 4 contacts: first batch aggregate fails → failed=2 / succeeded=2 / upsert×2 / error log contains tenant + offset=0 + count=2 without PII; every batch fails → failed=4, no false success) — see Dev Agent Record → Stage 8 Fix Loop 3.

### Observations (no action required)

- **a11y nit (E44/WCAG 4.1.2):** the "Khoảng LTV" label (`CustomerAnalyticsPage.tsx:502`) has no `htmlFor` and the Min/Max inputs (`:504-520`) have no `aria-label`/`id` — the accessible name falls back to the `placeholder` ("Min"/"Max"), which works in current browsers but is fragile. One-line fix if desired: `htmlFor="filter-min-ltv"` + `id="filter-min-ltv"` (same for max). Not a finding — all other filters are properly labeled and Round 1 a11y coverage stands.
  - **Resolution (Stage 8 parent hardening, 2026-08-19):** added stable `filter-min-ltv` / `filter-max-ltv` IDs with explicit sr-only labels (`LTV tối thiểu` / `LTV tối đa`). TDD evidence: the updated RTL role/name assertion failed before production change, then `CustomerAnalyticsPage.spec.tsx` passed 14/14; Web type-check, touched ESLint and Prettier checks exited 0.
- **Summary counters in concurrency:** two concurrent processor instances that both create the same task each increment `tasksCreated` (P2002 dedupe returns the existing task); task rows are correct — only the summary over-counts. Same class as Finding 2, logged for awareness.

### Acceptance Criteria matrix (18/18 PASS)

| # | AC | Verdict | Source + Test evidence (independently inspected) |
| --- | --- | --- | --- |
| 1 | Contact + Deal mgmt implemented (Epics 2/3) | PASS | Shipped modules untouched by the delta; regression integration suites green (gate) |
| 2 | Implement CLV + churn risk analysis | PASS | score/processor/service/graphql/frontend present and wired (module + barrel + route) |
| 3 | Contact extended: lifetimeValue, churnRisk, lastActivityDate | PASS | schema.prisma:391-399 (+5 nullable fields) + migration.sql:14-18 additive, nullable; absent from Create/UpdateContactInput (contacts.graphql.ts untouched); processor materializes |
| 4 | LTV = sum of closed-won deal values | PASS | customer-analytics-score.ts:96-101 (stage `isWon` only); processor deal groupBy `stage: {isWon: true, deletedAt: null}`; integration exact 350.5 |
| 5 | Churn factors inactivity 40% / win rate 30% / engagement 30% | PASS | CHURN_WEIGHTS `0.4/0.3/0.3` + calculateChurnRiskScore; score spec |
| 6 | Categories LOW<30, MEDIUM 30–70, HIGH>70 | PASS | categorizeChurnRisk; score spec exact boundaries (29.9/30/70/70.1) |
| 7 | GraphQL customerAnalytics(filters) | PASS | customer-analytics.graphql.ts query + SDL spec (query/enums/inputs/closed-input rejection) + integration non-ADMIN execution |
| 8 | Daily background recalc | PASS | `@Cron('0 0 2 * * *')` processor; processor spec cron-metadata test; integration rerun idempotency |
| 9 | Frontend /reports/customer-analytics page | PASS | thin route + CustomerAnalyticsPage + route/nav/breadcrumb specs |
| 10 | Dashboard: total/average LTV, LTV distribution, churn distribution | PASS | 4 metric cards + 2 charts; RTL + integration exact values (Finding 1 is Minor: zero-calculated total shows 0 — does not fail AC 10) |
| 11 | Filters: LTV range, risk level, last activity date | PASS | validateFilter + applyAnalyticsFilters; integration filter test (LTV/risk/last-activity/search/ownerId) |
| 12 | List: name, LTV, badge, last activity, recommended action | PASS | table + getChurnRiskBadgeDetails + RTL exact labels/links |
| 13 | Recommended actions exact | PASS | recommendedActionFor + integration (Schedule follow-up / Upsell opportunity / Monitor, precedence tests) |
| 14 | HIGH → automated task for account manager | PASS | maybeCreateChurnTask + createAutomatedTask; P2002 tenant-scoped idempotent; integration: exact fields/key/due/TASK_ASSIGNED notification, rerun no-dup, sustained-HIGH 1 task, HIGH→LOW→HIGH 2 tasks, inactive owner safe fail |
| 15 | Historical LTV tracking (trend) | PASS | snapshot model + buildLtvTrend (exactly 90 days) + trend chart/RTL |
| 16 | Cohort analysis by acquisition date | PASS | acquisitionCohort YYYY-MM + buildCohorts (visible-scoped latest day, ascending) + cohort chart/RTL + integration |
| 17 | Unit tests cover LTV + churn logic | PASS | score spec F1–F28 + processor/service/graphql/tasks-automation specs — reviewer re-ran 5 suites / 112 tests exit 0 |
| 18 | Integration tests verify analytics accuracy | PASS | Testcontainers Postgres 15 + real AppModule, non-ADMIN: exact CLV/score/category/snapshot fields, visibility own/ALL, cross-tenant + soft-delete negatives, permission denial (REPORT/CONTACT/DEAL), stable pagination (3 pages, 8 unique, nulls-last), rerun/task idempotency |

### Adversarial checks — all clean (no additional findings)

- **Tenant/soft-delete/visibility:** every DB access in the delta carries `tenantId`; contact/deal/snapshot reads filter `deletedAt: null`; Activity is append-only (no deletedAt column — no filter needed); snapshot child visibility always via `contact: visibleWhere` (F2 fix verified in both trend and cohort); threshold from the UNFILTERED visible predicate (`resolveHighLtvThreshold`); no ID-only DML (F3 fix verified in processor spec `tenant-scoped DML — exact where clauses` x3).
- **Bounded/no-N+1:** processor = 4 fixed groupBy aggregates per contact batch (spec asserts exactly 4 calls for a 200-contact batch); service = bounded count/aggregate/groupBy + ≤5 bin counts + ≤2 p75 order-statistic rows (parity with full-set Tukey hinges locked for n=0..1000 in score spec); pagination pageSize max 100 (integration asserts clamp); no full-set materialization anywhere.
- **P2034/P2002 races:** P2034 bounded retry (3 attempts, exhaustion → contactsFailed, spec x2); snapshot upsert on `(tenantId, contactId, snapshotDate)`; task P2002 → tenant-scoped existing task returned with NO duplicate side effects (spec); concurrent instances converge on one task + one snapshot/day.
- **HIGH transitions:** first-run (no prev) creates; sustained HIGH blocked even if old task completed/deleted; HIGH→LOW→HIGH creates a new task; inactive owner → snapshot saved + taskFailures logged, never reassigned (integration).
- **Currency/no-FX:** no FX anywhere; raw-sum LTV per binding; total/average null when mixed; breakdown ISO-sorted; UI neutral formatting + persistent warning + per-currency chips; single non-USD (EUR) formats with EUR/€ + `(EUR)` suffix (RTL); chart semantic tables neutral.
- **Pothos/permissions/select parity:** refs typed from service shapes; `CUSTOMER_ITEM_SELECT` ⊇ every exposed field; enums from const tuples; closed inputs (SDL spec rejects `where`/`sort` unknown keys); gates REPORT+CONTACT+DEAL (SDL spec asserts all three called; ADMIN bypass in requirePermission; integration uses non-ADMIN only); barrel import + `ReportsModule.onModuleInit()` registration; Contact ref NOT extended (no contact-list weight).
- **Migration parity:** hand-written additive SQL matches schema 1:1 (5 Contact columns + 3 indexes, Task automation fields + unique, snapshot table + 5 indexes + 3 FKs in FK-safe order); no backfill; TRUNCATE lists updated in all 27 integration specs (products F4 pattern verified: snapshot truncated once at front, original lists restored).
- **Frontend:** query keys rooted at `['customerAnalytics']` covering all filters/pagination; no permission-denied flash (skeleton gate + `enabled: hasAccess`); invalid/non-finite ranges blocked client-side and server-side; filter change resets page 1; null analytics → em dash / Not calculated / NOT_CALCULATED; 4 charts with always-present sr-only semantic tables and no fake toggles; touch targets ≥44px; 320px honest RTL test; links exact `/contacts/<id>`; breadcrumb key-collision fix verified.
- **Negative constraints:** no new dependency (no package manifests in diff), no Prisma upgrade, no Account/Customer/AI/FX/Redis/queue, no public automation fields (taskListSelect excludes automationSource/automationKey; CreateTaskInput/UpdateTaskInput untouched), no client-writable calculated fields.

### Rules compliance

- **naming-conventions**: PASS — kebab-case files (`customer-analytics-score.ts`, `customer-analytics.service.ts`, `customer-analytics.graphql.ts`), PascalCase component, const tuples over enums.
- **typescript-rules**: PASS — no `any`/`@ts-ignore`, explicit return types, strict-mode clean (gate tsc exit 0); the single `as unknown as ActivityType[]` cast is a bounded Prisma-enum-array bridge, not an `any`.
- **nestjs-rules**: PASS — constructor DI, `@Optional` injectable clock/batch/concurrency for tests, module registration order preserved (`ReportsModule` before `AppGraphqlModule`), Logger-based error surfacing.
- **prisma-rules**: PASS — tenantId on every query, indexes match filter/sort paths, batch/aggregate instead of N+1, parameterized, additive hand-written migration, Testcontainers integration.
- **react-nextjs-rules**: PASS — isolated TanStack keys, no client-side formula copy, shared primitives (ReportChart/LoadingSkeleton/ErrorState/EmptyState/ResponsiveTableWrapper), a11y (aria-live polite, role=alert warning, sr-only captions/semantic tables, keyboard-visible focus, text+color badges, 44px targets, 320px).

### Test quality

- **High fidelity**: Testcontainers Postgres 15 + full AppModule + non-ADMIN JWTs; exact-value assertions (350.5 / 55.1 / MEDIUM, threshold 250550, average 225.08, percentages 100±, trend/cohort exact rows, stable pagination 3×3 no dup/skip); mocks mirror Prisma groupBy/aggregate shapes; no-N+1 (4 calls/200 contacts), P2034/P2002, tenant isolation, mixed currency, permission gates, task idempotency all covered.
- **Gaps (minor, mapped to findings):** (a) zero-calculated `totalLifetimeValue` (Finding 1), (b) tenant-level aggregate-failure summary accounting (Finding 2), and (c) LTV min/max programmatic labels were identified in Round 2 and resolved by the subsequent TDD hardening loops. No security-critical behavior relies solely on implementation-aware mocks — tenant/permission/task idempotency all have real-DB integration coverage.
- Playwright E2E (`tests/e2e/customer-analytics.spec.ts`) intentionally absent — story Task 7 checkbox remains `[ ]` (Stage 9 scope), status honestly `in-progress`. Not code drift.

### Recommendation

**Proceed to Stage 9** — Round 1 findings R1–R3 are verified resolved (independent re-run: API 5 suites / 112 tests, Web 4 suites / 38 tests, all exit 0); 18/18 AC implementation passes; no Critical/Important findings. The 2 new Minor findings are non-blocking: Finding 1 is a one-line null-vs-zero consistency fix with an added assertion, Finding 2 an optional summary-accounting improvement — either can ride along in the Stage 9 loop or be deferred to a follow-up. Playwright/dogfood evidence remains the open Stage 9 item. Story status and task checkboxes left untouched per review workflow.
---

## Review Findings (Stage 8 — Round 3, 2026-08-19)

> Stage 8 Round 3 fresh adversarial review by an independent reviewer (leaf executed Blind Hunter, Edge Case Hunter, Acceptance Auditor, Security Scanner, Test Quality Check, rules compliance, dedupe/triage itself). Inputs: baseline `938c5a0`, `git diff 938c5a0` (40 tracked files) + all untracked Story 6.7 files read directly (live source AND tests), the 18 binding ACs + Contract A–F from this story only, `docs/rules/*`. Dev Agent Record / Completion Notes / Round 1–2 findings were NOT consumed as evidence — every prior fix was re-verified from live source + tests. Reviewer independently re-ran the focused backend suites (`npx jest src/reports/__tests__/customer-analytics src/tasks/__tests__/tasks-automation.spec.ts` → **5 suites / 115 tests PASS, exit 0**) and the a11y-harden spec (`npx jest CustomerAnalyticsPage` → **14/14 PASS, exit 0**). Parent gate context (Testcontainers 11/11, API/Web type-check/eslint/prettier/build exit 0) treated as background only. No commit, no push; the only edit is this section.

### Verdict: CLEAN — no actionable Critical/Important/Minor drift. AC 18/18 PASS. Rules compliant. Recommend proceed to Stage 9.

### Prior fix verification (Round 1–3 backend + parent a11y) — ALL VERIFIED RESOLVED

1. **R1 — C21 task description (VERIFIED):** `CustomerAnalyticsProcessor.buildTaskDescription(churnRiskScore, lastActivity, contactId)` (`customer-analytics-processor.service.ts:508-520`) emits score to 1 decimal, full ISO UTC last-activity instant or literal `No activity recorded`, and intent `Open /contacts/<id> to re-engage the customer.` Values threaded from already-computed `processContact` results (`:304-313`) — no extra DB query, no secrets (score + timestamp + contact id; the contact name stays in the contract-mandated title). Title/priority HIGH/status TODO/assignee owner/contactId/dealId null/dueDate snapshotDate+1d/automationKey `CHURN_RISK:<contactId>:<YYYY-MM-DD>` unchanged (`:476-487`); P2002 idempotency still tenant-scoped with no duplicate side effects (tasks-automation.spec.ts:203-226 asserts pubsub/notify/audit NOT re-fired). Independent evidence: processor spec `states score, ISO last activity and /contacts/<id> intent…` + `uses 'No activity recorded'…` (`:327-375`); integration rerun test asserts `100.0` / `No activity recorded` / `/contacts/<contactB>` (`customer-analytics.integration.spec.ts:549-551`); re-ran suites green.

2. **R2 — summary average null-safe via DB AVG (VERIFIED):** `averageLifetimeValue` derives from the bounded DB aggregate `_avg: { lifetimeValue: true }` added to the existing contact aggregate (`customer-analytics.service.ts:254-259, 290-292`) — SQL AVG excludes NULL, so NOT_CALCULATED contacts never dilute the average and are never treated as zero. Mixed currencies and zero-calculated both return `null`, never `0`. Independent evidence: service spec `averages LTV only over calculated customers — NOT_CALCULATED never counts as zero` (350.5, not 175.25) + `returns null average (never 0) when no customer has calculated LTV` (`:301-347`); integration `averages LTV only over calculated customers` (7 visible / 6 calculated, single USD → `averageLifetimeValue 225.08`, calculated-0 contacts B/F/G/H still in the denominator) (`:591-621`).

3. **R3 — exact 90 UTC trend days (VERIFIED):** `buildLtvTrend` start = `today - (TREND_DAYS - 1) * MS_PER_DAY` (today-89 … today inclusive; `endExclusive = today + 1` unchanged) — exactly 90 UTC snapshot calendar days (`customer-analytics.service.ts:512-513`). B11 engagement window `[snapshotDate-90d, end-of-snapshot-day]` intentionally unchanged (that clause defines its own interval; score `isQualifyingActivity` + processor `windowStart` `:338-339` still use it). Independent evidence: service spec `covers exactly 90 snapshot days: today-89 … today, excluding today-90 (C24)` (`:513`); integration trend days `['2026-08-13','2026-08-14','2026-08-15']` with per-day customerCount and no double counting (`:693-705`).

4. **R2-F1 — total null when zero calculated, numeric 0 for calculated-zero (VERIFIED):** `totalLifetimeValue = mixedCurrencies || calculatedCustomerCount === 0 ? null : round2(rawTotal)` (`customer-analytics.service.ts:284-285`) — the `?? 0` normalization is kept ONLY for the actual-calculated-zero case (with ≥1 calculated contact the SQL SUM is a real value). Independent evidence: service spec extended zero-calculated test asserts total `null` (`:324-347`) + pin test `keeps 0 total when a calculated customer truly has LTV 0 (R2-F1)` (`:349-371`); integration `returns null total (never 0) when no customer has calculated LTV` with real PostgreSQL (`:623-641`).

5. **R2-F2 — batch aggregate failure accounting (VERIFIED):** `processTenant` wraps `loadBatchAggregates` per contact batch (`:192-204`): on failure `summary.contactsFailed += contacts.length`, log `Customer analytics batch failed [tenant=<id>, offset=<n>, count=<n>]: <message>` (tenant id + deterministic batch metadata, never contact ids/names/PII), `offset += contacts.length`, `continue` to the next batch; the failed batch's contacts are never processed per-contact (no double counting). `contact.findMany` failures keep the outer tenant catch (batch size unknown — unloaded contacts cannot be counted). Independent evidence: processor spec `counts a failed aggregate batch in contactsFailed and continues to later batches` (failed 2 / succeeded 2 / upsert×2 / error log contains tenant + `offset=0` + `count=2`, no `c1` / `@test.local`) (`:520-576`) + `reports the failed count when every aggregate batch fails — no false success` (failed 4, zero upserts) (`:578-600`).

6. **Parent a11y hardening — Min/Max LTV stable IDs + explicit programmatic labels (VERIFIED):** `CustomerAnalyticsPage.tsx:504-528` — `filter-min-ltv` / `filter-max-ltv` IDs with explicit sr-only `<label htmlFor>` `LTV tối thiểu` / `LTV tối đa`; the accessible name no longer falls back to the placeholder. Independent evidence: RTL spec asserts `getByRole('textbox', { name: 'LTV tối thiểu' })` / `{ name: 'LTV tối đa' }` and `toHaveAttribute('id', 'filter-min-ltv' / 'filter-max-ltv')` (`CustomerAnalyticsPage.spec.tsx:387-402`); reviewer re-ran the spec → **14/14 PASS, exit 0**.

### Challenge resolution — concurrent `tasksCreated` over-count (Round 2 observation) → NOT a finding (non-contractual observation)

- **Return shape:** `TasksService.createAutomatedTask` returns `TaskListItem`; on P2002 it returns the existing same-tenant task with the identical shape (`tasks.service.ts:501-511`) — **the current return shape CANNOT distinguish create vs existing** (no flag, no wrapper).
- **Contract reading (C20):** the concurrent-instance clause is explicitly data-level — "Daily rerun/concurrent instances phải tạo cùng current values/snapshot và không tạo duplicate task" — satisfied (unique snapshot upsert + P2002 dedupe; integration-verified: second run `tasksCreated 0`, sustained HIGH → 1 task). The summary clause requires the summary to *expose* `tenants/contactsSucceeded/contactsFailed/tasksCreated` for test/ops observation — it does; it does NOT require an exact per-instance created count under multi-replica cron overlap. Single-instance rerun is already exact: the snapshot `churnPreventionTaskId` marker check (`:458-462`) prevents re-creation before `createAutomatedTask` is called. A truly concurrent double-count requires ≥2 deployed API replicas both firing the 02:00 UTC cron — outside the contract's stated data guarantees.
- **Verdict (per instruction "report only if contract requires accurate created count and a minimal safe fix exists"):** the contract does NOT require it → observation only, no finding. A minimal safe fix exists if ever wanted (return `{ task, created: boolean }` from `createAutomatedTask`, increment `tasksCreated` only when `created === true`, adjust the processor call site + one spec assertion) — not required to satisfy any binding statement.

### New adversarial sweep (entire Story delta, not only fixes) — all clean

- **Tenant/soft-delete/visibility:** every DB access in the delta carries `tenantId`; contact/deal/snapshot reads filter `deletedAt: null`; Activity is append-only (no deletedAt column — no filter needed); snapshot child visibility always via `contact: visibleWhere` in trend + cohort + cohort latest-day aggregate (F2 fix re-verified); high-LTV threshold from the UNFILTERED visible predicate; no ID-only DML (F3 spec tests x3 re-verified).
- **Bounded/no-N+1:** processor = 4 fixed groupBy aggregates per contact batch (spec asserts exactly 4 calls / 200 contacts); service = bounded count/aggregate/groupBy + ≤5 LTV bins + ≤2 p75 order-statistic rows (parity with full-set Tukey hinges locked n=0..1000 in score spec); pagination pageSize max 100 (integration asserts clamp); no full-set materialization anywhere.
- **P2034/P2002 races & HIGH transitions:** P2034 bounded retry (3 attempts, exhaustion → contactsFailed, spec x2); snapshot upsert on `(tenantId, contactId, snapshotDate)`; task P2002 → same-tenant existing task with NO duplicate side effects (spec); first-run / sustained-HIGH / HIGH→LOW→HIGH / inactive-owner all integration-tested (F → 2 tasks, G → 1, H → 0 + snapshot saved, TASK_ASSIGNED notification present).
- **p75 parity/bounded threshold:** `p75OrderStatisticIndices` ≤2 indices; parity test n=0..1000; threshold from the visible positive set only; UI analytics filters never reach the threshold query (service spec).
- **Stable pagination:** orderBy risk score desc (nulls last) → LTV desc → id asc; integration 3 pages × pageSize 3 → 8 unique ids, null-risk contact last, no dup/skip; pageSize clamped to 100.
- **Mixed currency/no FX/null semantics:** no FX anywhere; raw-sum LTV per binding; total/average null when mixed; breakdown ISO-sorted; UI neutral formatting + persistent `role="alert"` warning + per-currency chips; single non-USD (EUR) formats with EUR/€ + `(EUR)` suffix (RTL); chart semantic tables neutral; null analytics → em dash / `Not calculated` / NOT_CALCULATED everywhere (never 0/LOW).
- **GraphQL permission/type/ref/select parity:** refs typed from service shapes; `CUSTOMER_ITEM_SELECT` ⊇ every exposed field; enums from const tuples (SDL sync test); closed inputs (SDL rejects `where`/`sort`); gates REPORT+CONTACT+DEAL (SDL spec asserts all three; integration non-ADMIN denials for each missing permission); barrel import + `ReportsModule.onModuleInit()` registration; Contact ref NOT extended (no contact-list weight, no select drift).
- **Migration/schema parity:** hand-written additive SQL matches schema 1:1 (5 Contact columns + 3 indexes; Task 2 columns + unique `[tenantId, automationKey]` with NULL-keys never colliding; snapshot table + 5 indexes + 3 FKs in FK-safe order); no backfill; TRUNCATE lists updated across all integration specs (products pattern: snapshot truncated once at front); `migrate diff` 0 drift.
- **Frontend:** permission loading gate (skeleton + `enabled: hasAccess`, no permission-denied flash); query keys rooted `['customerAnalytics']` covering all filters/pagination; non-finite/range validation blocks query client-side (lib + RTL); filter change resets page 1; all 4 charts with always-present sr-only semantic tables (`hideSrTable=false` default) and no fake toggles; touch targets ≥44px; 320px honest RTL (no fixed min-width, flex-wrap, `overflow-x-auto` wrapper, keyboard focus asserted); exact badges (`Low/Medium/High/Not calculated`), links `/contacts/<id>`, action labels exact; breadcrumb duplicate-key fix verified.
- **Test fidelity:** Testcontainers Postgres 15 + real AppModule + non-ADMIN JWTs; exact-value assertions (350.5 / 55.1 / MEDIUM / 225.08 / 250550 / percentages 100± / trend & cohort exact rows / stable pagination); mocks mirror Prisma groupBy/aggregate shapes; no-N+1 (4 calls/200 contacts), P2034/P2002, tenant isolation, mixed currency, permission gates, task idempotency all covered; no security-critical claim rests on implementation-aware mocks alone — tenant/permission/task idempotency all have real-DB integration coverage.
- **Negative constraints:** no new dependency (no package manifest/lockfile in diff), no Prisma upgrade, no Account/Customer/AI/FX/Redis/queue, no public automation fields (CreateTaskInput/UpdateTaskInput untouched; taskListSelect excludes automationSource/automationKey), no client-writable calculated fields (Create/UpdateContactInput untouched), no chart library added (ReportChart reused).

### Acceptance Criteria matrix (18/18 PASS)

| # | AC | Verdict | Source + Test evidence (independently inspected) |
| --- | --- | --- | --- |
| 1 | Contact + Deal mgmt implemented (Epics 2/3) | PASS | Shipped modules untouched by the delta; regression integration suites green (gate) |
| 2 | Implement CLV + churn risk analysis | PASS | score/processor/service/graphql/frontend present and wired (module + barrel + route) |
| 3 | Contact extended: lifetimeValue, churnRisk, lastActivityDate | PASS | schema.prisma +5 nullable server-owned fields (lifetimeValue, churnRisk, churnRiskScore, lastActivityDate, analyticsCalculatedAt); absent from Create/UpdateContactInput; processor materializes current + snapshot |
| 4 | LTV = sum of closed-won deal values | PASS | customer-analytics-score.ts:96-101 (stage `isWon` only); processor deal groupBy `stage: { isWon: true, deletedAt: null }`; integration exact 350.5 |
| 5 | Churn factors inactivity 40% / win rate 30% / engagement 30% | PASS | CHURN_WEIGHTS 0.4/0.3/0.3 + calculateChurnRiskScore; score spec F14 |
| 6 | Categories LOW<30, MEDIUM 30–70, HIGH>70 | PASS | categorizeChurnRisk; score spec exact boundaries 29.9/30/70/70.1 |
| 7 | GraphQL customerAnalytics(filters) | PASS | customer-analytics.graphql.ts query + SDL spec (query/enums/inputs/closed-input rejection) + integration non-ADMIN execution |
| 8 | Daily background recalc | PASS | `@Cron('0 0 2 * * *')` processor; processor spec cron-metadata test; integration rerun idempotency |
| 9 | Frontend /reports/customer-analytics page | PASS | thin route + CustomerAnalyticsPage + route/nav/breadcrumb specs |
| 10 | Dashboard: total/average LTV, LTV distribution, churn distribution | PASS | 4 metric cards + 2 charts; RTL + integration exact values (total/average null-safe semantics verified, R2/R2-F1) |
| 11 | Filters: LTV range, risk level, last activity date | PASS | validateFilter + applyAnalyticsFilters; integration filter test (LTV/risk/last-activity/search/ownerId) |
| 12 | List: name, LTV, badge, last activity, recommended action | PASS | table + getChurnRiskBadgeDetails + RTL exact labels/links |
| 13 | Recommended actions exact | PASS | recommendedActionFor + integration (Schedule follow-up / Upsell opportunity / Monitor, precedence tests) |
| 14 | HIGH → automated task for account manager | PASS | maybeCreateChurnTask + createAutomatedTask; P2002 tenant-scoped idempotent; integration: exact fields/key/due/description/TASK_ASSIGNED notification, rerun no-dup, sustained-HIGH 1 task, HIGH→LOW→HIGH 2 tasks, inactive owner safe fail |
| 15 | Historical LTV tracking (trend) | PASS | snapshot model + buildLtvTrend (exactly 90 days) + trend chart/RTL |
| 16 | Cohort analysis by acquisition date | PASS | acquisitionCohort YYYY-MM + buildCohorts (visible-scoped latest day, ascending) + cohort chart/RTL + integration |
| 17 | Unit tests cover LTV + churn logic | PASS | score spec 44 tests (F1–F28 incl. boundaries/p75 parity) + processor/service/graphql/tasks-automation specs — reviewer re-ran 5 suites / 115 tests exit 0 |
| 18 | Integration tests verify analytics accuracy | PASS | Testcontainers Postgres 15 + real AppModule, non-ADMIN: exact CLV/score/category/snapshot fields, visibility own/ALL, cross-tenant + soft-delete negatives, permission denial (REPORT/CONTACT/DEAL), stable pagination (3 pages, 8 unique, nulls-last), rerun/task idempotency, average 225.08, null total |

### Rules compliance

- **naming-conventions**: PASS — kebab-case files (`customer-analytics-score.ts`, `customer-analytics.service.ts`, `customer-analytics.graphql.ts`, route folder), PascalCase component, const tuples over enums.
- **typescript-rules**: PASS — no `any`/`@ts-ignore`, explicit return types, strict-mode clean (gate tsc exit 0); the single `as unknown as ActivityType[]` cast is a bounded Prisma-enum-array bridge, not an `any`.
- **nestjs-rules**: PASS — constructor DI, `@Optional` injectable clock/batch/concurrency/retry for tests, module registration order preserved (`ReportsModule` before `AppGraphqlModule`), Logger-based error surfacing, cron metadata test.
- **prisma-rules**: PASS — tenantId on every query, indexes match filter/sort paths, batch/aggregate instead of N+1, parameterized, additive hand-written migration (FK order), Testcontainers integration.
- **react-nextjs-rules**: PASS — isolated TanStack keys, no client-side formula copy, shared primitives (ReportChart/LoadingSkeleton/ErrorState/EmptyState/PermissionLimitedState/ResponsiveTableWrapper), a11y (aria-live polite, role=alert warning, sr-only labels + semantic tables, keyboard-visible focus, text+color badges, 44px targets, 320px).

### Test quality

- **High fidelity**: Testcontainers Postgres 15 + full AppModule + non-ADMIN JWTs; exact-value assertions (350.5 / 55.1 / MEDIUM, threshold 250550, average 225.08, percentages 100±, trend/cohort exact rows, stable pagination 3×3 no dup/skip); mocks mirror Prisma groupBy/aggregate shapes; no-N+1 (4 calls/200 contacts), P2034/P2002, tenant isolation, mixed currency, permission gates, task idempotency all covered. Independent reviewer re-runs: backend **5 suites / 115 tests exit 0**, web **CustomerAnalyticsPage 14/14 exit 0**.
- **Gaps (none actionable):** all Round 1–3 findings (R1/R2/R3/R2-F1/R2-F2) and the Round 2 a11y nit are now locked by dedicated RED→GREEN unit tests plus real-DB integration assertions. No security-critical behavior relies solely on implementation-aware mocks — tenant/permission/task idempotency all have real-DB integration coverage.
- Playwright E2E (`tests/e2e/customer-analytics.spec.ts`) intentionally absent — story Task 7 checkbox remains `[ ]` (Stage 9a scope), status honestly `in-progress`. Not code drift.

### Observations (no action required)

- **tasksCreated under multi-replica concurrency** (see Challenge resolution above): `createAutomatedTask`'s return shape cannot distinguish created vs existing, so the summary counter can over-count only when ≥2 API replicas run the same 02:00 UTC cron simultaneously. Data always converges (one task, one snapshot/contact/day). Non-contractual (C20's concurrent clause is data-level); minimal fix (return `{ task, created }`) available if ops-level exactness is ever desired.

### Recommendation

**Proceed to Stage 9** — CLEAN. All prior backend findings (R1/R2/R3/R2-F1/R2-F2) and the parent a11y hardening are verified resolved from source + tests with independent targeted re-runs (API 5 suites / 115 tests, Web CustomerAnalyticsPage 14/14, all exit 0); 18/18 AC implementation passes; no Critical/Important/Minor findings; rules compliant. The one remaining observation (concurrent `tasksCreated` counter) is non-contractual and does not block. Playwright/dogfood evidence remains the open Stage 9 item. Story status and task checkboxes left untouched per review workflow.
