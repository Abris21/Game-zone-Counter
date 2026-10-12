'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
import Snacks from '@/components/Snacks'
import HandOver from '@/components/HandOver'
import NetBanner from '@/components/NetBanner'
import Bell from '@/components/Bell'
import {useT} from '@/lib/i18n'
import {call} from '@/lib/offline'
type St={id:string;name:string;kind:string;price:number}
type Se={id:string;station_id:string;employee_id:string;games_count:number;price_snapshot:number;started_at:string;status:string;total_amount:number|null;ended_at:string|null}
export default function Counter(){const r=useRouter();const t=useT()
const [st,setSt]=useState<St[]>([]),[se,setSe]=useState<Se[]>([]),[sn,setSn]=useState<Record<string,number>>({}),[snk,setSnk]=useState<string|null|false>(false),[ho,setHo]=useState<string|null>(null),[err,setErr]=useState(''),[end,setEnd]=useState<Se|null>(null),[uid,setUid]=useState('')
const load=useCallback(async()=>{if(!navigator.onLine){try{const j=JSON.parse(localStorage.getItem('gz-snap')||'null');if(j){setUid(j.uid);setSt(j.st);setSe(j.se);setSn(j.sn)}}catch{};return};const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return};setUid(user.id)
const d=new Date();d.setHours(0,0,0,0)
const [a,b]=await Promise.all([sb.from('stations').select('id,name,kind,price').eq('is_archived',false).order('sort_order'),sb.from('sessions').select('*').or(`status.eq.open,started_at.gte.${d.toISOString()}`)])
if(a.error||b.error){setErr(msg(a.error||b.error));return};setSt(a.data as St[]);setSe(b.data as Se[]);const q=await sb.from('sales').select('session_id,total').not('session_id','is',null).is('payment_method',null);setSn((q.data||[]).reduce<Record<string,number>>((m,x)=>{m[x.session_id]=(m[x.session_id]||0)+Number(x.total);return m},{}))},[r])
useEffect(()=>{if(uid&&st.length)try{localStorage.setItem('gz-snap',JSON.stringify({uid,st,se,sn}))}catch{}},[uid,st,se,sn])
useEffect(()=>{load();const c=sb.channel('sessions-live').on('postgres_changes',{event:'*',schema:'public',table:'sessions'},()=>load()).subscribe();return()=>{sb.removeChannel(c)}},[load])
const run=async(f:()=>PromiseLike<{error:{message:string}|null}>)=>{const {error}=await f();setErr(msg(error));await load()}
const adj=(s:Se,d:number)=>{if(s.games_count+d<0)return;setSe(x=>x.map(y=>y.id===s.id?{...y,games_count:y.games_count+d}:y));run(()=>call('adjust_session',{p_session:s.id,p_delta:d,p_event:crypto.randomUUID()}))}
const mine=se.filter(s=>s.employee_id===uid&&s.status==='ended')
const games=mine.reduce((a,s)=>a+s.games_count,0),money=mine.reduce((a,s)=>a+(s.total_amount??0),0)
return <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
<NetBanner onSynced={load}/>
<header className="mb-6 flex items-end justify-between"><div><h1 className="font-display text-4xl font-bold">{t('Today')}</h1><p className="text-ink/60">{games} {t('games finished')}</p></div>
<div className="text-right"><p className="font-display text-4xl font-bold text-brand">{etb(money)}</p><button onClick={()=>setSnk(null)} className="mr-3 text-sm text-brand underline">{t('Snack sale')}</button><a href="/counter/day" className="mr-3 text-sm text-brand underline">{t('My day')}</a><a href="/account" className="mr-3 text-sm text-brand underline">{t('Account')}</a><button onClick={async()=>{await sb.auth.signOut();r.replace('/login')}} className="text-sm text-ink/50 underline">{t('Sign out')}</button> <Bell/></div></header>
{err&&<p role="alert" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
{!st.length&&!err&&<p className="rounded-2xl border border-line p-6 text-center text-ink/60">{t('No units yet. Ask your manager to add stations in Settings.')}</p>}
{se.filter(s=>s.employee_id===uid&&s.status==='ended'&&s.ended_at&&Date.now()-new Date(s.ended_at).getTime()<300000).map(s=><div key={s.id} className="mb-3 flex items-center justify-between rounded-xl border border-line bg-surface p-3 text-sm"><span>{st.find(x=>x.id===s.station_id)?.name} {t('ended')} · {s.games_count} {t('games')}</span><button onClick={()=>run(()=>sb.rpc('reopen_session',{p_session:s.id}))} className="text-brand underline">{t('Reopen')}</button></div>)}
<div className="grid gap-3 sm:grid-cols-2">{st.map(u=>{const s=se.find(x=>x.station_id===u.id&&x.status==='open'),mineOpen=s?.employee_id===uid
return <section key={u.id} className={`rounded-2xl border p-4 ${s?'border-brand/60 bg-surface':'border-line bg-surface/60'}`}>
<div className="flex items-baseline justify-between"><h2 className="font-display text-2xl font-bold">{u.name}</h2><span className={`text-sm ${s?'text-brand':'text-ok'}`}>{s?t('In use'):t('Free')} · {etb(u.price)}/{t('game')}</span></div>
{!s?<button onClick={()=>run(()=>sb.rpc('start_session',{p_station:u.id}))} className="btn brand mt-4 w-full">{t('Start session')}</button>:
<><p className="mt-2 text-center font-display text-7xl font-bold text-ink" aria-live="polite">{s.games_count}</p>
<p className="text-center text-brand">{etb(s.games_count*s.price_snapshot+(sn[s.id]||0))}{sn[s.id]?` (${t('snacks')} ${etb(sn[s.id])})`:''}</p>
<div className="mt-4 grid grid-cols-3 gap-2"><button aria-label="Remove one game" onClick={()=>adj(s,-1)} className="btn border border-line text-2xl">−</button>
<button aria-label="End session" onClick={()=>setEnd(s)} className="btn border border-brand/60 text-brand">{t('End')}</button>
<button aria-label="Add one game" onClick={()=>adj(s,1)} className="btn brand text-2xl">+</button></div>
<button onClick={()=>setSnk(s.id)} className="btn mt-2 w-full border border-line text-sm">{t('Add snacks')}</button>
<button onClick={()=>setHo(s.id)} className="btn mt-2 w-full text-sm text-ink/60">{t('Hand over to a colleague')}</button>
{!mineOpen&&<p className="mt-2 text-center text-xs text-ink/50">{t('Started by another employee')}</p>}</>}</section>})}</div>
{end&&<div role="dialog" aria-modal className="fixed inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center"><div className="mx-auto w-full max-w-sm rounded-2xl border border-brand/40 bg-surface p-5">
<h3 className="font-display text-3xl font-bold">{t('End session')}</h3>
<p className="mt-1 text-ink/70">{end.games_count} {t('games')} × {etb(end.price_snapshot)} = <b className="text-brand">{etb(end.games_count*end.price_snapshot+(sn[end.id]||0))}</b>{sn[end.id]?` ${t('incl. snacks')} ${etb(sn[end.id])}`:''}</p>
{end.games_count===0&&!sn[end.id]&&<p className="mt-2 text-sm text-ink/60">{t('No games counted. This will cancel the session.')}</p>}
<p className="mb-2 mt-4 text-sm text-ink/60">{t('How did they pay?')}</p>
<div className="grid grid-cols-3 gap-2">{['cash','telebirr','cbe'].map(m=><button key={m} onClick={async()=>{const s=end;setEnd(null);setSe(x=>x.map(y=>y.id===s.id?{...y,status:'ended',total_amount:s.games_count*s.price_snapshot,ended_at:new Date().toISOString()}:y));await run(()=>call('end_session',{p_session:s.id,p_method:m}))}} className="btn border border-line capitalize hover:border-brand">{m==='cbe'?'CBE':t(m)}</button>)}</div>
<button onClick={()=>setEnd(null)} className="btn mt-3 w-full text-ink/60">{t('Keep counting')}</button></div></div>}
{ho&&<HandOver session={ho} onClose={()=>{setHo(null);load()}}/>}{snk!==false&&<Snacks session={snk} onClose={()=>{setSnk(false);load()}}/>}</main>}
