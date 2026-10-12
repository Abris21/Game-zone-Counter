'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,api,msg,etb} from '@/lib/supabase'
type St={id:string;name:string;kind:string;price:number;price_override:number|null};type Pr={id:string;full_name:string;username:string;is_active:boolean}
export default function Manage(){const r=useRouter()
const [st,setSt]=useState<St[]>([]),[pr,setPr]=useState<Pr[]>([]),[err,setErr]=useState(''),[zid,setZ]=useState(''),[tp,setTp]=useState<Record<string,number>>({}),[n,setN]=useState({kind:'ps4',name:'',price:''}),[u,setU]=useState({username:'',full_name:'',password:''})
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const [m,a,b]=await Promise.all([sb.from('profiles').select('zone_id,role').eq('id',user.id).single(),sb.from('stations').select('id,name,kind,price,price_override').eq('is_archived',false).order('sort_order'),sb.from('profiles').select('id,full_name,username,is_active').eq('role','employee').is('deleted_at',null)])
if(m.data?.role!=='admin'){r.replace('/login');return};if(a.error||b.error){setErr(msg(a.error||b.error));return};setZ(m.data.zone_id);const t=await sb.from('unit_prices').select('kind,price');setTp(Object.fromEntries((t.data||[]).map(x=>[x.kind,Number(x.price)])));setSt(a.data as St[]);setPr(b.data as Pr[])},[r])
useEffect(()=>{load()},[load])
const done=async(p:PromiseLike<{error:{message:string}|null}>,after?:()=>void)=>{const {error}=await p;setErr(msg(error));if(!error)after?.();await load()}
return <main className="mx-auto max-w-2xl space-y-8 px-4 pb-24 pt-6">
<header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Manage</h1><a href="/monitor" className="text-brand underline">Back to live floor</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<section><h2 className="mb-1 font-display text-xl font-bold">Price per game by type</h2><p className="mb-3 text-sm text-ink/60">Applies to every unit of that type unless you give a unit its own price below.</p><div className="grid grid-cols-3 gap-2">{[['ps4','PS4'],['ps5','PS5'],['pool','Pool']].map(([k,l])=><label key={k} className="text-sm text-ink/60">{l}<input type="number" min="0" key={`${k}${tp[k]}`} defaultValue={tp[k]??''} onBlur={e=>e.target.value!==''&&Number(e.target.value)!==tp[k]&&done(sb.from('unit_prices').upsert({zone_id:zid,kind:k,price:Number(e.target.value)},{onConflict:'zone_id,kind'}))} className="inp text-ink"/></label>)}</div></section>
<section><h2 className="mb-3 font-display text-xl font-bold">Units</h2>
<div className="space-y-2">{st.map(s=><div key={s.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3"><div className="flex-1"><p className="font-semibold">{s.name}</p><p className="text-sm text-ink/60">{s.kind.toUpperCase()} · {s.price_override!=null?'custom price':'type price'}</p></div>
<input aria-label={`Price for ${s.name}`} type="number" min="0" defaultValue={s.price} onBlur={e=>e.target.value!==''&&Number(e.target.value)!==s.price&&done(sb.from('stations').update({price_override:Number(e.target.value)}).eq('id',s.id))} className="inp !w-24"/><span className="text-sm text-ink/60">ETB</span>
{s.price_override!=null&&<button onClick={()=>done(sb.from('stations').update({price_override:null}).eq('id',s.id))} className="btn px-2 text-xs text-brand">Use type price</button>}
<button onClick={()=>confirm(`Archive ${s.name}? Past sales are kept.`)&&done(sb.from('stations').update({is_archived:true}).eq('id',s.id))} className="btn px-3 text-bad">Archive</button></div>)}
{!st.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No units yet. Add your first PS4, PS5 or pool table below.</p>}</div>
<form onSubmit={e=>{e.preventDefault();done(sb.from('stations').insert({zone_id:zid,kind:n.kind,name:n.name.trim(),price:Number(n.price||0),price_override:n.price===''?null:Number(n.price),sort_order:st.length+1}),()=>setN({...n,name:'',price:''}))}} className="mt-3 grid grid-cols-2 gap-2">
<select value={n.kind} onChange={e=>setN({...n,kind:e.target.value})} className="inp"><option value="ps4">PS4</option><option value="ps5">PS5</option><option value="pool">Pool table</option></select>
<input required value={n.name} onChange={e=>setN({...n,name:e.target.value})} placeholder="Name, e.g. PS4-2" className="inp"/>
<input type="number" min="0" value={n.price} onChange={e=>setN({...n,price:e.target.value})} placeholder="Own price (optional)" className="inp"/><button className="btn brand">Add unit</button></form></section>
<section><h2 className="mb-3 font-display text-xl font-bold">Employees</h2>
<div className="space-y-2">{pr.map(p=><div key={p.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3"><div className="flex-1"><p className="font-semibold">{p.full_name}</p><p className="text-sm text-ink/60">@{p.username} · {p.is_active?'Active':'Deactivated'}</p></div>
<button onClick={()=>{const w=prompt(`New password for ${p.full_name} (8+ characters)`);if(w)done(api({action:'reset_password',id:p.id,password:w}))}} className="btn px-3 text-brand">Reset password</button>
<button onClick={()=>done(api({action:'set_active',id:p.id,active:!p.is_active}))} className={`btn px-3 ${p.is_active?'text-bad':'text-brand'}`}>{p.is_active?'Deactivate':'Activate'}</button></div>)}
{!pr.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No employees yet. Create a login for each person who counts games.</p>}</div>
<form onSubmit={e=>{e.preventDefault();done(api({action:'create_employee',...u}),()=>setU({username:'',full_name:'',password:''}))}} className="mt-3 grid grid-cols-2 gap-2">
<input required value={u.full_name} onChange={e=>setU({...u,full_name:e.target.value})} placeholder="Full name" className="inp"/>
<input required value={u.username} onChange={e=>setU({...u,username:e.target.value})} placeholder="Username" autoComplete="off" className="inp"/>
<input required type="password" value={u.password} onChange={e=>setU({...u,password:e.target.value})} placeholder="Password (8+ characters)" autoComplete="new-password" className="inp"/><button className="btn brand">Create employee</button></form></section></main>}
