import {createClient} from '@supabase/supabase-js'
import {NextResponse} from 'next/server'
const a=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
const no=(m:string,c=400)=>NextResponse.json({error:m},{status:c})
export async function POST(q:Request){
const tok=(q.headers.get('authorization')||'').replace('Bearer ','');const {data:{user}}=await a.auth.getUser(tok);if(!user)return no('NOT_ALLOWED',401)
const {data:me}=await a.from('profiles').select('role,zone_id,is_active').eq('id',user.id).single();if(!me?.is_active)return no('NOT_ALLOWED',403)
const b=await q.json().catch(()=>({}));const pw=String(b.password||'')
if(b.action==='create_employee'&&me.role==='admin'){const un=String(b.username||'').trim().toLowerCase()
if(!/^[a-z0-9._-]{3,30}$/.test(un)||pw.length<8)return no('INVALID_INPUT')
const {data,error}=await a.auth.admin.createUser({email:`${un}@gz.local`,password:pw,email_confirm:true});if(error||!data.user)return no('USERNAME_TAKEN')
const {error:e}=await a.from('profiles').insert({id:data.user.id,role:'employee',full_name:b.full_name||un,username:un,zone_id:me.zone_id,must_change_password:true})
if(e){await a.auth.admin.deleteUser(data.user.id);return no(e.message)};return NextResponse.json({ok:true})}
if(b.action==='create_admin'&&me.role==='super_admin'){const em=String(b.email||'').trim().toLowerCase();if(!em.includes('@')||pw.length<8||!b.zone_name)return no('INVALID_INPUT')
const {data:z,error:ze}=await a.from('game_zones').insert({name:b.zone_name,max_employees:Number(b.max_employees)||3,max_stations:Number(b.max_stations)||10}).select('id').single();if(ze||!z)return no(ze?.message||'INVALID_INPUT')
const {data,error}=await a.auth.admin.createUser({email:em,password:pw,email_confirm:true});if(error||!data.user){await a.from('game_zones').delete().eq('id',z.id);return no('USERNAME_TAKEN')}
const {error:e}=await a.from('profiles').insert({id:data.user.id,role:'admin',full_name:b.full_name||em,zone_id:z.id,must_change_password:true})
if(e){await a.auth.admin.deleteUser(data.user.id);await a.from('game_zones').delete().eq('id',z.id);return no(e.message)}
await a.from('game_zones').update({owner_id:data.user.id}).eq('id',z.id);return NextResponse.json({ok:true})}
if(b.action==='reset_password'&&b.id!==user.id&&pw.length>=8){const {data:t}=await a.from('profiles').select('role,zone_id').eq('id',b.id).single()
const ok=t&&((me.role==='super_admin'&&t.role==='admin')||(me.role==='admin'&&t.role==='employee'&&t.zone_id===me.zone_id));if(!ok)return no('NOT_ALLOWED',403)
const {error}=await a.auth.admin.updateUserById(b.id,{password:pw});if(error)return no('INVALID_INPUT');await a.from('profiles').update({must_change_password:true}).eq('id',b.id);await a.from('audit_logs').insert({zone_id:t.zone_id,user_id:user.id,action:'reset_password',entity:'profile',entity_id:b.id});return NextResponse.json({ok:true})}
if(b.action==='delete_self'&&me.role==='admin'){const now=new Date().toISOString();const {data:ps}=await a.from('profiles').select('id').eq('zone_id',me.zone_id)
await a.from('game_zones').update({deleted_at:now,status:'suspended'}).eq('id',me.zone_id);await a.from('profiles').update({is_active:false}).eq('zone_id',me.zone_id);await a.from('profiles').update({deleted_at:now}).eq('id',user.id)
for(const x of ps||[])await a.auth.admin.updateUserById(x.id,{ban_duration:'876000h'});await a.from('audit_logs').insert({zone_id:me.zone_id,user_id:user.id,action:'delete_zone',entity:'game_zone',entity_id:me.zone_id});return NextResponse.json({ok:true})}
if(b.action==='set_active'&&b.id!==user.id){const {data:t}=await a.from('profiles').select('role,zone_id').eq('id',b.id).single()
const ok=t&&((me.role==='super_admin'&&t.role==='admin')||(me.role==='admin'&&t.role==='employee'&&t.zone_id===me.zone_id));if(!ok)return no('NOT_ALLOWED',403)
await a.from('profiles').update({is_active:!!b.active}).eq('id',b.id);await a.auth.admin.updateUserById(b.id,{ban_duration:b.active?'none':'876000h'});return NextResponse.json({ok:true})}
return no('NOT_ALLOWED',403)}
