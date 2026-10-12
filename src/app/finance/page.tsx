'use client'
import {useCallback,useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,msg,etb} from '@/lib/supabase'
import EthDate from '@/components/EthDate'
type R={revenue:number;games:number;expenses:number;by_method:Record<string,number>;by_kind:Record<string,number>;by_category:Record<string,number>;daily:{day:string;revenue:number;expenses:number}[]}
type Ex={id:string;category:string;amount:number;expense_date:string;note:string|null};type Rx={id:string;category:string;amount:number;day_of_month:number}
const f=(d:Date)=>d.toLocaleDateString('en-CA'),CATS=['Rent','Electricity','Maintenance','Salary','Other']
const rng=(p:string)=>{const n=new Date(),w=new Date(n);w.setDate(n.getDate()-((n.getDay()+6)%7));return p==='today'?[f(n),f(n)]:p==='week'?[f(w),f(n)]:[f(new Date(n.getFullYear(),n.getMonth(),1)),f(n)]}
export default function Finance(){const r=useRouter()
const [p,setP]=useState('today'),[[from,to],setR]=useState(rng('today')),[d,setD]=useState<R|null>(null),[ex,setEx]=useState<Ex[]>([]),[rx,setRx]=useState<Rx[]>([]),[zid,setZ]=useState(''),[sk,setSk]=useState({revenue:0,cost:0}),[em,setEm]=useState<{name:string;games:number;sessions:number;game_revenue:number;snack_revenue:number}[]>([]),[err,setErr]=useState('')
const [n,setN]=useState({category:'Rent',amount:'',expense_date:f(new Date()),note:''}),[c,setC]=useState({category:'Rent',amount:'',day_of_month:'1'})
const load=useCallback(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}
const m=await sb.from('profiles').select('zone_id,role').eq('id',user.id).single();if(m.data?.role!=='admin'){r.replace('/login');return};setZ(m.data.zone_id)
await sb.rpc('post_recurring')
const [a,b,e,k,emp]=await Promise.all([sb.rpc('profit_report',{p_from:from,p_to:to}),sb.from('expenses').select('id,category,amount,expense_date,note').is('deleted_at',null).gte('expense_date',from).lte('expense_date',to).order('expense_date',{ascending:false}),sb.from('recurring_expenses').select('id,category,amount,day_of_month').eq('is_active',true),sb.rpc('snack_report',{p_from:from,p_to:to}),sb.rpc('employee_report',{p_from:from,p_to:to})])
if(a.error||b.error||e.error){setErr(msg(a.error||b.error||e.error));return};setErr('');setD(a.data as R);setSk((k.data as {revenue:number;cost:number})||{revenue:0,cost:0});setEm((emp.data as typeof em)||[]);setEx(b.data as Ex[]);setRx(e.data as Rx[])},[r,from,to])
useEffect(()=>{load()},[load])
const done=async(q:PromiseLike<{error:{message:string}|null}>,after?:()=>void)=>{const {error}=await q;setErr(msg(error));if(!error)after?.();load()}
const net=(d?.revenue??0)+sk.revenue-sk.cost-(d?.expenses??0),max=Math.max(1,...(d?.daily??[]).flatMap(x=>[x.revenue,x.expenses]))
const csv=()=>{const rows=[['Date','Revenue','Expenses','Net'],...(d?.daily??[]).map(x=>[x.day,x.revenue,x.expenses,x.revenue-x.expenses]),[],['Expense date','Category','Amount','Note'],...ex.map(x=>[x.expense_date,x.category,x.amount,x.note??''])]
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.map(l=>l.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'}));a.download=`finance-${from}-${to}.csv`;a.click()}
const esc=(s:unknown)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] as string))
const pdf=()=>{const row=(a:unknown[])=>`<tr>${a.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`;const w=window.open('','_blank');if(!w)return
w.document.write(`<html><head><title>Finance ${esc(from)} to ${esc(to)}</title><style>body{font:14px system-ui;padding:24px}table{border-collapse:collapse;width:100%;margin:8px 0 20px}td,th{border:1px solid #ccc;padding:6px;text-align:left}h1,h2{margin:0 0 8px}</style></head><body><h1>Finance report</h1><p>${esc(from)} to ${esc(to)}</p>
<table>${row(['Game revenue',etb(d?.revenue??0)])}${row(['Snack revenue',etb(sk.revenue)])}${row(['Snack cost',etb(sk.cost)])}${row(['Expenses',etb(d?.expenses??0)])}${row([net>=0?'Profit':'Loss',etb(Math.abs(net))])}</table>
<h2>By employee</h2><table><tr><th>Name</th><th>Sessions</th><th>Games</th><th>Game revenue</th><th>Snack revenue</th></tr>${em.map(x=>row([x.name,x.sessions,x.games,etb(x.game_revenue),etb(x.snack_revenue)])).join('')}</table>
<h2>Daily</h2><table><tr><th>Date</th><th>Revenue</th><th>Expenses</th></tr>${(d?.daily??[]).map(x=>row([x.day,etb(x.revenue),etb(x.expenses)])).join('')}</table>
<h2>Expenses</h2><table><tr><th>Date</th><th>Category</th><th>Amount</th><th>Note</th></tr>${ex.map(x=>row([x.expense_date,x.category,etb(x.amount),x.note??''])).join('')}</table></body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),300)}
const list=(o:Record<string,number>)=>Object.entries(o).map(([k,v])=><p key={k} className="flex justify-between text-sm"><span className="capitalize">{k==='cbe'?'CBE':k}</span><span>{etb(v)}</span></p>)
return <main className="mx-auto max-w-2xl space-y-6 px-4 pb-24 pt-6">
<header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Finance</h1><a href="/monitor" className="text-brand underline">Back to live floor</a></header>
{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<div className="grid grid-cols-4 gap-2">{[['today','Today'],['week','This week'],['month','This month'],['custom','Custom']].map(([k,l])=><button key={k} onClick={()=>{setP(k);if(k!=='custom')setR(rng(k) as [string,string])}} className={`btn text-sm ${p===k?'brand':'border border-line'}`}>{l}</button>)}</div>
{p==='custom'&&<div className="grid grid-cols-2 gap-2"><input type="date" value={from} onChange={e=>setR([e.target.value,to])} className="inp"/><input type="date" value={to} onChange={e=>setR([from,e.target.value])} className="inp"/></div>}
<p className="text-sm text-ink/60"><EthDate iso={from}/><EthDate iso={to}/></p>
<div className="grid grid-cols-2 gap-3"><div className="rounded-2xl border border-line bg-surface p-4"><p className="text-ink/60">Revenue</p><p className="font-display text-2xl font-bold">{etb(d?.revenue??0)}</p><p className="text-sm text-ink/60">{d?.games??0} games · snacks {etb(sk.revenue)}</p></div>
<div className="rounded-2xl border border-line bg-surface p-4"><p className="text-ink/60">Expenses</p><p className="font-display text-2xl font-bold">{etb(d?.expenses??0)}</p></div>
<div className={`col-span-2 rounded-2xl border p-4 ${net>=0?'border-ok/50':'border-bad/50'} bg-surface`}><p className="text-ink/60">{net>=0?'Profit':'Loss'}</p><p className={`font-display text-4xl font-bold ${net>=0?'text-ok':'text-bad'}`}>{etb(Math.abs(net))}</p></div></div>
{d&&<div className="grid gap-3 sm:grid-cols-3">{([['By unit type',d.by_kind],['By payment',d.by_method],['By expense',d.by_category]] as const).map(([t,o])=><div key={t} className="rounded-2xl border border-line bg-surface p-3"><p className="mb-1 font-semibold">{t}</p>{Object.keys(o).length?list(o):<p className="text-sm text-ink/50">Nothing yet</p>}</div>)}</div>}
{(d?.daily.length??0)>1&&<div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-line bg-surface p-3">{d!.daily.map(x=><div key={x.day} className="text-xs"><div className="flex justify-between"><span>{x.day}</span><span>{etb(x.revenue)} / {etb(x.expenses)}</span></div><div className="h-1.5 rounded bg-brand" style={{width:`${x.revenue/max*100}%`}}/><div className="mt-0.5 h-1.5 rounded bg-bad" style={{width:`${x.expenses/max*100}%`}}/></div>)}<p className="text-xs text-ink/50">Red bar: revenue. Orange bar: expenses.</p></div>}
{!!em.length&&<div className="rounded-2xl border border-line bg-surface p-3"><p className="mb-1 font-semibold">By employee</p>{em.map(x=><p key={x.name} className="flex justify-between text-sm"><span>{x.name} · {x.sessions} sessions · {x.games} games</span><span>{etb(x.game_revenue+x.snack_revenue)}</span></p>)}</div>}
<div className="grid grid-cols-2 gap-2"><button onClick={csv} className="btn w-full border border-line">Export CSV</button><button onClick={pdf} className="btn w-full border border-line">Export PDF</button></div>
<section><h2 className="mb-2 font-display text-xl font-bold">Expenses</h2>
<div className="space-y-2">{ex.map(x=><div key={x.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3"><div className="flex-1"><p className="font-semibold">{x.category}</p><p className="text-sm text-ink/60">{x.expense_date}{x.note?` · ${x.note}`:''}</p></div>
<input aria-label="Amount" type="number" min="0" defaultValue={x.amount} onBlur={e=>Number(e.target.value)!==x.amount&&done(sb.from('expenses').update({amount:Number(e.target.value)}).eq('id',x.id))} className="inp !w-28"/>
<button onClick={()=>confirm('Delete this expense?')&&done(sb.from('expenses').update({deleted_at:new Date().toISOString()}).eq('id',x.id))} className="btn px-3 text-bad">Delete</button></div>)}
{!ex.length&&<p className="rounded-2xl border border-line p-4 text-ink/60">No expenses in this period. Add rent, electricity or repairs below.</p>}</div>
<form onSubmit={e=>{e.preventDefault();done(sb.from('expenses').insert({zone_id:zid,category:n.category,amount:Number(n.amount),expense_date:n.expense_date,note:n.note||null}),()=>setN({...n,amount:'',note:''}))}} className="mt-3 grid grid-cols-2 gap-2">
<select value={n.category} onChange={e=>setN({...n,category:e.target.value})} className="inp">{CATS.map(k=><option key={k}>{k}</option>)}</select><input required type="number" min="0" value={n.amount} onChange={e=>setN({...n,amount:e.target.value})} placeholder="Amount (ETB)" className="inp"/>
<input type="date" value={n.expense_date} onChange={e=>setN({...n,expense_date:e.target.value})} className="inp"/><input value={n.note} onChange={e=>setN({...n,note:e.target.value})} placeholder="Note (optional)" className="inp"/><button className="btn brand col-span-2">Add expense</button></form></section>
<section><h2 className="mb-2 font-display text-xl font-bold">Monthly recurring</h2>
<div className="space-y-2">{rx.map(x=><div key={x.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-3"><span>{x.category} · {etb(x.amount)} on day {x.day_of_month}</span><button onClick={()=>done(sb.from('recurring_expenses').update({is_active:false}).eq('id',x.id))} className="btn px-3 text-bad">Stop</button></div>)}</div>
<form onSubmit={e=>{e.preventDefault();done(sb.from('recurring_expenses').insert({zone_id:zid,category:c.category,amount:Number(c.amount),day_of_month:Number(c.day_of_month)}),()=>setC({...c,amount:''}))}} className="mt-3 grid grid-cols-3 gap-2">
<select value={c.category} onChange={e=>setC({...c,category:e.target.value})} className="inp">{CATS.map(k=><option key={k}>{k}</option>)}</select><input required type="number" min="0" value={c.amount} onChange={e=>setC({...c,amount:e.target.value})} placeholder="Amount" className="inp"/><input required type="number" min="1" max="28" value={c.day_of_month} onChange={e=>setC({...c,day_of_month:e.target.value})} placeholder="Day 1-28" className="inp"/>
<button className="btn brand col-span-3">Add monthly expense</button></form></section></main>}
