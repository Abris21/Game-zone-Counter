import React from 'react'

export function PsCross({ className = 'w-4 h-4 text-[#0070D1]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={className}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  )
}

export function PsCircle({ className = 'w-4 h-4 text-[#EF4444]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={className}>
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

export function PsTriangle({ className = 'w-4 h-4 text-[#10B981]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" className={className}>
      <polygon points="12,5 19,18 5,18" />
    </svg>
  )
}

export function PsSquare({ className = 'w-4 h-4 text-[#EC4899]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={className}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

export function ControllerIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 12h4m-2-2v4" />
      <circle cx="17" cy="11" r="1" fill="currentColor" />
      <circle cx="15" cy="13" r="1" fill="currentColor" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.104-.015.156L2 17.5a2.5 2.5 0 0 0 4.3 1.77L8.5 17h7l2.2 2.27A2.5 2.5 0 0 0 22 17.5l-.687-8.754A4 4 0 0 0 17.32 5z" />
    </svg>
  )
}

export function TrophyIcon({ className = 'w-5 h-5 text-brand' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.45 1-1 1H7c-.55 0-1 .45-1 1v1h12v-1c0-.55-.45-1-1-1h-2c-.55 0-1-.45-1-1v-2.34" />
      <path d="M6 4h12v5a6 6 0 0 1-12 0V4z" />
    </svg>
  )
}

export function PlayStationSymbolsRow({ className = 'flex items-center gap-1.5' }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <PsTriangle className="w-3.5 h-3.5 text-ok/80" />
      <PsCircle className="w-3.5 h-3.5 text-bad/80" />
      <PsCross className="w-3.5 h-3.5 text-ps-cyan/80" />
      <PsSquare className="w-3.5 h-3.5 text-pink-400/80" />
    </div>
  )
}
