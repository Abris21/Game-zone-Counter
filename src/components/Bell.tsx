'use client'
import {useCallback,useEffect,useState} from 'react'
import {sb} from '@/lib/supabase'
type N={id:string;title:string;body:string|null;read_at:string|null;created_at:string}
export default function Bell(){const [n,setN]=useState<N[]>([]),[open,setOpen]=useState(false),[perm,setPerm]=useState('default')
const load=useCallback(async()=>{const {data}=await sb.from('notifications').select('id,title,body,read_at,created_at').order('created_at',{ascending:false}).limit(30);setN((data as N[])||[])},[])
useEffect(()=>{if('Notification' in window)setPerm(Notification.permission);let c:ReturnType<typeof sb.channel>|null=null
sb.auth.getUser().then(({data:{user}})=>{if(!user)return;load();c=sb.channel('notif').on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},p=>{const x=p.new as N;setN(o=>[x,...o]);if('Notification' in window&&Notification.permission==='granted')new Notification(x.title,{body:x.body??'',icon:'/icon-192.png'})}).subscribe()})
return()=>{if(c)sb.removeChannel(c)}},[load])
const unread=n.filter(x=>!x.read_at).length
return <div className="relative inline-block"><button aria-label={`Alerts, ${unread} unread`} onClick={()=>setOpen(!open)} className="rounded-xl border border-line px-3 py-2 text-sm">Alerts{!!unread&&<span className="ml-1 rounded-full bg-brand px-1.5 text-xs text-white">{unread}</span>}</button>
{open&&<div className="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-left shadow-xl">
<div className="mb-2 flex justify-between text-xs"><button onClick={async()=>{await sb.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null);load()}} className="text-brand underline">Mark all read</button>
{'Notification' in window&&perm==='default'&&<button onClick={async()=>setPerm(await Notification.requestPermission())} className="text-brand underline">Turn on phone alerts</button>}</div>
{n.map(x=><div key={x.id} className="border-t border-line py-2 text-sm"><p className={x.read_at?'':'font-semibold'}>{x.title}</p>{x.body&&<p className="text-ink/60">{x.body}</p>}<p className="text-xs text-ink/40">{new Date(x.created_at).toLocaleString()}</p></div>)}
{!n.length&&<p className="text-sm text-ink/60">No alerts yet.</p>}</div>}</div>}
