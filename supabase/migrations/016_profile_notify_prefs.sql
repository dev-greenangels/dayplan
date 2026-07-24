-- Per-user channel preferences (opt-in defaults)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_push boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_email IS 'User wants plan/report emails';
COMMENT ON COLUMN public.profiles.notify_push IS 'User wants plan/report web push';
