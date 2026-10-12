'use client'
import {useEffect,useState} from 'react'
import {sb,msg} from '@/lib/supabase'
export default function HandOver({session,onClose}:{session:string;onClose:()=>void}){const [p,setP]=useState<{id:string;full_name:string}[]>([]),[err,setErr]=useState('')
useEffect(()=>{(async()=>{const {data:{user}}=await sb.auth.getUser();const q=await sb.from('profiles').select('id,full_name').eq('role','employee').eq('is_active',true).is('deleted_at',null);if(q.error)setErr(msg(q.error));setP((q.data||[]).filter(x=>x.id!==user?.id))})()},[])
return <div role="dialog" aria-modal className="fixed inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center"><div className="mx-auto w-full max-w-sm rounded-2xl border border-brand/40 bg-surface p-5"><h3 className="font-display text-2xl font-bold">Hand over this session</h3>
<p className="mt-1 text-sm text-ink/60">The games, snacks and cash move to your colleague's day.</p>{err&&<p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
<div className="mt-3 space-y-2">{p.map(x=><button key={x.id} onClick={async()=>{const {error}=await sb.rpc('handover_session',{p_session:session,p_to:x.id});if(error)setErr(msg(error));else onClose()}} className="btn w-full border border-line">{x.full_name}</button>)}{!p.length&&!err&&<p className="text-ink/60">No other employees yet.</p>}</div>
<button onClick={onClose} className="btn mt-3 w-full text-ink/60">Cancel</button></div></div>}
