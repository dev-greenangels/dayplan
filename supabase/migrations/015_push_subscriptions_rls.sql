-- Ensure push_subscriptions RLS allows own upsert and admin cleanup/read
-- (table may predate migrations; policies must match app usage)

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_sub_own_all ON public.push_subscriptions;
CREATE POLICY push_sub_own_all ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_sub_admin_read ON public.push_subscriptions;
CREATE POLICY push_sub_admin_read ON public.push_subscriptions
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['super_admin'::public.user_role, 'sub_admin'::public.user_role]));

DROP POLICY IF EXISTS push_sub_admin_delete ON public.push_subscriptions;
CREATE POLICY push_sub_admin_delete ON public.push_subscriptions
  FOR DELETE
  USING (get_my_role() = ANY (ARRAY['super_admin'::public.user_role, 'sub_admin'::public.user_role]));
