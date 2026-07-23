-- Team plan UX defaults
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS default_shift text NOT NULL DEFAULT '8:00-18:00',
  ADD COLUMN IF NOT EXISTS show_send_worker_emails boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_send_leadership boolean NOT NULL DEFAULT true;
