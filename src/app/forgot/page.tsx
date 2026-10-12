'use client'
import {useState} from 'react'
import {sb} from '@/lib/supabase'
export default function Forgot(){const [e,setE]=useState(''),[sent,setS]=useState(false),[b,setB]=useState(false)
return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"><h1 className="font-display text-3xl font-bold">Reset password</h1>
{sent?<p className="mt-4 text-ink/70">If that email has an account, a reset link is on its way. Check your inbox.</p>:<form onSubmit={async ev=>{ev.preventDefault();setB(true);await sb.auth.resetPasswordForEmail(e.trim(),{redirectTo:`${location.origin}/reset`});setS(true)}} className="mt-4 space-y-3">
<p className="text-sm text-ink/60">Owners can reset by email. Employees: ask your owner to set a new password.</p><input required type="email" value={e} onChange={x=>setE(x.target.value)} placeholder="Email" className="inp"/><button disabled={b} className="btn brand w-full">Send reset link</button></form>}
<a href="/login" className="mt-6 text-brand underline">Back to sign in</a></main>}
