'use client'
import {useEffect,useState} from 'react'
import {sb,msg,etb} from '@/lib/supabase'
import {useT} from '@/lib/i18n'
type M={id:string;name:string;sell_price:number;track_stock:boolean;stock_qty:number}
export default function Snacks({session,onClose}:{session:string|null;onClose:()=>void}){const t=useT()

const [m,setM]=useState<M[]>([]),[q,setQ]=useState<Record<string,number>>({}),[err,setErr]=useState(''),[busy,setB]=useState(false)
useEffect(()=>{sb.rpc('menu').then(({data,error})=>{if(error)setErr(msg(error));else setM(data as M[])})},[])
const total=m.reduce((a,i)=>a+(q[i.id]||0)*i.sell_price,0)
const go=async(method:string|null)=>{setB(true);const items=Object.entries(q).filter(([,v])=>v>0).map(([item_id,qty])=>({item_id,qty}));const {error}=await sb.rpc('add_sale',{p_items:items,p_session:session,p_method:method});setB(false);if(error){setErr(msg(error));return};onClose()}
return <div role="dialog" aria-modal className="fixed inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center"><div className="mx-auto max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-brand/40 bg-surface p-5">
<h3 className="font-display text-2xl font-bold">{session?t('Add snacks to session'):t('Snack sale')}</h3>
{err&&<p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
{!m.length&&!err&&<p className="mt-3 text-ink/60">{t('No snacks yet. Ask the owner to add items in Inventory.')}</p>}
<div className="mt-3 space-y-2">{m.map(i=><div key={i.id} className="flex items-center gap-2"><div className="flex-1"><p className="font-semibold">{i.name}</p><p className="text-sm text-ink/60">{etb(i.sell_price)}{i.track_stock?` · ${i.stock_qty} left`:''}</p></div>
<button aria-label={`Remove ${i.name}`} onClick={()=>setQ({...q,[i.id]:Math.max(0,(q[i.id]||0)-1)})} className="btn w-12 border border-line">−</button><span className="w-6 text-center">{q[i.id]||0}</span>
<button aria-label={`Add ${i.name}`} onClick={()=>setQ({...q,[i.id]:Math.min(50,(q[i.id]||0)+1)})} className="btn brand w-12">+</button></div>)}</div>
<p className="mt-4 text-lg">{t('Total')} <b className="text-brand">{etb(total)}</b></p>
{session?<button disabled={!total||busy} onClick={()=>go(null)} className="btn brand mt-2 w-full disabled:opacity-40">{t('Add to session')}</button>:
<div className="mt-2 grid grid-cols-3 gap-2">{['cash','telebirr','cbe'].map(x=><button key={x} disabled={!total||busy} onClick={()=>go(x)} className="btn border border-line capitalize disabled:opacity-40">{x==='cbe'?'CBE':x}</button>)}</div>}
<button onClick={onClose} className="btn mt-2 w-full text-ink/60">{t('Cancel')}</button></div></div>}
