'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
import EthDate from '@/components/EthDate'
type Se={id:string;games_count:number;total_amount:number|null;payment_method:string|null;status:string;started_at:string;employee_id:string;stations:{name:string}|null}
type Sl={id:string;total:number;payment_method:string|null;voided_at:string|null;created_at:string;employee_id:string;session_id:string|null}
type D={k:'edit'|'vs'|'vl';id:string;games:string;method:string;reason:string}
const tm=(x:string)=>new Date(x).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
export default function History(){const r=useRouter()
const [day,setDay]=useState(new Date().toLocaleDateString('en-CA')),[tab,setTab]=useState('s'),[se,setSe]=useState<Se[]>([]),[sl,setSl]=useState<Sl[]>([]),[nm,setNm]=useState<Record<string,string>>({}),[d,setD]=useState<D|null>(null),[err,setErr]=useState('')
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('role').eq('id',user.id).single();if(m.data?.role!=='admin'){r.replace('/login');return}
const a=new Date(day+'T00:00:00'),b=new Date(a);b.setDate(a.getDate()+1)
const [x,y,p]=await Promise.all([sb.from('sessions').select('id,games_count,total_amount,payment_method,status,started_at,employee_id,stations(name)').in('status',['ended','cancelled']).gte('started_at',a.toISOString()).lt('started_at',b.toISOString()).order('started_at',{ascending:false}),
sb.from('sales').select('id,total,payment_method,voided_at,created_at,employee_id,session_id').not('payment_method','is',null).gte('created_at',a.toISOString()).lt('created_at',b.toISOString()).order('created_at',{ascending:false}),sb.from('profiles').select('id,full_name')])
if(x.error||y.error||p.error){setErr(msg(x.error||y.error||p.error));return};setErr('');setSe(x.data as unknown as Se[]);setSl(y.data as Sl[]);setNm(Object.fromEntries((p.data||[]).map(q=>[q.id,q.full_name])))},[r,day])
useEffect(()=>{load()},[load])
const go=async(e:React.FormEvent)=>{e.preventDefault();if(!d)return
const q=d.k==='edit'?sb.rpc('edit_session',{p_session:d.id,p_games:Number(d.games),p_method:d.method,p_reason:d.reason}):d.k==='vs'?sb.rpc('void_session',{p_session:d.id,p_reason:d.reason}):sb.rpc('void_sale',{p_sale:d.id,p_reason:d.reason})
const {error}=await q;setErr(msg(error));if(!error)setD(null);load()}
return <main className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-6"><header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">History</h1><a href="/monitor" className="text-brand underline">Back to live floor</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<div className="grid grid-cols-3 gap-2"><input type="date" value={day} onChange={e=>setDay(e.target.value)} className="inp"/><button onClick={()=>setTab('s')} className={`btn ${tab==='s'?'brand':'border border-line'}`}>Sessions</button><button onClick={()=>setTab('l')} className={`btn ${tab==='l'?'brand':'border border-line'}`}>Snack sales</button></div>
<EthDate iso={day}/>
{tab==='s'?<div className="space-y-2">{se.map(s=><div key={s.id} className="rounded-2xl border border-line bg-surface p-3"><div className="flex justify-between"><p className="font-semibold">{s.stations?.name??'Unit'} · {tm(s.started_at)}</p><p className={s.status==='cancelled'?'text-bad':'text-brand'}>{s.status==='cancelled'?'Voided':etb(s.total_amount)}</p></div>
<p className="text-sm text-ink/60">{nm[s.employee_id]??'Employee'} · {s.games_count} games · {s.payment_method??'no payment'}</p>
{s.status==='ended'&&<div className="mt-2 flex gap-4 text-sm"><button onClick={()=>setD({k:'edit',id:s.id,games:String(s.games_count),method:s.payment_method||'cash',reason:''})} className="text-brand underline">Edit</button><button onClick={()=>setD({k:'vs',id:s.id,games:'',method:'',reason:''})} className="text-bad underline">Void</button></div>}</div>)}
{!se.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No sessions on this day.</p>}</div>:
<div className="space-y-2">{sl.map(s=><div key={s.id} className="rounded-2xl border border-line bg-surface p-3"><div className="flex justify-between"><p className="font-semibold">Snacks · {tm(s.created_at)}</p><p className={s.voided_at?'text-bad':'text-brand'}>{s.voided_at?'Voided':etb(s.total)}</p></div>
<p className="text-sm text-ink/60">{nm[s.employee_id]??'Employee'} · {s.payment_method}{s.session_id?' · with a session':''}</p>
{!s.voided_at&&<button onClick={()=>setD({k:'vl',id:s.id,games:'',method:'',reason:''})} className="mt-2 text-sm text-bad underline">Void</button>}</div>)}
{!sl.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No snack sales on this day.</p>}</div>}
{d&&<div role="dialog" aria-modal className="fixed inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center"><form onSubmit={go} className="mx-auto w-full max-w-sm space-y-2 rounded-2xl border border-brand/40 bg-surface p-5"><h3 className="font-display text-2xl font-bold">{d.k==='edit'?'Edit session':'Void this '+(d.k==='vs'?'session':'sale')}</h3>
{d.k==='edit'&&<><input required type="number" min="0" max="200" value={d.games} onChange={e=>setD({...d,games:e.target.value})} aria-label="Games" className="inp"/><select value={d.method} onChange={e=>setD({...d,method:e.target.value})} className="inp"><option value="cash">Cash</option><option value="telebirr">Telebirr</option><option value="cbe">CBE</option></select></>}
<input required minLength={3} value={d.reason} onChange={e=>setD({...d,reason:e.target.value})} placeholder="Reason (required)" className="inp"/><p className="text-xs text-ink/60">This is saved in the audit log. Settled days cannot be changed.</p>
<button className="btn brand w-full">Confirm</button><button type="button" onClick={()=>setD(null)} className="btn w-full text-ink/60">Cancel</button></form></div>}</main>}
