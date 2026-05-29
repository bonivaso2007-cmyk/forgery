import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const isSupabaseConfigured = Boolean(supabaseClient);

export type User = {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
};

export type Profile = {
  id: string;
  name: string;
  stage: string;
  geo: string;
  customer: string;
  problem: string;
  solution: string;
  market: string;
  revenue: string;
  channels: string;
  constraints: string;
  strengths: string;
  risks: string;
  goals: string;
};

export type Idea = {
  id: string;
  user_id: string;
  idea_text: string;
  score: number;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  moves: string[];
  provider: string;
  model: string;
  is_favorite: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type IdeaCollection = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  idea_ids: string[];
  created_at: string;
  updated_at: string;
};

// Auth functions
export async function signInWithGoogle() {
  if (!supabaseClient) throw new Error('Supabase not configured');
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabaseClient) throw new Error('Supabase not configured');
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data.user;
}

export async function signUpWithEmail(email: string, password: string, name?: string) {
  if (!supabaseClient) throw new Error('Supabase not configured');
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name || email.split('@')[0],
      },
    },
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  if (!supabaseClient) throw new Error('Supabase not configured');
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

export async function getCurrentSession() {
  if (!supabaseClient) return null;
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

export async function getCurrentUser(): Promise<User | null> {
  if (!supabaseClient) return null;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.name || user.email?.split('@')[0] || '',
    avatar_url: user.user_metadata?.avatar_url,
  };
}

// Profile functions
export async function getProfile(userId: string): Promise<Profile | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertProfile(userId: string, profile: Partial<Profile>): Promise<Profile | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert({ id: userId, ...profile })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Ideas functions
export async function saveIdea(idea: Omit<Idea, 'id' | 'created_at' | 'updated_at'>): Promise<Idea | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('ideas')
    .insert(idea)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getIdeas(userId: string, limit = 50): Promise<Idea[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('ideas')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function updateIdea(id: string, updates: Partial<Idea>): Promise<Idea | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('ideas')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteIdea(id: string): Promise<boolean> {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient
    .from('ideas')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

// Collections functions
export async function getCollections(userId: string): Promise<IdeaCollection[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('idea_collections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createCollection(userId: string, name: string, description = ''): Promise<IdeaCollection | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('idea_collections')
    .insert({ user_id: userId, name, description })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateCollection(id: string, updates: Partial<IdeaCollection>): Promise<IdeaCollection | null> {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('idea_collections')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteCollection(id: string): Promise<boolean> {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient
    .from('idea_collections')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

// Waitlist
export async function joinWaitlist(email: string, stage: string, source = ''): Promise<boolean> {
  if (!supabaseClient) return false;
  const { error } = await supabaseClient
    .from('waitlist')
    .insert({ email: email.toLowerCase(), stage, source });
  if (error) {
    // Ignore duplicate email error
    if (error.code === '23505') return true;
    throw error;
  }
  return true;
}

// Auth state change listener
export function onAuthStateChange(callback: (user: User | null) => void) {
  if (!supabaseClient) {
    return { data: { subscription: { unsubscribe: () => {} } } };
  }
  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    (async () => {
      if (session?.user) {
        callback({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || '',
          avatar_url: session.user.user_metadata?.avatar_url,
        });
      } else {
        callback(null);
      }
    })();
  });
}

// Export getCurrentSessionUser for backward compatibility
export const getCurrentSessionUser = getCurrentUser;
