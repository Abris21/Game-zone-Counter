'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
import {useT} from '@/lib/i18n'
type Se={id:string;station_id:string;games_count:number;total_amount:number|null;payment_method:string|null;status:string}
type Sh={id:string;status:string;variance:number|null;expected_cash:number|null;note:string|null}
export default function Day(){const r=useRouter();const t=useT();const [sh,setSh]=useState<Sh|null>(null),[se,setSe]=useState<Se[]>([]),[nm,setNm]=useState<Record<string,string>>({}),[sl,setSl]=useState<{total:number;payment_method:string|null}[]>([]),[err,setErr]=useState(''),[cash,setCash]=useState(''),[note,setNote]=useState('')
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const a=await sb.from('shifts').select('id,status,variance,expected_cash,note').eq('employee_id',user.id).order('opened_at',{ascending:false}).limit(1).maybeSingle();setSh(a.data)
const [b,c]=await Promise.all([a.data?sb.from('sessions').select('id,station_id,games_count,total_amount,payment_method,status').eq('shift_id',a.data.id).neq('status','cancelled').order('started_at'):Promise.resolve({data:[],error:null}),sb.from('stations').select('id,name')])
if(b.error||c.error){setErr(msg(b.error||c.error));return};setSe(b.data as Se[]);const q=a.data?await sb.from('sales').select('total,payment_method').eq('shift_id',a.data.id).is('voided_at',null):{data:[]};setSl((q.data||[]) as {total:number;payment_method:string|null}[]);setNm(Object.fromEntries((c.data||[]).map(x=>[x.id,x.name])))},[r])
useEffect(()=>{load()},[load])
const done=se.filter(s=>s.status==='ended'),snk=(m?:string)=>sl.filter(s=>s.payment_method&&(!m||s.payment_method===m)).reduce((a,s)=>a+Number(s.total),0),sum=(m?:string)=>done.filter(s=>!m||s.payment_method===m).reduce((a,s)=>a+(s.total_amount??0),0)+snk(m)
const by=Object.entries(se.reduce<Record<string,Se[]>>((a,s)=>{(a[s.station_id]??=[]).push(s);return a},{}))
const close=async(e:React.FormEvent)=>{e.preventDefault();const {error}=await sb.rpc('close_shift',{p_counted:Number(cash),p_note:note||null});setErr(msg(error));if(!error){setCash('');setNote('')};load()}
return <main className="mx-auto max-w-2xl px-4 pb-24 pt-6"><header className="mb-6 flex items-end justify-between"><div><h1 className="font-display text-3xl font-bold">{t('My day')}</h1><p className="text-ink/60">{done.reduce((a,s)=>a+s.games_count,0)} {t('games')} · {etb(sum())}</p></div><a href="/counter" className="text-brand underline">{t('Back to counters')}</a></header>
{err&&<p role="alert" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
{!se.length&&<p className="rounded-2xl border border-line p-6 text-center text-ink/60">{t('No sessions yet. Start a session on the counter screen.')}</p>}
{by.map(([id,list])=><section key={id} className="mb-3 rounded-2xl border border-line bg-surface p-4"><h2 className="font-display text-xl font-bold">{nm[id]??'Unit'}</h2>
{list.map((s,i)=><p key={s.id} className="flex justify-between text-sm"><span>{t('Session')} {i+1} · {s.games_count} {t('games')}{s.status==='open'?` (${t('running')})`:''}</span><span>{s.status==='open'?'—':etb(s.total_amount)}</span></p>)}</section>)}
{!!se.length&&<div className="mb-6 grid grid-cols-3 gap-2 text-center">{(['cash','telebirr','cbe'] as const).map(m=><div key={m} className="rounded-2xl border border-line bg-surface p-3"><p className="text-sm text-ink/60">{m==='cbe'?'CBE':t(m[0].toUpperCase()+m.slice(1))}</p><p className="font-semibold">{etb(sum(m))}</p></div>)}</div>}
{sh?.status==='open'&&!!se.length&&<form onSubmit={close} className="space-y-2 rounded-2xl border border-brand/50 bg-surface p-4"><h2 className="font-display text-xl font-bold">{t('Close your day')}</h2>
<p className="text-sm text-ink/60">{t('You should hand over')} {etb(sum('cash'))} {t('in cash. Count the cash you have and enter it.')}</p>
<input required type="number" min="0" value={cash} onChange={e=>setCash(e.target.value)} placeholder={t('Cash counted (ETB)')} className="inp"/>
<input value={note} onChange={e=>setNote(e.target.value)} placeholder={t('Note for the owner (optional)')} className="inp"/><button className="btn brand w-full">{t('Submit day')}</button></form>}
{sh?.status==='pending_verification'&&<p className="rounded-2xl border border-line bg-surface p-4">{t('Submitted. Waiting for the owner to check your cash. Difference:')} <b className={sh.variance===0?'text-ok':'text-bad'}>{etb(sh.variance)}</b></p>}
{sh?.status==='settled'&&<p className="rounded-2xl border border-ok/40 bg-ok/10 p-4 text-ok">{t('Your day is settled. Starting a new session opens a new day.')}</p>}
</main>}
