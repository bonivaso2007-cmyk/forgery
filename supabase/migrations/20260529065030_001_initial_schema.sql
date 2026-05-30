/*
  # FORGE Initial Database Schema

  1. New Tables
    - `profiles` - Extends auth.users with founder-specific data
      - `id` (uuid, primary key, references auth.users)
      - `name` (text)
      - `stage` (text) - founder stage (pre-revenue, pre-seed, etc.)
      - `geo` (text) - geographic location
      - `customer` (text) - target customer description
      - `problem` (text) - problem statement
      - `solution` (text) - solution description
      - `market` (text) - market thesis
      - `revenue` (text) - revenue model
      - `channels` (text) - acquisition channels
      - `constraints` (text) - constraints
      - `strengths` (text) - founder strengths
      - `risks` (text) - known risks
      - `goals` (text) - goals
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `ideas` - Saved forge evaluations
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `idea_text` (text) - the original idea input
      - `score` (integer) - forge score 0-100
      - `verdict` (text) - the verdict text
      - `strengths` (jsonb) - array of strengths
      - `weaknesses` (jsonb) - array of weaknesses
      - `moves` (jsonb) - array of recommended moves
      - `provider` (text) - AI provider used
      - `model` (text) - AI model used
      - `is_favorite` (boolean)
      - `tags` (jsonb) - user-defined tags
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `idea_collections` - Group ideas into projects/themes
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text)
      - `description` (text)
      - `idea_ids` (jsonb) - array of idea ids
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `usage_logs` - Track daily usage for rate limiting
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable - null for guests)
      - `ip_hash` (text) - hashed IP for guest tracking
      - `date_key` (date) - the date of usage
      - `request_count` (integer)
      - `token_count` (integer)
      - `provider` (text)
      - `model` (text)
      - `created_at` (timestamp)

    - `waitlist` - Waitlist entries
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `stage` (text)
      - `source` (text) - where they heard about FORGE
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Profiles: users can only read/write their own profile
    - Ideas: users can only access their own ideas
    - Collections: users can only access their own collections
    - Usage logs: users can read their own logs
    - Waitlist: insert only (no read access for users)

  3. Indexes
    - ideas user_id index for fast user queries
    - usage_logs composite index for date/user/ip lookups
*/

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text DEFAULT '',
  stage text DEFAULT 'pre-revenue',
  geo text DEFAULT '',
  customer text DEFAULT '',
  problem text DEFAULT '',
  solution text DEFAULT '',
  market text DEFAULT '',
  revenue text DEFAULT '',
  channels text DEFAULT '',
  constraints text DEFAULT '',
  strengths text DEFAULT '',
  risks text DEFAULT '',
  goals text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ideas table
CREATE TABLE IF NOT EXISTS ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_text text NOT NULL,
  score integer DEFAULT 0,
  verdict text DEFAULT '',
  strengths jsonb DEFAULT '[]'::jsonb,
  weaknesses jsonb DEFAULT '[]'::jsonb,
  moves jsonb DEFAULT '[]'::jsonb,
  provider text DEFAULT '',
  model text DEFAULT '',
  is_favorite boolean DEFAULT false,
  tags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Idea collections table
CREATE TABLE IF NOT EXISTS idea_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  idea_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Usage logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_hash text DEFAULT '',
  date_key date NOT NULL,
  request_count integer DEFAULT 1,
  token_count integer DEFAULT 0,
  provider text DEFAULT '',
  model text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  stage text DEFAULT 'Early idea',
  source text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Ideas policies
CREATE POLICY "Users can read own ideas"
  ON ideas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ideas"
  ON ideas FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ideas"
  ON ideas FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own ideas"
  ON ideas FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Idea collections policies
CREATE POLICY "Users can read own collections"
  ON idea_collections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own collections"
  ON idea_collections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own collections"
  ON idea_collections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own collections"
  ON idea_collections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Usage logs policies (users can only read their own)
CREATE POLICY "Users can read own usage logs"
  ON usage_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert usage logs"
  ON usage_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Waitlist policies (insert only for anon, read for service_role)
CREATE POLICY "Anyone can join waitlist"
  ON waitlist FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ideas_user_id ON ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_is_favorite ON ideas(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_usage_logs_date_key ON usage_logs(date_key);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_ip_hash ON usage_logs(ip_hash);

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function on user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS ideas_updated_at ON ideas;
CREATE TRIGGER ideas_updated_at
  BEFORE UPDATE ON ideas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS idea_collections_updated_at ON idea_collections;
CREATE TRIGGER idea_collections_updated_at
  BEFORE UPDATE ON idea_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
