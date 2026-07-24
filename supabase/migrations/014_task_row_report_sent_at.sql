-- Stamp when employee sent leadership report (shared across devices)
ALTER TABLE public.task_rows
  ADD COLUMN IF NOT EXISTS report_sent_at timestamptz;
