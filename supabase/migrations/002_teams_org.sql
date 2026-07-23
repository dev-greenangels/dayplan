-- 002: Teams / departments / membership / plan refactor
-- Safe to re-run partially with IF NOT EXISTS patterns where possible

CREATE TYPE public.work_mode AS ENUM ('shared', 'individual');

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  work_mode public.work_mode NOT NULL DEFAULT 'shared',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_team_name_active_key
  ON public.departments (team_id, name)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.team_admins (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.team_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, key)
);

-- Helper: is current user a super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'::public.user_role
  );
$$;

-- Helper: can manage team (super_admin or team_admin)
CREATE OR REPLACE FUNCTION public.can_manage_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.team_admins
      WHERE team_id = p_team_id AND user_id = auth.uid()
    );
$$;

-- Helper: is member of team
CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

-- Migrate day_plans: add team_id, keep department temporarily for data move
ALTER TABLE public.day_plans ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.task_rows ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.task_rows ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Data migration from string department → teams/departments
DO $$
DECLARE
  r record;
  v_team_id uuid;
  v_dept_id uuid;
  v_plan record;
  v_profile record;
BEGIN
  -- Collect unique department names from profiles and day_plans
  FOR r IN
    SELECT DISTINCT trim(d) AS name FROM (
      SELECT department AS d FROM public.profiles WHERE coalesce(trim(department), '') <> ''
      UNION
      SELECT department AS d FROM public.day_plans WHERE coalesce(trim(department), '') <> ''
    ) s
  LOOP
    INSERT INTO public.teams (name, work_mode)
    VALUES (r.name, 'shared')
    RETURNING id INTO v_team_id;

    INSERT INTO public.departments (team_id, name, sort_order)
    VALUES (v_team_id, r.name, 0)
    RETURNING id INTO v_dept_id;

    -- System columns for this team
    INSERT INTO public.team_columns (team_id, key, label, sort_order, is_system) VALUES
      (v_team_id, 'shift', 'Робоча зміна', 10, true),
      (v_team_id, 'planned', 'Заплановано', 20, true),
      (v_team_id, 'completed', 'Виконано', 30, true),
      (v_team_id, 'notes', 'Обробки', 40, true)
    ON CONFLICT (team_id, key) DO NOTHING;

    -- Link profiles
    FOR v_profile IN
      SELECT id, role FROM public.profiles WHERE trim(department) = r.name
    LOOP
      IF v_profile.role = 'employee'::public.user_role THEN
        INSERT INTO public.team_members (team_id, user_id, department_id)
        VALUES (v_team_id, v_profile.id, v_dept_id)
        ON CONFLICT DO NOTHING;
      ELSIF v_profile.role = 'sub_admin'::public.user_role THEN
        INSERT INTO public.team_admins (team_id, user_id)
        VALUES (v_team_id, v_profile.id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    -- Link day_plans
    UPDATE public.day_plans
    SET team_id = v_team_id
    WHERE trim(department) = r.name AND team_id IS NULL;

    -- Link task_rows under those plans
    UPDATE public.task_rows tr
    SET department_id = v_dept_id
    FROM public.day_plans dp
    WHERE tr.plan_id = dp.id AND dp.team_id = v_team_id AND tr.department_id IS NULL;
  END LOOP;

  -- If no departments existed, create a default team
  IF NOT EXISTS (SELECT 1 FROM public.teams) THEN
    INSERT INTO public.teams (name, work_mode)
    VALUES ('Основна команда', 'shared')
    RETURNING id INTO v_team_id;

    INSERT INTO public.departments (team_id, name, sort_order)
    VALUES (v_team_id, 'Загальний', 0)
    RETURNING id INTO v_dept_id;

    INSERT INTO public.team_columns (team_id, key, label, sort_order, is_system) VALUES
      (v_team_id, 'shift', 'Робоча зміна', 10, true),
      (v_team_id, 'planned', 'Заплановано', 20, true),
      (v_team_id, 'completed', 'Виконано', 30, true),
      (v_team_id, 'notes', 'Обробки', 40, true);

    UPDATE public.day_plans SET team_id = v_team_id WHERE team_id IS NULL;
    UPDATE public.task_rows SET department_id = v_dept_id WHERE department_id IS NULL;
  END IF;

  -- Give all sub_admins access to all teams (safe default)
  INSERT INTO public.team_admins (team_id, user_id)
  SELECT t.id, p.id
  FROM public.teams t
  CROSS JOIN public.profiles p
  WHERE p.role = 'sub_admin'::public.user_role
  ON CONFLICT DO NOTHING;
END $$;

-- Drop old unique on day_plans(plan_date, department) and add new one
ALTER TABLE public.day_plans DROP CONSTRAINT IF EXISTS day_plans_plan_date_department_key;
DROP INDEX IF EXISTS day_plans_plan_date_department_key;

-- Ensure every plan has team_id before NOT NULL
UPDATE public.day_plans dp
SET team_id = (SELECT id FROM public.teams ORDER BY created_at LIMIT 1)
WHERE team_id IS NULL;

ALTER TABLE public.day_plans ALTER COLUMN team_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS day_plans_team_date_key
  ON public.day_plans (team_id, plan_date);

ALTER TABLE public.day_plans
  DROP CONSTRAINT IF EXISTS day_plans_team_id_plan_date_key;
ALTER TABLE public.day_plans
  ADD CONSTRAINT day_plans_team_id_plan_date_key UNIQUE (team_id, plan_date);

-- Keep department column for now (nullable) for backwards compat during deploy; drop later optional
ALTER TABLE public.day_plans ALTER COLUMN department DROP NOT NULL;
ALTER TABLE public.day_plans ALTER COLUMN department SET DEFAULT '';

-- RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_columns ENABLE ROW LEVEL SECURITY;

-- Teams policies
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams FOR SELECT USING (
  public.is_super_admin()
  OR EXISTS (SELECT 1 FROM public.team_admins ta WHERE ta.team_id = teams.id AND ta.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = teams.id AND tm.user_id = auth.uid())
);

DROP POLICY IF EXISTS teams_admin_all ON public.teams;
CREATE POLICY teams_admin_all ON public.teams FOR ALL USING (
  public.is_super_admin()
) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS teams_deputy_update ON public.teams;
CREATE POLICY teams_deputy_update ON public.teams FOR UPDATE USING (
  public.can_manage_team(id)
);

DROP POLICY IF EXISTS teams_deputy_delete ON public.teams;
CREATE POLICY teams_deputy_delete ON public.teams FOR DELETE USING (
  public.can_manage_team(id)
);

-- Departments
DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments FOR SELECT USING (
  public.is_team_member(team_id)
);

DROP POLICY IF EXISTS departments_manage ON public.departments;
CREATE POLICY departments_manage ON public.departments FOR ALL USING (
  public.can_manage_team(team_id)
) WITH CHECK (public.can_manage_team(team_id));

-- team_members
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members FOR SELECT USING (
  public.can_manage_team(team_id) OR user_id = auth.uid()
);

DROP POLICY IF EXISTS team_members_manage ON public.team_members;
CREATE POLICY team_members_manage ON public.team_members FOR ALL USING (
  public.can_manage_team(team_id)
) WITH CHECK (public.can_manage_team(team_id));

-- team_admins
DROP POLICY IF EXISTS team_admins_select ON public.team_admins;
CREATE POLICY team_admins_select ON public.team_admins FOR SELECT USING (
  public.is_super_admin() OR user_id = auth.uid() OR public.can_manage_team(team_id)
);

DROP POLICY IF EXISTS team_admins_super ON public.team_admins;
CREATE POLICY team_admins_super ON public.team_admins FOR ALL USING (
  public.is_super_admin()
) WITH CHECK (public.is_super_admin());

-- team_columns
DROP POLICY IF EXISTS team_columns_select ON public.team_columns;
CREATE POLICY team_columns_select ON public.team_columns FOR SELECT USING (
  public.is_team_member(team_id)
);

DROP POLICY IF EXISTS team_columns_manage ON public.team_columns;
CREATE POLICY team_columns_manage ON public.team_columns FOR ALL USING (
  public.can_manage_team(team_id)
) WITH CHECK (public.can_manage_team(team_id));

-- Replace day_plans / task_rows admin policies to use team_id
DROP POLICY IF EXISTS day_plans_admin_all ON public.day_plans;
CREATE POLICY day_plans_admin_all ON public.day_plans FOR ALL USING (
  public.can_manage_team(team_id)
) WITH CHECK (public.can_manage_team(team_id));

DROP POLICY IF EXISTS day_plans_employee_select ON public.day_plans;
CREATE POLICY day_plans_employee_select ON public.day_plans FOR SELECT USING (
  public.is_team_member(team_id)
  OR EXISTS (
    SELECT 1 FROM public.task_rows tr
    WHERE tr.plan_id = day_plans.id AND tr.employee_id = auth.uid()
  )
);

DROP POLICY IF EXISTS task_rows_admin_all ON public.task_rows;
CREATE POLICY task_rows_admin_all ON public.task_rows FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.day_plans dp
    WHERE dp.id = task_rows.plan_id AND public.can_manage_team(dp.team_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.day_plans dp
    WHERE dp.id = task_rows.plan_id AND public.can_manage_team(dp.team_id)
  )
);

-- Allow shared-mode members to select all rows on their team plans
DROP POLICY IF EXISTS task_rows_team_member_select ON public.task_rows;
CREATE POLICY task_rows_team_member_select ON public.task_rows FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.day_plans dp
    JOIN public.teams t ON t.id = dp.team_id
    WHERE dp.id = task_rows.plan_id
      AND public.is_team_member(dp.team_id)
      AND (
        t.work_mode = 'shared'::public.work_mode
        OR task_rows.employee_id = auth.uid()
        OR public.can_manage_team(dp.team_id)
      )
  )
);

-- profiles: allow admins to select all (already have profiles_admin_select_all)
-- Allow team managers to see members of their teams
DROP POLICY IF EXISTS profiles_team_admin_select ON public.profiles;
CREATE POLICY profiles_team_admin_select ON public.profiles FOR SELECT USING (
  public.is_super_admin()
  OR EXISTS (
    SELECT 1 FROM public.team_admins ta
    JOIN public.team_members tm ON tm.team_id = ta.team_id
    WHERE ta.user_id = auth.uid() AND tm.user_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.team_admins ta
    WHERE ta.user_id = auth.uid() AND ta.user_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.team_admins ta2
    JOIN public.team_admins ta3 ON ta3.team_id = ta2.team_id
    WHERE ta2.user_id = auth.uid() AND ta3.user_id = profiles.id
  )
);
