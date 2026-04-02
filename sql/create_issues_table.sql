-- SQL to create issues table for Supabase/Postgres
CREATE TABLE IF NOT EXISTS public.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text,
  status text NOT NULL DEFAULT 'New', -- New, In Progress, Resolved
  lat double precision,
  lon double precision,
  image_path text,
  image_url text,
  session_id text,
  created_at timestamptz DEFAULT now()
);

-- Optional index
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON public.issues (created_at DESC);
