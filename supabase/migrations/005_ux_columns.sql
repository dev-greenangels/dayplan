-- Column visibility + digest/invite tracking
ALTER TABLE public.team_columns
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.day_plans
  ADD COLUMN IF NOT EXISTS digest_sent_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;
