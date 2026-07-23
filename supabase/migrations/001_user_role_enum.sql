-- Roles as Postgres enum; default pending for new users
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('pending', 'employee', 'sub_admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop policies that depend on profiles.role before altering type
DROP POLICY IF EXISTS day_plans_admin_all ON public.day_plans;
DROP POLICY IF EXISTS task_rows_admin_all ON public.task_rows;
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_delete ON public.profiles;
DROP POLICY IF EXISTS push_sub_admin_read ON public.push_subscriptions;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE public.user_role USING role::public.user_role,
  ALTER COLUMN role SET DEFAULT 'pending'::public.user_role;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'role', '')::public.user_role,
      'pending'::public.user_role
    ),
    COALESCE(NEW.raw_user_meta_data->>'department', '')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE POLICY day_plans_admin_all ON public.day_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role::text = ANY (ARRAY['super_admin', 'sub_admin'])
    )
  );

CREATE POLICY task_rows_admin_all ON public.task_rows
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role::text = ANY (ARRAY['super_admin', 'sub_admin'])
    )
  );

CREATE POLICY profiles_admin_select_all ON public.profiles
  FOR SELECT USING (get_my_role() = ANY (ARRAY['super_admin', 'sub_admin']));

CREATE POLICY profiles_admin_update ON public.profiles
  FOR UPDATE USING (get_my_role() = ANY (ARRAY['super_admin', 'sub_admin']));

CREATE POLICY profiles_admin_delete ON public.profiles
  FOR DELETE USING (get_my_role() = ANY (ARRAY['super_admin', 'sub_admin']));

CREATE POLICY push_sub_admin_read ON public.push_subscriptions
  FOR SELECT USING (get_my_role() = ANY (ARRAY['super_admin', 'sub_admin']));
