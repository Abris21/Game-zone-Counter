'use client'
import {useI18n} from '@/lib/i18n'
export default function EthDate({iso}:{iso:string}){const {lang,cal}=useI18n();if(cal!=='eth'||!iso)return null
try{const p=new Intl.DateTimeFormat(lang==='am'?'am-ET-u-ca-ethiopic':'en-u-ca-ethiopic',{day:'numeric',month:'long',year:'numeric'}).formatToParts(new Date(iso+'T00:00:00'));const g=(k:string)=>p.find(x=>x.type===k)?.value
return <span className="text-sm text-ink/60"> = {g('day')} {g('month')} {g('year')}</span>}catch{return null}}
