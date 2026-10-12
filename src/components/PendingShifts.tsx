'use client'
import {useCallback,useEffect,useState} from 'react'
import {sb,msg,etb} from '@/lib/supabase'
type P={id:string;expected_cash:number;counted_cash:number;variance:number;note:string|null;profiles:{full_name:string}|null}
export default function PendingShifts(){const [p,setP]=useState<P[]>([]),[err,setErr]=useState('')
const load=useCallback(async()=>{const {data,error}=await sb.from('shifts').select('id,expected_cash,counted_cash,variance,note,profiles(full_name)').eq('status','pending_verification');if(error){setErr(msg(error));return};setP((data as unknown as P[])||[])},[])
useEffect(()=>{load();const c=sb.channel('shifts-live').on('postgres_changes',{event:'*',schema:'public',table:'shifts'},()=>load()).subscribe();return()=>{sb.removeChannel(c)}},[load])
const v=async(id:string,ok:boolean)=>{const {error}=await sb.rpc('verify_shift',{p_shift:id,p_approve:ok,p_note:ok?null:'Sent back by owner'});setErr(msg(error));load()}
if(!p.length&&!err)return null
return <section className="mb-6 space-y-2"><h2 className="font-display text-xl font-bold">Days waiting for your check</h2>
{err&&<p role="alert" className="text-sm text-bad">{err}</p>}
{p.map(s=><div key={s.id} className="rounded-2xl border border-brand/50 bg-surface p-4"><p className="font-semibold">{s.profiles?.full_name??'Employee'}</p>
<p className="text-sm text-ink/70">Expected cash {etb(s.expected_cash)} · Counted {etb(s.counted_cash)}</p>
<p className={`font-display text-2xl font-bold ${s.variance===0?'text-ok':'text-bad'}`}>{s.variance===0?'Cash matches':`Difference ${etb(s.variance)}`}</p>
{s.note&&<p className="text-sm text-ink/60">“{s.note}”</p>}
<div className="mt-3 grid grid-cols-2 gap-2"><button onClick={()=>v(s.id,false)} className="btn border border-line">Send back</button><button onClick={()=>v(s.id,true)} className="btn brand">Settle day</button></div></div>)}</section>}
