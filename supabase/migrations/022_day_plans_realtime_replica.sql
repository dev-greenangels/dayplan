-- Realtime filters on non-PK columns need FULL replica identity
ALTER TABLE public.day_plans REPLICA IDENTITY FULL;

-- Ensure day_plans stays in realtime publication
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
