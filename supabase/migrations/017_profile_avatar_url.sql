-- Google / OAuth avatar cached on profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.profiles.avatar_url IS 'Cached Google/OAuth avatar URL';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, department, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'role', '')::public.user_role,
      'pending'::public.user_role
    ),
    COALESCE(NEW.raw_user_meta_data->>'department', ''),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      NULL
    )
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
