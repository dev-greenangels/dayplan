-- Separate preference: leaders get push when tasks are sent to workers
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_worker_send_push boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_worker_send_push IS
  'Receive web push when someone sends tasks to employees in a managed team';
