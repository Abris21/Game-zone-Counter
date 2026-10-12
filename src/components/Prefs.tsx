'use client'
import {useI18n,useT} from '@/lib/i18n'
export default function Prefs(){const {lang,cal,setLang,setCal}=useI18n();const t=useT();const b=(on:boolean)=>`btn text-sm ${on?'brand':'border border-line'}`
return <div className="space-y-3 rounded-2xl border border-line bg-surface p-4"><div><h2 className="mb-2 font-display text-xl font-bold">{t('Language')}</h2><div className="grid grid-cols-2 gap-2"><button onClick={()=>setLang('en')} className={b(lang==='en')}>English</button><button onClick={()=>setLang('am')} className={b(lang==='am')}>አማርኛ</button></div></div>
<div><h2 className="mb-2 font-display text-xl font-bold">{t('Calendar')}</h2><div className="grid grid-cols-2 gap-2"><button onClick={()=>setCal('greg')} className={b(cal==='greg')}>{t('Gregorian')}</button><button onClick={()=>setCal('eth')} className={b(cal==='eth')}>{t('Ethiopian')}</button></div></div></div>}
