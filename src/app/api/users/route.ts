import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rateLimit'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const no = (m: string, c = 400) => NextResponse.json({ error: m }, { status: c })

export async function POST(q: Request) {
  // Rate limiting abuse protection: max 30 requests per minute per IP
  const clientIp = getClientIp(q)
  const rateLimit = checkRateLimit(clientIp, { windowMs: 60000, maxRequests: 30 })
  if (!rateLimit.allowed) {
    return no('TOO_MANY_REQUESTS', 429)
  }

  const b = await q.json().catch(() => ({}))
  const action = String(b.action || '')
  const pw = String(b.password || '')

  const a = getAdminClient()

  // 1. Owner Self-Registration (Public endpoint if enabled, strictly creating 'admin' role)
  if (action === 'register_owner') {
    const email = String(b.email || '').trim().toLowerCase()
    const fullName = String(b.full_name || '').trim()
    const zoneName = String(b.zone_name || '').trim()

    if (!email.includes('@') || pw.length < 8 || !zoneName || zoneName.length < 2) {
      return no('INVALID_INPUT', 400)
    }

    // Rate limit registration specifically: 5 attempts per 10 mins per IP
    const regLimit = checkRateLimit(`reg:${clientIp}`, { windowMs: 600000, maxRequests: 5 })
    if (!regLimit.allowed) {
      return no('TOO_MANY_REQUESTS', 429)
    }

    // Step A: Create the game zone
    const { data: zone, error: zoneErr } = await a
      .from('game_zones')
      .insert({
        name: zoneName,
        currency: 'ETB',
        timezone: 'Africa/Addis_Ababa',
        max_employees: 3,
        max_stations: 10,
        status: 'active',
      })
      .select('id')
      .single()

    if (zoneErr || !zone) {
      return no(zoneErr?.message || 'COULD_NOT_CREATE_ZONE', 400)
    }

    // Step B: Create Auth user
    const { data: authData, error: authErr } = await a.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (authErr || !authData.user) {
      await a.from('game_zones').delete().eq('id', zone.id)
      return no('USERNAME_TAKEN', 400)
    }

    // Step C: Create profile with 'admin' role ONLY (never super_admin)
    const { error: profErr } = await a.from('profiles').insert({
      id: authData.user.id,
      role: 'admin',
      full_name: fullName || 'Game Zone Owner',
      zone_id: zone.id,
      is_active: true,
      must_change_password: false,
    })

    if (profErr) {
      await a.auth.admin.deleteUser(authData.user.id)
      await a.from('game_zones').delete().eq('id', zone.id)
      return no(profErr.message, 400)
    }

    // Step D: Associate owner with game zone
    await a.from('game_zones').update({ owner_id: authData.user.id }).eq('id', zone.id)

    // Audit log
    await a.from('audit_logs').insert({
      zone_id: zone.id,
      user_id: authData.user.id,
      action: 'register_owner',
      entity: 'game_zone',
      entity_id: zone.id,
      new_state: { name: zoneName, email },
    })

    return NextResponse.json({ ok: true, zone_id: zone.id })
  }

  // 2. Authenticated Endpoints: Verify bearer token
  const tok = (q.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!tok) return no('NOT_ALLOWED', 401)

  const { data: { user }, error: userErr } = await a.auth.getUser(tok)
  if (userErr || !user) return no('NOT_ALLOWED', 401)

  const { data: me, error: meErr } = await a
    .from('profiles')
    .select('role, zone_id, is_active')
    .eq('id', user.id)
    .single()

  if (meErr || !me || !me.is_active) return no('NOT_ALLOWED', 403)

  // Verify that non-super admins belong to an active zone
  if (me.role !== 'super_admin' && me.zone_id) {
    const { data: zCheck } = await a
      .from('game_zones')
      .select('status, deleted_at')
      .eq('id', me.zone_id)
      .single()
    if (!zCheck || zCheck.status !== 'active' || zCheck.deleted_at) {
      return no('ZONE_SUSPENDED', 403)
    }
  }

  // Action: Create Employee (Owner creates employee for their zone)
  if (action === 'create_employee' && me.role === 'admin') {
    const un = String(b.username || '').trim().toLowerCase()
    const fullName = String(b.full_name || '').trim() || un

    if (!/^[a-z0-9._-]{3,30}$/.test(un) || pw.length < 8) {
      return no('INVALID_INPUT', 400)
    }

    const { data: authData, error: authErr } = await a.auth.admin.createUser({
      email: `${un}@gz.local`,
      password: pw,
      email_confirm: true,
      user_metadata: { full_name: fullName, username: un },
    })

    if (authErr || !authData.user) {
      return no('USERNAME_TAKEN', 400)
    }

    const { error: profErr } = await a.from('profiles').insert({
      id: authData.user.id,
      role: 'employee',
      full_name: fullName,
      username: un,
      zone_id: me.zone_id,
      must_change_password: true,
      is_active: true,
    })

    if (profErr) {
      await a.auth.admin.deleteUser(authData.user.id)
      return no(profErr.message, 400)
    }

    await a.from('audit_logs').insert({
      zone_id: me.zone_id,
      user_id: user.id,
      action: 'create_employee',
      entity: 'profile',
      entity_id: authData.user.id,
      new_state: { username: un, full_name: fullName },
    })

    return NextResponse.json({ ok: true, id: authData.user.id })
  }

  // Action: Create Admin (Super Admin provisions new Game Zone + Owner)
  if (action === 'create_admin' && me.role === 'super_admin') {
    const em = String(b.email || '').trim().toLowerCase()
    const fullName = String(b.full_name || '').trim() || em
    const zoneName = String(b.zone_name || '').trim()
    const maxEmp = Math.max(1, Number(b.max_employees) || 3)
    const maxStn = Math.max(1, Number(b.max_stations) || 10)

    if (!em.includes('@') || pw.length < 8 || !zoneName) {
      return no('INVALID_INPUT', 400)
    }

    const { data: z, error: ze } = await a
      .from('game_zones')
      .insert({
        name: zoneName,
        max_employees: maxEmp,
        max_stations: maxStn,
        currency: 'ETB',
        timezone: 'Africa/Addis_Ababa',
        status: 'active',
      })
      .select('id')
      .single()

    if (ze || !z) return no(ze?.message || 'INVALID_INPUT', 400)

    const { data: authData, error: authErr } = await a.auth.admin.createUser({
      email: em,
      password: pw,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (authErr || !authData.user) {
      await a.from('game_zones').delete().eq('id', z.id)
      return no('USERNAME_TAKEN', 400)
    }

    const { error: profErr } = await a.from('profiles').insert({
      id: authData.user.id,
      role: 'admin',
      full_name: fullName,
      zone_id: z.id,
      must_change_password: true,
      is_active: true,
    })

    if (profErr) {
      await a.auth.admin.deleteUser(authData.user.id)
      await a.from('game_zones').delete().eq('id', z.id)
      return no(profErr.message, 400)
    }

    await a.from('game_zones').update({ owner_id: authData.user.id }).eq('id', z.id)

    await a.from('audit_logs').insert({
      zone_id: z.id,
      user_id: user.id,
      action: 'create_admin',
      entity: 'game_zone',
      entity_id: z.id,
      new_state: { name: zoneName, owner_email: em },
    })

    return NextResponse.json({ ok: true, id: authData.user.id })
  }

  // Action: Reset Password
  if (action === 'reset_password' && b.id !== user.id && pw.length >= 8) {
    const { data: target } = await a
      .from('profiles')
      .select('role, zone_id, full_name')
      .eq('id', b.id)
      .single()

    const ok =
      target &&
      ((me.role === 'super_admin' && target.role === 'admin') ||
        (me.role === 'admin' && target.role === 'employee' && target.zone_id === me.zone_id))

    if (!ok) return no('NOT_ALLOWED', 403)

    const { error: updateErr } = await a.auth.admin.updateUserById(b.id, { password: pw })
    if (updateErr) return no('INVALID_INPUT', 400)

    await a.from('profiles').update({ must_change_password: true }).eq('id', b.id)
    await a.from('audit_logs').insert({
      zone_id: target.zone_id,
      user_id: user.id,
      action: 'reset_password',
      entity: 'profile',
      entity_id: b.id,
      reason: b.reason || 'Admin password reset',
    })

    return NextResponse.json({ ok: true })
  }

  // Action: Set Active / Suspended
  if (action === 'set_active' && b.id !== user.id) {
    const { data: target } = await a
      .from('profiles')
      .select('role, zone_id')
      .eq('id', b.id)
      .single()

    const ok =
      target &&
      ((me.role === 'super_admin' && target.role === 'admin') ||
        (me.role === 'admin' && target.role === 'employee' && target.zone_id === me.zone_id))

    if (!ok) return no('NOT_ALLOWED', 403)

    const isActive = !!b.active
    await a.from('profiles').update({ is_active: isActive }).eq('id', b.id)
    await a.auth.admin.updateUserById(b.id, { ban_duration: isActive ? 'none' : '876000h' })

    await a.from('audit_logs').insert({
      zone_id: target.zone_id,
      user_id: user.id,
      action: isActive ? 'activate_user' : 'deactivate_user',
      entity: 'profile',
      entity_id: b.id,
    })

    return NextResponse.json({ ok: true })
  }

  // Action: Delete Self (Owner closes their zone)
  if (action === 'delete_self' && me.role === 'admin') {
    const now = new Date().toISOString()
    const { data: ps } = await a.from('profiles').select('id').eq('zone_id', me.zone_id)

    await a
      .from('game_zones')
      .update({ deleted_at: now, status: 'suspended' })
      .eq('id', me.zone_id)
    await a.from('profiles').update({ is_active: false }).eq('zone_id', me.zone_id)
    await a.from('profiles').update({ deleted_at: now }).eq('id', user.id)

    for (const x of ps || []) {
      await a.auth.admin.updateUserById(x.id, { ban_duration: '876000h' })
    }

    await a.from('audit_logs').insert({
      zone_id: me.zone_id,
      user_id: user.id,
      action: 'delete_zone',
      entity: 'game_zone',
      entity_id: me.zone_id,
    })

    return NextResponse.json({ ok: true })
  }

  return no('NOT_ALLOWED', 403)
}
