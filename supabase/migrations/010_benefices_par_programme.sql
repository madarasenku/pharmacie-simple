-- Pharmacie Simple — bénéfices d'un programme payant au choix (Vente ou programme recouvrable comme PHPSP).
-- L'écran « Bénéfices et stock » a un filtre par programme : benefices(debut, fin, programme).
-- benefices(debut, fin) reste et donne la Vente, comme avant (sites pas encore mis à jour).

create or replace function public.benefices(p_debut date, p_fin date, p_programme int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  perform exiger('rapports');
  if p_debut is null or p_fin is null or p_fin <= p_debut then
    raise exception 'Période invalide.';
  end if;
  if p_fin - p_debut > 800 then
    raise exception 'Période trop longue (800 jours au plus).';
  end if;
  if not exists (select 1 from programmes where id = p_programme) then
    raise exception 'Programme inconnu.';
  end if;

  with l as (
    select v.created_at::date as jour, v.id as vente_id, v.mode_paiement, vl.produit_id, vl.quantite,
           vl.quantite * vl.prix_unitaire as ca, vl.quantite * vl.cout_unitaire as cout, vl.cout_unitaire
    from ventes v
    join ventes_lignes vl on vl.vente_id = v.id
    where v.programme_id = p_programme and not v.annulee and v.mode_paiement <> 'gratuit'
      and v.created_at >= p_debut and v.created_at < p_fin
  ),
  jours as (
    select jour, sum(ca) as ca, sum(cout) as cout,
           coalesce(sum(ca) filter (where mode_paiement = 'credit'), 0) as credit,
           count(distinct vente_id) as nb
    from l group by jour
  ),
  pertes as (
    -- Périmés jetés, casse et écarts d'inventaire en moins, au prix d'achat (les écarts en plus ne comptent pas)
    select m.created_at::date as jour, sum(-m.quantite) as unites, sum(-m.quantite * p.prix_achat) as valeur
    from mouvements m
    join produits p on p.id = m.produit_id
    where m.programme_id = p_programme and m.type in ('perime', 'correction') and m.quantite < 0
      and m.created_at >= p_debut and m.created_at < p_fin
    group by 1
  ),
  prods as (
    select l.produit_id, p.designation, sum(l.quantite) as quantite, sum(l.ca) as ca, sum(l.cout) as cout,
           bool_or(l.cout_unitaire = 0) as sans_achat
    from l join produits p on p.id = l.produit_id
    group by l.produit_id, p.designation
  )
  select jsonb_build_object(
    'jours', coalesce((select jsonb_agg(jsonb_build_object('jour', jour, 'ca', ca, 'cout', cout, 'credit', credit, 'nb', nb) order by jour) from jours), '[]'::jsonb),
    'pertes', coalesce((select jsonb_agg(jsonb_build_object('jour', jour, 'unites', unites, 'valeur', valeur) order by jour) from pertes), '[]'::jsonb),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('produit_id', produit_id, 'designation', designation, 'quantite', quantite,
                 'ca', ca, 'cout', cout, 'sans_achat', sans_achat) order by ca - cout desc, designation) from prods), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- L'ancienne forme donne la Vente (même résultat qu'en version 9)
create or replace function public.benefices(p_debut date, p_fin date) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.benefices(p_debut, p_fin, (select id from public.programmes where est_vente order by id limit 1));
$$;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 10}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.benefices(date, date, int) from public, anon;
grant execute on function public.benefices(date, date, int) to authenticated;
