'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
import PendingShifts from '@/components/PendingShifts'
import Bell from '@/components/Bell'
type St={id:string;name:string;price:number}
type Se={station_id:string;games_count:number;price_snapshot:number;status:string;total_amount:number|null}
export default function Monitor(){const r=useRouter();const [st,setSt]=useState<St[]>([]),[se,setSe]=useState<Se[]>([]),[err,setErr]=useState(''),[live,setLive]=useState(false)
const load=useCallback(async()=>{const d=new Date();d.setHours(0,0,0,0)
const [a,b]=await Promise.all([sb.from('stations').select('id,name,price').eq('is_archived',false).order('sort_order'),sb.from('sessions').select('station_id,games_count,price_snapshot,status,total_amount').or(`status.eq.open,started_at.gte.${d.toISOString()}`)])
if(a.error||b.error){setErr(msg(a.error||b.error));return};setErr('');setSt(a.data as St[]);setSe(b.data as Se[])},[])
useEffect(()=>{sb.auth.getUser().then(({data})=>{if(!data.user)r.replace('/login')});load()
const c=sb.channel('monitor').on('postgres_changes',{event:'*',schema:'public',table:'sessions'},()=>load()).subscribe(s=>setLive(s==='SUBSCRIBED'));return()=>{sb.removeChannel(c)}},[load,r])
const done=se.filter(s=>s.status==='ended'),rev=done.reduce((a,s)=>a+(s.total_amount??0),0),open=se.filter(s=>s.status==='open')
const running=open.reduce((a,s)=>a+s.games_count*s.price_snapshot,0)
return <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
<header className="mb-6 flex items-end justify-between"><div><h1 className="font-display text-4xl font-bold">Live floor</h1><p className={live?'text-ok':'text-ink/50'}>{live?'Live updates on':'Reconnecting…'}</p></div>
<button onClick={async()=>{await sb.auth.signOut();r.replace('/login')}} className="text-sm text-ink/50 underline">Sign out</button><Bell/></header>
<a href="/inventory" className="mb-4 mr-4 inline-block text-brand underline">Inventory</a><a href="/finance" className="mb-4 mr-4 inline-block text-brand underline">Finance</a><a href="/manage" className="mb-4 inline-block text-brand underline">Manage units and staff</a><a href="/account" className="mb-4 ml-4 inline-block text-brand underline">Account</a><a href="/history" className="mb-4 ml-4 inline-block text-brand underline">History</a><a href="/settings" className="mb-4 ml-4 inline-block text-brand underline">Settings</a><a href="/audit" className="mb-4 ml-4 inline-block text-brand underline">Audit log</a>
<PendingShifts/>
<div className="mb-6 grid grid-cols-2 gap-3"><div className="rounded-2xl border border-brand/40 bg-surface p-4"><p className="text-ink/60">Collected today</p><p className="font-display text-4xl font-bold text-brand">{etb(rev)}</p></div>
<div className="rounded-2xl border border-line bg-surface p-4"><p className="text-ink/60">Running now</p><p className="font-display text-4xl font-bold">{etb(running)}</p></div></div>
{err&&<p role="alert" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{st.map(u=>{const s=open.find(x=>x.station_id===u.id)
return <div key={u.id} className={`rounded-2xl border p-4 ${s?'border-brand/60 bg-surface':'border-line bg-surface/60'}`}><p className="font-display text-xl font-bold">{u.name}</p>
{s?<><p className="font-display text-5xl font-bold">{s.games_count}</p><p className="text-brand">{etb(s.games_count*s.price_snapshot)}</p></>:<p className="mt-3 text-ok">Free</p>}</div>})}</div></main>}
