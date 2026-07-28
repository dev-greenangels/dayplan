-- Per-team-leader email/push prefs for «План / Звіт керівництву»
ALTER TABLE public.team_admins
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_push boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.team_admins.notify_email IS 'Receive leadership plan/report emails for this team';
COMMENT ON COLUMN public.team_admins.notify_push IS 'Receive leadership plan/report push for this team';

-- Co-admins on the same team can see each other (no recursion: can_manage_team is SECURITY DEFINER)
DROP POLICY IF EXISTS team_admins_select ON public.team_admins;
CREATE POLICY team_admins_select ON public.team_admins
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR public.can_manage_team(team_id)
  );
