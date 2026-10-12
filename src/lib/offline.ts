import {sb} from './supabase'
type Op={fn:'adjust_session'|'end_session';args:Record<string,unknown>}
const K='gz-queue',F='gz-failed'
const rd=<T,>(k:string):T[]=>{try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return[]}}
const wr=(k:string,v:unknown)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
const net=(m:string)=>/fetch|network|load failed/i.test(m)
export const pending=()=>rd<Op>(K).length
export const failed=()=>rd<{fn:string;error:string}>(F)
export const clearFailed=()=>wr(F,[])
const push=(o:Op)=>wr(K,[...rd<Op>(K),o])
export async function call(fn:Op['fn'],args:Record<string,unknown>){
if(typeof navigator!=='undefined'&&!navigator.onLine){push({fn,args});return {error:null}}
const {error}=await sb.rpc(fn,args);if(error&&net(error.message)){push({fn,args});return {error:null}}
return {error}}
export async function flush(){const left:Op[]=[];let stop=false
for(const op of rd<Op>(K)){if(stop){left.push(op);continue}
const {error}=await sb.rpc(op.fn,op.args)
if(error&&net(error.message)){stop=true;left.push(op)}else if(error&&!/SESSION_ALREADY_ENDED/.test(error.message))wr(F,[...rd(F),{fn:op.fn,error:error.message}])}
wr(K,left);return left.length}
