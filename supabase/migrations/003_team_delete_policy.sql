-- Allow deputies (team managers) to delete teams they manage
DROP POLICY IF EXISTS teams_deputy_delete ON public.teams;
CREATE POLICY teams_deputy_delete ON public.teams
  FOR DELETE USING (public.can_manage_team(id));
