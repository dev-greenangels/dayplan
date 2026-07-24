-- Shared lock for planned tasks on the plan board (same for all deputies / devices)
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS plan_tasks_locked boolean NOT NULL DEFAULT true;
