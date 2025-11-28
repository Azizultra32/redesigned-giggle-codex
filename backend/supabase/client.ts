import { SupabaseClient, createClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase credentials missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  }

  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false
    }
  });

  return cachedClient;
}

export type { SupabaseClient };
