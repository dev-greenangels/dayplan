-- Leadership may view photos always; can_add_photos controls the upload button
ALTER TABLE public.team_admins
  ADD COLUMN IF NOT EXISTS can_add_photos boolean NOT NULL DEFAULT true;
