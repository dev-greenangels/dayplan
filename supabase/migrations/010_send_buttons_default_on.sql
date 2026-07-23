-- Send plan buttons: default ON
ALTER TABLE public.teams
  ALTER COLUMN show_send_worker_emails SET DEFAULT true,
  ALTER COLUMN show_send_leadership SET DEFAULT true;

UPDATE public.teams
SET
  show_send_worker_emails = true,
  show_send_leadership = true;
