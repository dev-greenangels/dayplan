-- Photos attached to planned / completed fields (max 3 enforced in app)
CREATE TABLE IF NOT EXISTS public.task_row_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_row_id uuid NOT NULL REFERENCES public.task_rows(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('planned', 'completed')),
  storage_path text NOT NULL,
  thumb_path text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_row_id, field, sort_order)
);

CREATE INDEX IF NOT EXISTS task_row_photos_row_idx ON public.task_row_photos (task_row_id);

ALTER TABLE public.task_row_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_row_photos_select ON public.task_row_photos;
CREATE POLICY task_row_photos_select ON public.task_row_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.task_rows tr
      WHERE tr.id = task_row_id
        AND (
          public.can_manage_team(public.plan_team_id(tr.plan_id))
          OR public.is_team_member(public.plan_team_id(tr.plan_id))
        )
    )
  );

DROP POLICY IF EXISTS task_row_photos_insert ON public.task_row_photos;
CREATE POLICY task_row_photos_insert ON public.task_row_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_rows tr
      WHERE tr.id = task_row_id
        AND (
          public.can_manage_team(public.plan_team_id(tr.plan_id))
          OR tr.employee_id = auth.uid()
        )
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS task_row_photos_delete ON public.task_row_photos;
CREATE POLICY task_row_photos_delete ON public.task_row_photos
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.task_rows tr
      WHERE tr.id = task_row_id
        AND (
          public.can_manage_team(public.plan_team_id(tr.plan_id))
          OR tr.employee_id = auth.uid()
        )
    )
  );

-- Private bucket for task photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-photos',
  'task-photos',
  false,
  2097152,
  ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path: {team_id}/{plan_id}/{row_id}/{field}/{uuid}.webp
DROP POLICY IF EXISTS task_photos_storage_select ON storage.objects;
CREATE POLICY task_photos_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-photos'
    AND public.is_team_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS task_photos_storage_insert ON storage.objects;
CREATE POLICY task_photos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND (
      public.can_manage_team((storage.foldername(name))[1]::uuid)
      OR public.is_team_member((storage.foldername(name))[1]::uuid)
    )
  );

DROP POLICY IF EXISTS task_photos_storage_delete ON storage.objects;
CREATE POLICY task_photos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-photos'
    AND (
      public.can_manage_team((storage.foldername(name))[1]::uuid)
      OR public.is_team_member((storage.foldername(name))[1]::uuid)
    )
  );
