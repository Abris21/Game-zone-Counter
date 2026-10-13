import { describe, it, expect } from 'vitest'
import { isSupabaseConfigured, normalizeSupabaseConfig } from '../lib/supabase'

describe('Supabase configuration guard', () => {
    it('treats placeholder credentials as unconfigured', () => {
        expect(isSupabaseConfigured('https://placeholder.supabase.co', 'placeholder')).toBe(false)
        expect(
            normalizeSupabaseConfig('https://placeholder.supabase.co', 'placeholder')
        ).toMatchObject({ configured: false })
    })

    it('accepts real project configuration values', () => {
        const config = normalizeSupabaseConfig('https://project.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc')
        expect(config.configured).toBe(true)
        expect(isSupabaseConfigured('https://project.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc')).toBe(true)
    })
})
