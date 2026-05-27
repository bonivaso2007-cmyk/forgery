import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = Boolean(supabaseClient);

export async function getCurrentSessionUser() {
  if (!supabaseClient) {
    return null;
  }

  const { data } = await supabaseClient.auth.getSession();
  return data.session?.user ?? null;
}
