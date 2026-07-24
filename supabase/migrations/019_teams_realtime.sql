-- Enable Realtime for plan lock sync across deputies/boss on open plan pages
ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
