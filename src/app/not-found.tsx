import Link from 'next/link'
import { PlayStationSymbolsRow } from '@/components/PlayStationIcons'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 bg-bg text-ink text-center">
      <div className="w-full max-w-sm space-y-5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-surface border border-line text-brand text-2xl font-black">
          404
        </div>
        <h1 className="font-display text-2xl font-bold">Page Not Found</h1>
        <p className="text-xs text-ink-muted leading-relaxed">
          The requested station, session or console screen does not exist or has been archived.
        </p>
        <PlayStationSymbolsRow className="flex justify-center gap-2 pt-1" />
        <div className="pt-2">
          <Link href="/login" className="btn btn-gold text-xs px-6">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
