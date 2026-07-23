-- Fix infinite recursion: day_plans <-> task_rows policies + team_admins/can_manage_team
-- Helpers bypass RLS via SECURITY DEFINER + row_security off

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'::public.user_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.team_admins
      WHERE team_id = p_team_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.team_admins
      WHERE team_id = p_team_id AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = p_team_id AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.plan_team_id(p_plan_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
  SELECT team_id FROM public.day_plans WHERE id = p_plan_id
$$;

DROP POLICY IF EXISTS day_plans_employee_select ON public.day_plans;
CREATE POLICY day_plans_employee_select ON public.day_plans
  FOR SELECT USING (public.is_team_member(team_id));

DROP POLICY IF EXISTS day_plans_admin_all ON public.day_plans;
CREATE POLICY day_plans_admin_all ON public.day_plans
  FOR ALL USING (public.can_manage_team(team_id))
  WITH CHECK (public.can_manage_team(team_id));

DROP POLICY IF EXISTS task_rows_admin_all ON public.task_rows;
CREATE POLICY task_rows_admin_all ON public.task_rows
  FOR ALL USING (public.can_manage_team(public.plan_team_id(plan_id)))
  WITH CHECK (public.can_manage_team(public.plan_team_id(plan_id)));

DROP POLICY IF EXISTS task_rows_team_member_select ON public.task_rows;
CREATE POLICY task_rows_team_member_select ON public.task_rows
  FOR SELECT USING (
    public.can_manage_team(public.plan_team_id(plan_id))
    OR employee_id = auth.uid()
    OR (
      public.is_team_member(public.plan_team_id(plan_id))
      AND EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = public.plan_team_id(plan_id)
          AND t.work_mode = 'shared'::public.work_mode
      )
    )
  );

DROP POLICY IF EXISTS team_admins_select ON public.team_admins;
CREATE POLICY team_admins_select ON public.team_admins
  FOR SELECT USING (
    public.is_super_admin()
    OR user_id = auth.uid()
  );
