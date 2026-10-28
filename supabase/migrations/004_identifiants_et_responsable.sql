-- Pharmacie Simple — connexion par identifiant et rôle « responsable »

alter table public.profiles add column identifiant text unique;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('gerant', 'responsable', 'vendeur'));

-- Profil créé à l'inscription :
--  - le tout premier compte devient gérant ;
--  - un compte créé par le gérant (fonction « utilisateurs ») reçoit le rôle choisi ;
--  - tout autre compte (inscription directe) reste désactivé.
create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_premier boolean := not exists (select 1 from profiles where role = 'gerant');
  v_par_gerant boolean := coalesce((new.raw_app_meta_data ->> 'cree_par_gerant')::boolean, false);
  v_role text := coalesce(new.raw_app_meta_data ->> 'role', 'vendeur');
begin
  if v_role not in ('gerant', 'responsable', 'vendeur') then
    v_role := 'vendeur';
  end if;
  insert into profiles (id, nom, email, identifiant, role, actif)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nom', split_part(new.email, '@', 1)),
    new.email,
    nullif(new.raw_user_meta_data ->> 'identifiant', ''),
    case when v_premier then 'gerant' when v_par_gerant then v_role else 'vendeur' end,
    v_premier or v_par_gerant
  );
  return new;
end;
$$;
revoke execute on function public.creer_profil() from public, anon, authenticated;

-- Droits : le gérant a tout, les autres selon les réglages de leur rôle
create or replace function public.peut(p_droit text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role = 'gerant' then true
      else coalesce((select (valeur ->> p_droit)::boolean from parametres where cle = 'droits_' || p.role), false)
    end
    from profiles p
    where p.id = auth.uid() and p.actif
  ), false);
$$;

insert into public.parametres (cle, valeur) values
  ('droits_responsable', '{"vendre": true, "entree": true, "credit": true, "programmes": true, "corriger": true, "annuler": true, "prix": false, "rapports": true, "base": false}')
on conflict (cle) do nothing;
