'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {sb} from '@/lib/supabase'
import Orb from '@/components/Orb'
import LangSwitch from '@/components/LangSwitch'
import {useT} from '@/lib/i18n'
export default function Login(){const r=useRouter();const t=useT();const [u,setU]=useState(''),[p,setP]=useState(''),[e,setE]=useState(''),[b,setB]=useState(false)
useEffect(()=>{const h:Record<string,string>={employee:'/counter',admin:'/monitor',super_admin:'/super'};const role=localStorage.getItem('gz-role');sb.auth.getSession().then(({data})=>{if(data.session&&role&&h[role])r.replace(h[role])})},[r])
const go=async(ev:React.FormEvent)=>{ev.preventDefault();setB(true);setE('')
const {data,error}=await sb.auth.signInWithPassword({email:u.includes('@')?u.trim():`${u.trim().toLowerCase()}@gz.local`,password:p})
if(error||!data.user){setE(t('Wrong username or password.'));setB(false);return}
const {data:pr}=await sb.from('profiles').select('role,is_active,must_change_password').eq('id',data.user.id).single()
if(!pr||!pr.is_active){await sb.auth.signOut();setE(t('This account is deactivated. Ask your manager.'));setB(false);return}
if(pr.role!=='super_admin'){const {data:ok}=await sb.rpc('zone_ok');if(!ok){await sb.auth.signOut();setE(t('This game zone is suspended or closed. Contact the platform owner.'));setB(false);return}}
if(pr.must_change_password){r.replace('/account?force=1');return}
localStorage.setItem('gz-role',pr.role);
r.replace({employee:'/counter',admin:'/monitor',super_admin:'/super'}[pr.role as string]??'/login')}
return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"><Orb/>
<h1 className="-mt-4 text-center font-display text-5xl font-bold text-ink">{t('Game Zone')}</h1>
<p className="mb-8 mt-2 text-center text-ink/60">{t('Sign in to start counting')}</p>
<form onSubmit={go} className="space-y-3">
<input value={u} onChange={x=>setU(x.target.value)} required autoComplete="username" placeholder={t('Username or email')} className="h-14 w-full rounded-xl border border-line bg-surface px-4"/>
<input value={p} onChange={x=>setP(x.target.value)} required type="password" autoComplete="current-password" placeholder={t('Password')} className="h-14 w-full rounded-xl border border-line bg-surface px-4"/>
{e&&<p role="alert" className="text-sm text-bad">{e}</p>}
<a href="/forgot" className="block text-center text-sm text-brand underline">{t('Forgot password?')}</a>
<button disabled={b} className="btn brand w-full">{b?t('Signing in…'):t('Sign in')}</button></form><LangSwitch/></main>}
