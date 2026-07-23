-- Cache last sign-in on profiles so UI can avoid Auth Admin listUsers
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
