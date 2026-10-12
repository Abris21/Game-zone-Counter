'use client'
import {useEffect,useState} from 'react'
import {flush,pending,failed,clearFailed} from '@/lib/offline'
export default function NetBanner({onSynced}:{onSynced:()=>void}){const [on,setOn]=useState(true),[p,setP]=useState(0),[f,setF]=useState(0)
useEffect(()=>{const tick=async()=>{setOn(navigator.onLine);if(navigator.onLine&&pending()){await flush();onSynced()};setP(pending());setF(failed().length)}
tick();const t=setInterval(tick,4000);addEventListener('online',tick);addEventListener('offline',tick);return()=>{clearInterval(t);removeEventListener('online',tick);removeEventListener('offline',tick)}},[onSynced])
if(on&&!p&&!f)return null
return <div role="status" className={`mb-4 rounded-xl border p-3 text-sm ${on&&!f?'border-ok/40 bg-ok/10':'border-bad/40 bg-bad/10'}`}>{!on&&`You are offline. Counting and ending sessions still work; ${p} action(s) will sync automatically. Starting sessions and snack sales need a connection.`}{on&&!!p&&`Syncing ${p} saved action(s)…`}{!!f&&<> {f} action(s) could not be saved because the session was changed elsewhere. <button onClick={()=>{clearFailed();setF(0)}} className="underline">Dismiss</button></>}</div>}
