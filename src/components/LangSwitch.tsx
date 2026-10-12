'use client'
import {useI18n} from '@/lib/i18n'
export default function LangSwitch(){const {lang,setLang}=useI18n();return <button onClick={()=>setLang(lang==='am'?'en':'am')} className="mx-auto mt-6 block text-sm text-brand underline">{lang==='am'?'English':'አማርኛ'}</button>}
