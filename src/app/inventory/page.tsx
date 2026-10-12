'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
type I={id:string;name:string;sell_price:number;cost_price:number;track_stock:boolean;stock_qty:number;low_stock_threshold:number}
export default function Inventory(){const r=useRouter();const [it,setIt]=useState<I[]>([]),[zid,setZ]=useState(''),[err,setErr]=useState(''),[n,setN]=useState({name:'',sell_price:'',cost_price:'',track_stock:true,stock_qty:'0'})
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('zone_id,role').eq('id',user.id).single();if(m.data?.role!=='admin'){r.replace('/login');return};setZ(m.data.zone_id)
const a=await sb.from('inventory_items').select('*').eq('is_archived',false).order('name');if(a.error){setErr(msg(a.error));return};setIt(a.data as I[])},[r])
useEffect(()=>{load()},[load])
const done=async(p:PromiseLike<{error:{message:string}|null}>,after?:()=>void)=>{const {error}=await p;setErr(msg(error));if(!error)after?.();load()}
const up=(i:I,k:keyof I,v:number)=>v!==i[k]&&done(sb.from('inventory_items').update({[k]:v}).eq('id',i.id))
const low=it.filter(i=>i.track_stock&&i.stock_qty<=i.low_stock_threshold)
return <main className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-6"><header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Inventory</h1><a href="/monitor" className="text-brand underline">Back to live floor</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
{!!low.length&&<p className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">Running low: {low.map(i=>`${i.name} (${i.stock_qty})`).join(', ')}</p>}
{it.map(i=><div key={i.id} className="rounded-2xl border border-line bg-surface p-3"><p className="font-semibold">{i.name}</p>
<div className="mt-2 grid grid-cols-4 gap-2 text-xs text-ink/60"><label>Price<input type="number" min="0" defaultValue={i.sell_price} onBlur={e=>up(i,'sell_price',Number(e.target.value))} className="inp !h-10 text-ink"/></label><label>Cost<input type="number" min="0" defaultValue={i.cost_price} onBlur={e=>up(i,'cost_price',Number(e.target.value))} className="inp !h-10 text-ink"/></label>
<label>Stock<input type="number" min="0" disabled={!i.track_stock} defaultValue={i.stock_qty} onBlur={e=>up(i,'stock_qty',Number(e.target.value))} className="inp !h-10 text-ink disabled:opacity-40"/></label><label>Alert at<input type="number" min="0" defaultValue={i.low_stock_threshold} onBlur={e=>up(i,'low_stock_threshold',Number(e.target.value))} className="inp !h-10 text-ink"/></label></div>
<div className="mt-2 flex justify-between text-sm"><span className="text-ink/60">Margin {etb(i.sell_price-i.cost_price)} each</span><button onClick={()=>confirm(`Archive ${i.name}?`)&&done(sb.from('inventory_items').update({is_archived:true}).eq('id',i.id))} className="text-bad underline">Archive</button></div></div>)}
{!it.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No snacks yet. Add water, soda or chips below.</p>}
<form onSubmit={e=>{e.preventDefault();done(sb.from('inventory_items').insert({zone_id:zid,name:n.name.trim(),sell_price:Number(n.sell_price),cost_price:Number(n.cost_price||0),track_stock:n.track_stock,stock_qty:Number(n.stock_qty||0)}),()=>setN({...n,name:'',sell_price:'',cost_price:'',stock_qty:'0'}))}} className="grid grid-cols-2 gap-2">
<input required value={n.name} onChange={e=>setN({...n,name:e.target.value})} placeholder="Item name" className="inp"/><input required type="number" min="0" value={n.sell_price} onChange={e=>setN({...n,sell_price:e.target.value})} placeholder="Selling price" className="inp"/>
<input type="number" min="0" value={n.cost_price} onChange={e=>setN({...n,cost_price:e.target.value})} placeholder="Cost price" className="inp"/><input type="number" min="0" value={n.stock_qty} onChange={e=>setN({...n,stock_qty:e.target.value})} placeholder="Stock" className="inp"/>
<label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={n.track_stock} onChange={e=>setN({...n,track_stock:e.target.checked})}/>Track stock for this item</label><button className="btn brand col-span-2">Add item</button></form></main>}
