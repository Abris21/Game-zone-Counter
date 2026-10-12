'use client'
import {useEffect,useState} from 'react'
import {sb} from '@/lib/supabase'
export default function Reset(){const [ready,setReady]=useState(false),[pw,setPw]=useState(''),[err,setErr]=useState(''),[done,setDone]=useState(false)
useEffect(()=>{sb.auth.getSession().then(({data})=>data.session&&setReady(true));const {data:s}=sb.auth.onAuthStateChange(ev=>{if(ev==='PASSWORD_RECOVERY')setReady(true)});return()=>s.subscription.unsubscribe()},[])
return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"><h1 className="font-display text-3xl font-bold">Choose a new password</h1>
{done?<p className="mt-4 text-ok">Password updated.</p>:!ready?<p className="mt-4 text-ink/60">Open this page from the link in your email.</p>:<form onSubmit={async e=>{e.preventDefault();if(pw.length<8){setErr('Use 8 or more characters.');return}const {error}=await sb.auth.updateUser({password:pw});if(error)setErr(error.message);else{await sb.auth.signOut();setDone(true)}}} className="mt-4 space-y-3">
<input required type="password" autoComplete="new-password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="New password" className="inp"/>{err&&<p role="alert" className="text-sm text-bad">{err}</p>}<button className="btn brand w-full">Update password</button></form>}
<a href="/login" className="mt-6 text-brand underline">Back to sign in</a></main>}
