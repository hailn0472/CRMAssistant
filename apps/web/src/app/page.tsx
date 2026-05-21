import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Command,
  KanbanSquare,
  RadioTower,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'

const focusItems = [
  {
    title: 'CloudTech migration concern',
    meta: 'Enterprise deal · $85K · due today',
    status: 'High impact',
    tone: 'cyan',
  },
  {
    title: 'Acme proposal stale for 14 days',
    meta: 'Proposal stage · Sarah Nguyen · no activity',
    status: 'At risk',
    tone: 'amber',
  },
  {
    title: '5 imported contacts need merge review',
    meta: 'Tech Summit batch · duplicate confidence 92%',
    status: 'Clean data',
    tone: 'violet',
  },
]

const pipelineStages = [
  { label: 'Qualified', value: '$120K', height: 'h-24', color: 'bg-cyan-300' },
  { label: 'Proposal', value: '$185K', height: 'h-36', color: 'bg-indigo-400' },
  { label: 'Negotiation', value: '$95K', height: 'h-44', color: 'bg-violet-400' },
  { label: 'Risk', value: '$50K', height: 'h-28', color: 'bg-amber-300' },
]

const timelineEvents = [
  'Demo call completed with CloudTech CTO',
  'Pricing deck opened 3 times by Acme',
  'AI detected 2 enterprise deals likely to slip',
]

function getToneClasses(tone: string): string {
  const tones: Record<string, string> = {
    amber: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
    cyan: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100',
    violet: 'border-violet-300/20 bg-violet-300/10 text-violet-100',
  }

  return tones[tone] ?? tones.cyan
}

export default function Home(): React.JSX.Element {
  return (
    <main className="crm-mesh crm-noise min-h-screen overflow-hidden text-white">
      <div className="relative mx-auto flex min-h-screen max-w-[1500px] gap-5 px-5 py-5">
        <aside className="crm-glass hidden w-[88px] shrink-0 rounded-[2rem] p-4 lg:block">
          <div className="mb-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-indigo-400 to-violet-500 shadow-2xl shadow-indigo-500/30">
            <BriefcaseBusiness className="h-6 w-6 text-slate-950" />
          </div>
          <nav className="space-y-4 text-slate-400">
            {[Command, KanbanSquare, UsersRound, Activity, Bot, ShieldCheck].map((Icon, index) => (
              <button
                aria-label={`Navigation item ${index + 1}`}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl transition hover:bg-white/10 hover:text-white ${
                  index === 0 ? 'bg-white/15 text-white' : ''
                }`}
                key={Icon.name}
                type="button"
              >
                <Icon className="h-5 w-5" />
              </button>
            ))}
          </nav>
        </aside>

        <section className="crm-glass flex-1 rounded-[2rem] p-5 sm:p-7">
          <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200">
                CRMAssistant Command Center
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.06em] sm:text-7xl">
                  Start the day from signal, not noise.
                </h1>
                <span className="mb-3 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                  Live CRM pulse
                </span>
              </div>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
                Một role-based cockpit cho sales teams: next actions, deal risk, customer timeline
                và AI insight trong cùng một workspace hiện đại.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-3">
              <div className="flex min-w-72 items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-sm text-slate-300">
                <Search className="h-4 w-4" />
                <span className="flex-1">Search contacts, deals, reports...</span>
                <kbd className="rounded-lg bg-white/10 px-2 py-1 text-[10px] text-slate-400">
                  ⌘K
                </kbd>
              </div>
            </div>
          </header>

          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              accent="from-cyan-300 to-blue-400"
              icon={<CircleDollarSign className="h-5 w-5" />}
              label="Pipeline value"
              sublabel="Forecast +12% this week"
              value="$450K"
            />
            <MetricCard
              accent="from-amber-300 to-orange-400"
              icon={<AlertTriangle className="h-5 w-5" />}
              label="At-risk deals"
              sublabel="2 need action today"
              value="5"
            />
            <MetricCard
              accent="from-violet-300 to-fuchsia-400"
              icon={<Sparkles className="h-5 w-5" />}
              label="AI signals"
              sublabel="Validated from CRM data"
              value="3"
            />
            <MetricCard
              accent="from-emerald-300 to-teal-400"
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Tasks cleared"
              sublabel="8 follow-ups completed"
              value="18"
            />
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-12">
            <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/35 p-5 xl:col-span-7">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Priority queue</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Highest-impact work surfaced by role.
                  </p>
                </div>
                <button className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200">
                  Start work
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {focusItems.map((item) => (
                  <article
                    className={`group rounded-[1.25rem] border p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.08] ${getToneClasses(
                      item.tone,
                    )}`}
                    key={item.title}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <p className="mt-1 text-sm opacity-75">{item.meta}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{item.status}</span>
                        <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-5 xl:col-span-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Pipeline pulse</h2>
                  <p className="mt-1 text-sm text-slate-400">Stage value and risk density.</p>
                </div>
                <RadioTower className="h-5 w-5 text-cyan-200" />
              </div>
              <div className="mt-8 flex h-64 items-end gap-4">
                {pipelineStages.map((stage) => (
                  <div className="flex flex-1 flex-col items-center gap-3" key={stage.label}>
                    <div
                      className={`w-full rounded-t-[1.4rem] ${stage.height} ${stage.color} shadow-2xl shadow-slate-950/25`}
                    />
                    <div className="text-center">
                      <p className="text-sm font-semibold">{stage.value}</p>
                      <p className="text-xs text-slate-400">{stage.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-12">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-5 xl:col-span-5">
              <h2 className="text-xl font-semibold tracking-tight">Customer timeline</h2>
              <div className="mt-5 space-y-4 border-l border-white/10 pl-5">
                {timelineEvents.map((event, index) => (
                  <div className="relative" key={event}>
                    <span className="absolute -left-[1.7rem] top-1 h-3 w-3 rounded-full bg-cyan-300 shadow-lg shadow-cyan-300/40" />
                    <p className="text-sm font-medium text-white">{event}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {index + 1}h ago · logged automatically
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-violet-300/20 bg-violet-950/35 p-5 xl:col-span-7">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-300 text-slate-950">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">CRM Copilot</h2>
                  <p className="text-sm text-violet-100/70">
                    Tenant-safe · read-only · query validated
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-[1.25rem] bg-slate-950/45 p-4 text-sm text-violet-50">
                Which enterprise deals are likely to slip this month, and what should I do next?
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[1.25rem] bg-white/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Clock3 className="h-4 w-4 text-amber-200" /> CloudTech may slip
                  </div>
                  <p className="mt-2 text-sm leading-6 text-violet-100/75">
                    Migration concern unresolved. Send proof pack and schedule CTO follow-up today.
                  </p>
                </div>
                <div className="rounded-[1.25rem] bg-white/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <ShieldCheck className="h-4 w-4 text-cyan-200" /> Trust layer active
                  </div>
                  <p className="mt-2 text-sm leading-6 text-violet-100/75">
                    Query used CRM schema allowlist, tenant filter, and 100-row result cap.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}

interface MetricCardProps {
  accent: string
  icon: React.ReactNode
  label: string
  sublabel: string
  value: string
}

function MetricCard({ accent, icon, label, sublabel, value }: MetricCardProps): React.JSX.Element {
  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-slate-950/20">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-white">{value}</p>
        </div>
        <div className={`rounded-2xl bg-gradient-to-br ${accent} p-3 text-slate-950`}>{icon}</div>
      </div>
      <p className="mt-5 text-sm text-slate-400">{sublabel}</p>
    </article>
  )
}
