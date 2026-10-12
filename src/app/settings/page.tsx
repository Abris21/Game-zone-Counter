'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg} from '@/lib/supabase'
export default function Settings(){const r=useRouter();const [n,setN]=useState(''),[l,setL]=useState(''),[ok,setOk]=useState(''),[err,setErr]=useState('')
useEffect(()=>{(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('role').eq('id',user.id).single();if(m.data?.role!=='admin'){r.replace('/login');return}
const z=await sb.from('game_zones').select('name,location').maybeSingle();setN(z.data?.name||'');setL(z.data?.location||'')})()},[r])
return <main className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-6"><header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Settings</h1><a href="/monitor" className="text-brand underline">Back</a></header>
{ok&&<p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{ok}</p>}{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<form onSubmit={async e=>{e.preventDefault();const {error}=await sb.rpc('update_zone',{p_name:n,p_location:l});setErr(msg(error));setOk(error?'':'Saved.')}} className="space-y-2 rounded-2xl border border-line bg-surface p-4"><h2 className="font-display text-xl font-bold">Game zone</h2>
<input required value={n} onChange={e=>setN(e.target.value)} placeholder="Game zone name" className="inp"/><input value={l} onChange={e=>setL(e.target.value)} placeholder="Location" className="inp"/><button className="btn brand w-full">Save</button></form></main>}
