'use client'

import { useI18n, useT } from '@/lib/i18n'

export default function Prefs() {
  const { lang, cal, setLang, setCal } = useI18n()
  const t = useT()

  return (
    <div className="surface-card p-5 space-y-4">
      <div>
        <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('Language')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setLang('en')}
            className={`btn text-xs font-bold ${
              lang === 'en' ? 'btn-gold' : 'btn-secondary text-ink-muted'
            }`}
          >
            English
          </button>
          <button
            onClick={() => setLang('am')}
            className={`btn text-xs font-bold ${
              lang === 'am' ? 'btn-gold' : 'btn-secondary text-ink-muted'
            }`}
          >
            አማርኛ
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-line/60">
        <h2 className="mb-2 font-display text-sm font-bold text-ink">{t('Calendar')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setCal('greg')}
            className={`btn text-xs font-bold ${
              cal === 'greg' ? 'btn-gold' : 'btn-secondary text-ink-muted'
            }`}
          >
            {t('Gregorian')}
          </button>
          <button
            onClick={() => setCal('eth')}
            className={`btn text-xs font-bold ${
              cal === 'eth' ? 'btn-gold' : 'btn-secondary text-ink-muted'
            }`}
          >
            {t('Ethiopian')}
          </button>
        </div>
      </div>
    </div>
  )
}
