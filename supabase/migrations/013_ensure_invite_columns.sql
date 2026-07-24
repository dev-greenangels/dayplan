-- Ensure invite tracking columns exist (idempotent; covers DBs that skipped 005/006)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_blocked boolean NOT NULL DEFAULT false;

-- Anyone who already signed in no longer needs an invite button
UPDATE public.profiles
SET invite_blocked = true
WHERE last_sign_in_at IS NOT NULL
  AND invite_blocked IS DISTINCT FROM true;
