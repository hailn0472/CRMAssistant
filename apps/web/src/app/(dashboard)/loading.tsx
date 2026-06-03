export default function DashboardLoading(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
          <div className="h-5 w-32 rounded bg-slate-200" aria-hidden="true" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <section
          aria-label="Đang kiểm tra phiên đăng nhập"
          aria-live="polite"
          aria-busy="true"
          role="status"
          className="rounded-lg border border-slate-200 bg-white p-6"
        >
          <p className="text-sm font-medium text-slate-950">Đang kiểm tra phiên đăng nhập</p>
          <p className="mt-2 text-sm text-slate-600">
            Vui lòng chờ trong giây lát trước khi mở workspace CRM.
          </p>
        </section>
      </main>
    </div>
  )
}
