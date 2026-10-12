'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,api,msg} from '@/lib/supabase'
type Z={id:string;name:string;status:string;max_employees:number;max_stations:number}
const E={zone_name:'',full_name:'',email:'',password:'',max_employees:'3',max_stations:'10'}
export default function Super(){const r=useRouter();const [z,setZ]=useState<Z[]>([]),[err,setErr]=useState(''),[f,setF]=useState(E)
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('role').eq('id',user.id).single();if(m.data?.role!=='super_admin'){r.replace('/login');return}
const g=await sb.from('game_zones').select('id,name,status,max_employees,max_stations').is('deleted_at',null).order('created_at',{ascending:false});if(g.error){setErr(msg(g.error));return};setZ(g.data as Z[])},[r])
useEffect(()=>{load()},[load])
const k=(n:keyof typeof E,p:string,t='text')=><input required type={t} value={f[n]} onChange={e=>setF({...f,[n]:e.target.value})} placeholder={p} className="inp"/>
return <main className="mx-auto max-w-2xl space-y-6 px-4 pb-24 pt-6">
<header className="flex items-end justify-between"><div><h1 className="font-display text-3xl font-bold">Game zones</h1><p className="text-ink/60">{z.length} registered · {z.filter(x=>x.status==='active').length} active</p></div>
<button onClick={async()=>{await sb.auth.signOut();r.replace('/login')}} className="text-sm text-ink/50 underline">Sign out</button><a href="/account" className="ml-3 text-sm text-brand underline">Account</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<form onSubmit={async e=>{e.preventDefault();const {error}=await api({action:'create_admin',...f});setErr(msg(error));if(!error)setF(E);load()}} className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-4">
<h2 className="col-span-2 font-display text-xl font-bold">Add a game zone owner</h2>{k('zone_name','Game zone name')}{k('full_name','Owner full name')}{k('email','Owner email','email')}{k('password','Temporary password (8+)','password')}{k('max_employees','Max employees','number')}{k('max_stations','Max units','number')}
<button className="btn brand col-span-2">Create owner</button></form>
<div className="space-y-2">{z.map(x=><div key={x.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3"><div className="flex-1"><p className="font-semibold">{x.name}</p><p className="text-sm text-ink/60">{x.status==='active'?'Active':'Suspended'} · up to {x.max_employees} employees, {x.max_stations} units</p></div>
<button onClick={async()=>{const {error}=await sb.from('game_zones').update({status:x.status==='active'?'suspended':'active'}).eq('id',x.id);setErr(msg(error));load()}} className={`btn px-3 ${x.status==='active'?'text-bad':'text-brand'}`}>{x.status==='active'?'Suspend':'Activate'}</button></div>)}
{!z.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No game zones yet. Add the first owner above.</p>}</div></main>}
