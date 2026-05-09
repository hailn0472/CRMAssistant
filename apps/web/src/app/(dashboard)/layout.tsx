export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <div className="min-h-screen">{children}</div>
}
