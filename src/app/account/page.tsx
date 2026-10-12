'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb,api,msg} from '@/lib/supabase'
import Prefs from '@/components/Prefs'
export default function Account(){const r=useRouter()
const [me,setMe]=useState<{email:string;role:string}|null>(null),[name,setName]=useState(''),[cur,setCur]=useState(''),[pw,setPw]=useState(''),[dc,setDc]=useState(''),[dp,setDp]=useState(''),[force,setForce]=useState(false),[ok,setOk]=useState(''),[err,setErr]=useState('')
useEffect(()=>{setForce(location.search.includes('force=1'));(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user){r.replace('/login');return}const p=await sb.from('profiles').select('full_name,role').eq('id',user.id).single();setMe({email:user.email||'',role:p.data?.role||''});setName(p.data?.full_name||'')})()},[r])
const say=(o:string,e='')=>{setOk(o);setErr(e)}
const reauth=async(p:string)=>!(await sb.auth.signInWithPassword({email:me!.email,password:p})).error
const saveName=async(e:React.FormEvent)=>{e.preventDefault();const {error}=await sb.rpc('update_profile',{p_name:name});error?say('',msg(error)):say('Name saved.')}
const changePw=async(e:React.FormEvent)=>{e.preventDefault();if(pw.length<8)return say('','New password needs 8 or more characters.');if(!await reauth(cur))return say('','Current password is wrong.')
const {error}=await sb.auth.updateUser({password:pw});if(error)return say('',error.message);setCur('');setPw('');await sb.rpc('clear_must_change');if(force)r.replace(home);else say('Password changed.')}
const delAcc=async(e:React.FormEvent)=>{e.preventDefault();if(dc!=='DELETE')return say('','Type DELETE to confirm.');if(!await reauth(dp))return say('','Password is wrong.')
const {error}=await api({action:'delete_self'});if(error)return say('',msg(error));await sb.auth.signOut();r.replace('/login')}
if(!me)return null
const home={employee:'/counter',admin:'/monitor',super_admin:'/super'}[me.role]??'/login'
return <main className="mx-auto max-w-md space-y-6 px-4 pb-24 pt-6"><header className="flex items-end justify-between"><h1 className="font-display text-3xl font-bold">Account</h1>{!force&&<a href={home} className="text-brand underline">Back</a>}</header>
{force&&<p className="rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm">Please choose a new password before you continue.</p>}
{ok&&<p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{ok}</p>}{err&&<p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">{err}</p>}
<form onSubmit={saveName} className="space-y-2 rounded-2xl border border-line bg-surface p-4"><h2 className="font-display text-xl font-bold">Your name</h2><input required value={name} onChange={e=>setName(e.target.value)} className="inp"/><button className="btn brand w-full">Save name</button></form>
<form onSubmit={changePw} className="space-y-2 rounded-2xl border border-line bg-surface p-4"><h2 className="font-display text-xl font-bold">Change password</h2>
<input required type="password" autoComplete="current-password" value={cur} onChange={e=>setCur(e.target.value)} placeholder="Current password" className="inp"/><input required type="password" autoComplete="new-password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="New password (8+ characters)" className="inp"/><button className="btn brand w-full">Change password</button></form>
<Prefs/>
<button onClick={async()=>{await sb.auth.signOut({scope:'global'});r.replace('/login')}} className="btn w-full border border-line">Sign out on all devices</button>
{me.role==='admin'&&<form onSubmit={delAcc} className="space-y-2 rounded-2xl border border-bad/50 bg-surface p-4"><h2 className="font-display text-xl font-bold text-bad">Delete my game zone</h2>
<p className="text-sm text-ink/70">This closes your account and deactivates all your employees. Export your reports from Finance first. Support can restore it within 30 days.</p>
<input value={dc} onChange={e=>setDc(e.target.value)} placeholder="Type DELETE" className="inp"/><input type="password" value={dp} onChange={e=>setDp(e.target.value)} placeholder="Your password" className="inp"/><button className="btn w-full border border-bad text-bad">Delete everything</button></form>}
{me.role==='employee'&&<p className="text-sm text-ink/60">To remove your account, ask your owner to deactivate it. Your past work stays on record.</p>}</main>}
