-- Flag: do not show invite button (auth account already exists / already registered)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_blocked boolean NOT NULL DEFAULT false;
