/**
 * Supabase Client
 *
 * Singleton client for Supabase connection.
 * Uses service role key for backend operations (bypasses RLS).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let instance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (instance) return instance;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[Supabase] Missing credentials - running in offline mode');
    return createMockClient();
  }

  instance = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('[Supabase] Client initialized');
  return instance;
}

/**
 * Mock client for development without Supabase credentials
 */
function createMockClient(): SupabaseClient {
  const mockData = {
    id: Date.now(),
    transcript_chunk: [],
    transcript: ''
  };

  return {
    from: () => ({
      insert: async () => ({ data: mockData, error: null }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mockData, error: null }),
          order: () => ({
            limit: () => ({
              single: async () => ({ data: mockData, error: null })
            })
          })
        }),
        single: async () => ({ data: mockData, error: null })
      }),
      update: () => ({
        eq: async () => ({ data: null, error: null })
      })
    })
  } as unknown as SupabaseClient;
}

export type { SupabaseClient };
