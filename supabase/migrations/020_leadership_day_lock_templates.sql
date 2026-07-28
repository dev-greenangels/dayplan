-- Day-level plan lock (default unlocked)
ALTER TABLE public.day_plans
  ADD COLUMN IF NOT EXISTS plan_tasks_locked boolean NOT NULL DEFAULT false;

-- Deputy access to /admin/people (per team adminship)
ALTER TABLE public.team_admins
  ADD COLUMN IF NOT EXISTS can_access_people boolean NOT NULL DEFAULT false;

-- Per-column input templates (not counted as "filled" for reports)
ALTER TABLE public.team_columns
  ADD COLUMN IF NOT EXISTS input_template text;

-- Default «Обробки» template for existing notes columns
UPDATE public.team_columns
SET input_template = E'обробка від шкідників та хвороб:\nстрижка:\nвнесення добрив:'
WHERE key = 'notes'
  AND (input_template IS NULL OR btrim(input_template) = '');

-- Realtime for day-level lock sync
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'day_plans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.day_plans;
  END IF;
END $$;

-- Employees can update their own task rows (completed / notes / extra)
DROP POLICY IF EXISTS task_rows_employee_update ON public.task_rows;
CREATE POLICY task_rows_employee_update ON public.task_rows
  FOR UPDATE
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());
