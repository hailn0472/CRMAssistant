import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

function createSupabaseClient(): SupabaseClient {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
    {
      auth: {
        persistSession: false, // JWT is managed by our backend, not Supabase session
      },
    },
  )
}

let _client: SupabaseClient | undefined

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createSupabaseClient()
  }
  return _client
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})
