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

async function handlePost(q: Request) {
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
        status: 'suspended',
        owner_approved: false,
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
      is_active: false,
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

  if (action === 'list_tenants' && me.role === 'super_admin') {
    const { data: zones, error: zonesError } = await a
      .from('game_zones')
      .select('id, owner_id, name, status, owner_approved, max_employees, max_stations, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (zonesError) return no(zonesError.message, 400)
    if (!zones?.length) return NextResponse.json({ tenants: [] })

    const zoneIds = zones.map((zone) => zone.id)
    const { data: profiles, error: profilesError } = await a
      .from('profiles')
      .select('id, role, zone_id, full_name, username, is_active, deleted_at')
      .in('zone_id', zoneIds)
      .is('deleted_at', null)
    if (profilesError) return no(profilesError.message, 400)

    const membersByZone = new Map<string, typeof profiles>()
    for (const profile of profiles || []) {
      const members = membersByZone.get(profile.zone_id!) || []
      members.push(profile)
      membersByZone.set(profile.zone_id!, members)
    }

    const tenants = await Promise.all(zones.map(async (zone) => {
      const members = membersByZone.get(zone.id) || []
      const owner = members.find((member) => member.id === zone.owner_id) ||
        members.find((member) => member.role === 'admin') || null
      const staff = members.filter((member) => member.role === 'employee')
      const { data: authData } = owner ? await a.auth.admin.getUserById(owner.id) : { data: null }
      return {
        ...zone,
        owner: owner ? { ...owner, email: authData?.user?.email || '' } : null,
        staff,
      }
    }))

    return NextResponse.json({ tenants })
  }

  if (action === 'approve_owner' && me.role === 'super_admin') {
    const zoneId = String(b.zone_id || '')
    const { data: zone } = await a.from('game_zones').select('id, owner_id, deleted_at').eq('id', zoneId).single()
    if (!zone || zone.deleted_at) return no('NOT_ALLOWED', 404)

    const { data: owner } = await a.from('profiles').select('id, role').eq('id', zone.owner_id).eq('zone_id', zoneId).single()
    if (!owner || owner.role !== 'admin') return no('NOT_ALLOWED', 404)

    const { error: zoneError } = await a.from('game_zones').update({ owner_approved: true, status: 'active' }).eq('id', zoneId)
    if (zoneError) return no(zoneError.message, 400)
    const { error: profileError } = await a.from('profiles').update({ is_active: true }).eq('id', owner.id)
    if (profileError) return no(profileError.message, 400)
    const { error: authError } = await a.auth.admin.updateUserById(owner.id, { ban_duration: 'none' })
    if (authError) return no(authError.message, 400)

    await a.from('audit_logs').insert({ zone_id: zoneId, user_id: user.id, action: 'approve_owner', entity: 'game_zone', entity_id: zoneId })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_owner_access' && me.role === 'super_admin') {
    const zoneId = String(b.zone_id || '')
    const active = Boolean(b.active)
    const { data: zone } = await a.from('game_zones').select('id, owner_id, owner_approved, deleted_at').eq('id', zoneId).single()
    if (!zone || zone.deleted_at || !zone.owner_id) return no('NOT_ALLOWED', 404)
    if (active && !zone.owner_approved) return no('OWNER_APPROVAL_REQUIRED', 403)
    const { data: owner } = await a.from('profiles').select('id, role').eq('id', zone.owner_id).eq('zone_id', zoneId).single()
    if (!owner || owner.role !== 'admin') return no('NOT_ALLOWED', 404)

    const { error: zoneError } = await a.from('game_zones').update({ status: active ? 'active' : 'suspended' }).eq('id', zoneId)
    if (zoneError) return no(zoneError.message, 400)
    const { error: profileError } = await a.from('profiles').update({ is_active: active }).eq('id', owner.id)
    if (profileError) return no(profileError.message, 400)
    const { error: authError } = await a.auth.admin.updateUserById(owner.id, { ban_duration: active ? 'none' : '876000h' })
    if (authError) return no(authError.message, 400)
    await a.from('audit_logs').insert({
      zone_id: zoneId,
      user_id: user.id,
      action: active ? 'activate_owner' : 'suspend_owner',
      entity: 'game_zone',
      entity_id: zoneId,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'update_owner' && me.role === 'super_admin') {
    const zoneId = String(b.zone_id || '')
    const email = String(b.email || '').trim().toLowerCase()
    const fullName = String(b.full_name || '').trim()
    const zoneName = String(b.zone_name || '').trim()
    const maxEmployees = Number(b.max_employees)
    const maxStations = Number(b.max_stations)
    if (!zoneId || !email.includes('@') || !fullName || !zoneName ||
      !Number.isInteger(maxEmployees) || maxEmployees < 1 ||
      !Number.isInteger(maxStations) || maxStations < 1) return no('INVALID_INPUT', 400)

    const { data: zone } = await a.from('game_zones').select('id, owner_id, deleted_at').eq('id', zoneId).single()
    if (!zone || zone.deleted_at || !zone.owner_id) return no('NOT_ALLOWED', 404)
    const { data: owner } = await a.from('profiles').select('id, role, full_name, zone_id').eq('id', zone.owner_id).single()
    if (!owner || owner.role !== 'admin' || owner.zone_id !== zoneId) return no('NOT_ALLOWED', 404)

    const { error: authError } = await a.auth.admin.updateUserById(owner.id, {
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authError) return no(authError.message, 400)
    const { error: profileError } = await a.from('profiles').update({ full_name: fullName }).eq('id', owner.id)
    if (profileError) return no(profileError.message, 400)
    const { error: zoneError } = await a.from('game_zones').update({
      name: zoneName,
      max_employees: maxEmployees,
      max_stations: maxStations,
    }).eq('id', zoneId)
    if (zoneError) return no(zoneError.message, 400)

    await a.from('audit_logs').insert({
      zone_id: zoneId,
      user_id: user.id,
      action: 'update_owner',
      entity: 'game_zone',
      entity_id: zoneId,
      new_state: { zone_name: zoneName, owner_email: email, owner_name: fullName, max_employees: maxEmployees, max_stations: maxStations },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_owner' && me.role === 'super_admin') {
    const zoneId = String(b.zone_id || '')
    const { data: zone } = await a.from('game_zones').select('id, owner_id, deleted_at').eq('id', zoneId).single()
    if (!zone || zone.deleted_at || !zone.owner_id) return no('NOT_ALLOWED', 404)
    const { data: members } = await a.from('profiles').select('id, role').eq('zone_id', zoneId)
    if (!members?.some((member) => member.id === zone.owner_id && member.role === 'admin')) return no('NOT_ALLOWED', 404)

    const now = new Date().toISOString()
    const { error: zoneError } = await a.from('game_zones').update({ deleted_at: now, status: 'suspended' }).eq('id', zoneId)
    if (zoneError) return no(zoneError.message, 400)
    const { error: profilesError } = await a.from('profiles').update({ is_active: false, deleted_at: now }).eq('zone_id', zoneId)
    if (profilesError) return no(profilesError.message, 400)
    for (const member of members) {
      await a.auth.admin.updateUserById(member.id, { ban_duration: '876000h' })
    }
    await a.from('audit_logs').insert({ zone_id: zoneId, user_id: user.id, action: 'delete_owner', entity: 'game_zone', entity_id: zoneId })
    return NextResponse.json({ ok: true })
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
      ((me.role === 'super_admin' && (target.role === 'admin' || target.role === 'employee')) ||
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
      .select('role, zone_id, is_active')
      .eq('id', b.id)
      .single()

    const ok =
      target &&
      ((me.role === 'super_admin' && target.role === 'employee') ||
        (me.role === 'admin' && target.role === 'employee' && target.zone_id === me.zone_id))

    if (!ok) return no('NOT_ALLOWED', 403)
    if (typeof b.active !== 'boolean') return no('INVALID_INPUT', 400)

    const isActive = b.active
    const { error: profileUpdateError } = await a.from('profiles').update({ is_active: isActive }).eq('id', b.id)
    if (profileUpdateError) return no(profileUpdateError.message, 400)
    const { error: authUpdateError } = await a.auth.admin.updateUserById(b.id, { ban_duration: isActive ? 'none' : '876000h' })
    if (authUpdateError) {
      await a.from('profiles').update({ is_active: target.is_active }).eq('id', b.id)
      return no(authUpdateError.message, 400)
    }

    await a.from('audit_logs').insert({
      zone_id: target.zone_id,
      user_id: user.id,
      action: isActive ? 'activate_user' : 'deactivate_user',
      entity: 'profile',
      entity_id: b.id,
    })

    return NextResponse.json({ ok: true })
  }

  // Action: Update an employee's login name and profile details.
  if (action === 'update_employee' && b.id !== user.id && (me.role === 'admin' || me.role === 'super_admin')) {
    const id = String(b.id || '')
    const username = String(b.username || '').trim().toLowerCase()
    const fullName = String(b.full_name || '').trim()
    if (!/^[a-z0-9._-]{3,30}$/.test(username) || !fullName) return no('INVALID_INPUT', 400)

    const { data: target } = await a
      .from('profiles')
      .select('role, zone_id, username, full_name')
      .eq('id', id)
      .single()
    if (!target || target.role !== 'employee' || (me.role === 'admin' && target.zone_id !== me.zone_id)) return no('NOT_ALLOWED', 403)

    const { error: authUpdateError } = await a.auth.admin.updateUserById(id, {
      email: `${username}@gz.local`,
      email_confirm: true,
      user_metadata: { full_name: fullName, username },
    })
    if (authUpdateError) return no(authUpdateError.message, 400)

    const { error: profileUpdateError } = await a
      .from('profiles')
      .update({ username, full_name: fullName })
      .eq('id', id)
    if (profileUpdateError) return no(profileUpdateError.message, 400)

    await a.from('audit_logs').insert({
      zone_id: target.zone_id,
      user_id: user.id,
      action: 'update_employee',
      entity: 'profile',
      entity_id: id,
      previous_state: { username: target.username, full_name: target.full_name },
      new_state: { username, full_name: fullName },
    })
    return NextResponse.json({ ok: true })
  }

  // Soft-delete employee accounts to preserve their historical records.
  if (action === 'delete_employee' && b.id !== user.id && (me.role === 'admin' || me.role === 'super_admin')) {
    const id = String(b.id || '')
    const { data: target } = await a
      .from('profiles')
      .select('role, zone_id, username, full_name')
      .eq('id', id)
      .single()
    if (!target || target.role !== 'employee' || (me.role === 'admin' && target.zone_id !== me.zone_id)) return no('NOT_ALLOWED', 403)

    const deletedAt = new Date().toISOString()
    const { error: profileUpdateError } = await a
      .from('profiles')
      .update({ is_active: false, deleted_at: deletedAt })
      .eq('id', id)
    if (profileUpdateError) return no(profileUpdateError.message, 400)

    const { error: authUpdateError } = await a.auth.admin.updateUserById(id, { ban_duration: '876000h' })
    if (authUpdateError) return no(authUpdateError.message, 400)

    await a.from('audit_logs').insert({
      zone_id: target.zone_id,
      user_id: user.id,
      action: 'delete_employee',
      entity: 'profile',
      entity_id: id,
      previous_state: { username: target.username, full_name: target.full_name },
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

export async function POST(q: Request) {
  try {
    return await handlePost(q)
  } catch (error) {
    console.error('User management request failed:', error)
    return no('INTERNAL_ERROR', 500)
  }
}
