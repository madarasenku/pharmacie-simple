-- Pharmacie Simple — bénéfices (jour, mois, année) et stock valorisé par programme.
-- Réservé aux personnes qui ont le droit « rapports » (gérant, et responsable par défaut).
--
--   • benefices(debut, fin)      : ventes, coût d'achat, crédit et pertes jour par jour, et classement des produits
--                                  (la Vente seulement : l'argent d'un programme recouvrable est à reverser, donc à part) ;
--   • stock_valeurs(debut, fin)  : pour chaque programme et chaque produit, le stock au début, les entrées, les sorties,
--                                  les pertes et le stock restant, avec le prix du produit pour ce programme.
--                                  Le prix d'un programme est celui de « produits_programmes.prix_vente » (colonne « Prix PNLP »
--                                  de la Base), sinon le prix de vente normal du produit.
--
-- Les deux renvoient un seul document JSON : une fonction qui renvoie des lignes est coupée à 1000 lignes par Supabase.

create or replace function public.benefices(p_debut date, p_fin date) returns jsonb
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

  with l as (
    select v.created_at::date as jour, v.id as vente_id, v.mode_paiement, vl.produit_id, vl.quantite,
           vl.quantite * vl.prix_unitaire as ca, vl.quantite * vl.cout_unitaire as cout, vl.cout_unitaire
    from ventes v
    join ventes_lignes vl on vl.vente_id = v.id
    join programmes g on g.id = v.programme_id
    where g.est_vente and not v.annulee and v.mode_paiement <> 'gratuit'
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
    join programmes g on g.id = m.programme_id
    where g.est_vente and m.type in ('perime', 'correction') and m.quantite < 0
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

create or replace function public.stock_valeurs(p_debut date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  perform exiger('rapports');
  if p_debut is null or p_fin is null or p_fin <= p_debut then
    raise exception 'Période invalide.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'programme_id', programme_id, 'produit_id', produit_id, 'designation', designation, 'prix', prix, 'prix_achat', prix_achat,
      'debut', debut, 'entrees', entrees, 'sorties', sorties, 'pertes', pertes, 'fin', fin) order by programme_id, designation), '[]'::jsonb)
  into r
  from (
    select pp.programme_id, p.id as produit_id, p.designation,
           coalesce(pp.prix_vente, p.prix_vente) as prix, p.prix_achat,
           coalesce(sum(m.quantite) filter (where m.created_at < p_debut), 0)::bigint as debut,
           coalesce(sum(m.quantite) filter (where m.type = 'entree' and m.created_at >= p_debut and m.created_at < p_fin), 0)::bigint as entrees,
           coalesce(-sum(m.quantite) filter (where m.type in ('vente', 'distribution', 'annulation') and m.created_at >= p_debut and m.created_at < p_fin), 0)::bigint as sorties,
           coalesce(-sum(m.quantite) filter (where m.type in ('perime', 'correction') and m.created_at >= p_debut and m.created_at < p_fin), 0)::bigint as pertes,
           coalesce(sum(m.quantite) filter (where m.created_at < p_fin), 0)::bigint as fin
    from produits_programmes pp
    join produits p on p.id = pp.produit_id
    join programmes g on g.id = pp.programme_id
    left join mouvements m on m.produit_id = pp.produit_id and m.programme_id = pp.programme_id
    where p.actif and g.actif
    group by pp.programme_id, p.id, p.designation, pp.prix_vente, p.prix_vente, p.prix_achat
  ) x;
  return r;
end;
$$;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 9}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.benefices(date, date) from public, anon;
revoke execute on function public.stock_valeurs(date, date) from public, anon;
grant execute on function public.benefices(date, date) to authenticated;
grant execute on function public.stock_valeurs(date, date) to authenticated;
