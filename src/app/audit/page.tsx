'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg} from '@/lib/supabase'
type A={id:string;user_id:string;action:string;entity:string;reason:string|null;previous_state:unknown;new_state:unknown;created_at:string}
export default function Audit(){const r=useRouter();const [a,setA]=useState<A[]>([]),[nm,setNm]=useState<Record<string,string>>({}),[err,setErr]=useState('')
useEffect(()=>{(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('role').eq('id',user.id).single();if(m.data?.role!=='admin'){r.replace('/login');return}
const [x,p]=await Promise.all([sb.from('audit_logs').select('id,user_id,action,entity,reason,previous_state,new_state,created_at').order('created_at',{ascending:false}).limit(200),sb.from('profiles').select('id,full_name')])
if(x.error){setErr(msg(x.error));return};setA(x.data as A[]);setNm(Object.fromEntries((p.data||[]).map(q=>[q.id,q.full_name])))})()},[r])
return <main className="mx-auto max-w-2xl space-y-3 px-4 pb-24 pt-6"><header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Audit log</h1><a href="/monitor" className="text-brand underline">Back</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
{a.map(x=><details key={x.id} className="rounded-2xl border border-line bg-surface p-3"><summary className="cursor-pointer"><span className="font-semibold">{x.action.replace(/_/g,' ')}</span> <span className="text-sm text-ink/60">by {nm[x.user_id]??'unknown'} · {new Date(x.created_at).toLocaleString()}</span></summary>
{x.reason&&<p className="mt-2 text-sm">Reason: {x.reason}</p>}<pre className="mt-2 overflow-x-auto text-xs text-ink/70">{JSON.stringify({before:x.previous_state,after:x.new_state},null,1)}</pre></details>)}
{!a.length&&!err&&<p className="rounded-2xl border border-line p-4 text-ink/60">No activity recorded yet.</p>}</main>}
