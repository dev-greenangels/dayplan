-- Per-channel send timestamps
ALTER TABLE public.task_rows
  ADD COLUMN IF NOT EXISTS plan_push_sent_at timestamptz;

ALTER TABLE public.day_plans
  ADD COLUMN IF NOT EXISTS digest_receipts jsonb NOT NULL DEFAULT '{}'::jsonb;
