-- Pharmacie Simple — durcissement après l'audit Supabase

alter function public.tranche_age(numeric, text) set search_path = public;

-- Fonctions internes : pas d'appel direct depuis l'application
revoke execute on function public.creer_profil() from authenticated;
revoke execute on function public.rls_auto_enable() from authenticated;

create or replace function public.caisse_ouverte() returns int
language sql stable security definer set search_path = public as $$
  select id from caisses where fermee_le is null and public.est_membre() limit 1;
$$;
