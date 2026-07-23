-- Deputy may or may not edit planned tasks
ALTER TABLE public.team_admins
  ADD COLUMN IF NOT EXISTS can_edit_tasks boolean NOT NULL DEFAULT true;
