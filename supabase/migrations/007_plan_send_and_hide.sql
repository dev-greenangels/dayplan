-- Per-worker email send stamp on day plan rows
ALTER TABLE public.task_rows
  ADD COLUMN IF NOT EXISTS plan_email_sent_at timestamptz;

-- Deputies can be hidden from the day plan table
ALTER TABLE public.team_admins
  ADD COLUMN IF NOT EXISTS hide_from_plan boolean NOT NULL DEFAULT false;
