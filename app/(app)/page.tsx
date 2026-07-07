import { DashboardGrid } from '@/components/widgets/DashboardGrid'

export const metadata = { title: 'Dashboard' }

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-extrabold text-navy dark:text-white">Dashboard</h1>
        <p className="font-body text-[14px] text-gray-500 dark:text-white/50">
          Start any tool inline — you&apos;ll land right in the live flow.
        </p>
      </header>
      <DashboardGrid />
    </div>
  )
}
