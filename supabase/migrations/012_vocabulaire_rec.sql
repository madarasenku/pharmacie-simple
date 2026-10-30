-- Pharmacie Simple — vocabulaire du district (version 1.9.0).
--   • L'origine « Vente » s'appelle « REC » (produits recouvrables), comme sur les fiches du district ;
--     le site affiche désormais le sigle de chaque origine (modifiable dans la Base).
--   • Les anomalies nomment l'origine par son sigle (« SALBUTAMOL AMP INJ — REC »).

update public.programmes set sigle = 'REC', nom = 'Produits recouvrables'
where est_vente and sigle = 'VENTE';

create or replace function public.anomalies()
returns table (code text, gravite text, titre text, detail text, page text, cle text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not est_gerant() then
    raise exception 'Action non autorisée (gérant).' using errcode = '42501';
  end if;
  return query
  -- Produit à vendre (Vente ou programme recouvrable) dont le prix est 0
  select 'prix_manquant'::text, 'haute'::text,
    'Produit à vendre sans prix de vente'::text,
    p.designation || ' — ' || g.sigle,
    'base'::text, 'prix:' || p.id || ':' || g.id
  from produits p
  join produits_programmes pp on pp.produit_id = p.id
  join programmes g on g.id = pp.programme_id
  where p.actif and g.actif and (g.est_vente or g.recouvrable) and coalesce(pp.prix_vente, p.prix_vente) = 0

  union all
  -- Vente réellement faite à 0 F (30 derniers jours)
  select 'vente_zero', 'haute', 'Produit vendu à 0 F',
    pr.designation || ' — vente ' || coalesce(v.numero, '?') || ' du ' || to_char(v.created_at, 'DD/MM/YYYY'),
    'journee', 'vente0:' || vl.id
  from ventes_lignes vl
  join ventes v on v.id = vl.vente_id
  join produits pr on pr.id = vl.produit_id
  where v.mode_paiement <> 'gratuit' and not v.annulee and vl.prix_unitaire = 0
    and v.created_at > now() - interval '30 days'

  union all
  -- Vendu moins cher qu'acheté
  select 'vente_perte', 'moyenne', 'Prix de vente plus bas que le prix d''achat',
    p.designation || ' — achat ' || round(p.prix_achat)::bigint::text || ' F, vente ' || round(p.prix_vente)::bigint::text || ' F',
    'base', 'perte:' || p.id
  from produits p
  where p.actif and p.prix_vente > 0 and p.prix_achat > p.prix_vente
    and exists (select 1 from produits_programmes pp join programmes g on g.id = pp.programme_id where pp.produit_id = p.id and g.est_vente)

  union all
  -- Lot périmé qui est encore compté en stock
  select 'perime_en_stock', 'haute', 'Lot périmé encore en stock',
    p.designation || ' — ' || l.quantite || ' unité(s)' || case when l.numero <> '' then ', lot ' || l.numero else '' end
      || ', périmé le ' || to_char(l.peremption, 'DD/MM/YYYY') || ' (' || g.sigle || ')',
    'inventaire', 'perime:' || l.id
  from lots l
  join produits p on p.id = l.produit_id
  join programmes g on g.id = l.programme_id
  where l.quantite > 0 and l.peremption < current_date

  union all
  -- Caisse oubliée ouverte
  select 'caisse_longue', 'moyenne', 'Caisse ouverte depuis plus de 24 heures',
    'Ouverte le ' || to_char(c.ouverte_le, 'DD/MM/YYYY à HH24:MI') || coalesce(' par ' || pf.nom, ''),
    'journee', 'caisse:' || c.id
  from caisses c left join profiles pf on pf.id = c.ouverte_par
  where c.fermee_le is null and c.ouverte_le < now() - interval '24 hours'

  union all
  -- Écart de caisse à la fermeture (30 derniers jours)
  select 'ecart_caisse', 'moyenne', 'Écart de caisse',
    to_char(c.fermee_le, 'DD/MM/YYYY') || ' : ' || case when c.ecart < 0 then 'il manquait ' else 'il y avait en trop ' end
      || round(abs(c.ecart))::bigint::text || ' F' || coalesce(' (fermée par ' || pf.nom || ')', ''),
    'journee', 'ecart:' || c.id
  from caisses c left join profiles pf on pf.id = c.fermee_par
  where c.fermee_le > now() - interval '30 days' and coalesce(c.ecart, 0) <> 0

  union all
  -- Client au-delà de son plafond de crédit
  select 'credit_plafond', 'moyenne', 'Crédit au-delà du plafond',
    d.nom || ' doit ' || round(d.du)::bigint::text || ' F (plafond ' || round(d.plafond)::bigint::text || ' F)',
    'credits', 'plafond:' || d.client_id
  from v_dettes d where d.du > d.plafond

  union all
  -- Crédit en retard (plus de 30 jours)
  select 'credit_retard', 'info', 'Crédit en retard (plus de 30 jours)',
    d.nom || ' doit ' || round(d.du)::bigint::text || ' F depuis le ' || to_char(d.premier_credit, 'DD/MM/YYYY'),
    'credits', 'retard:' || d.client_id
  from v_dettes d where d.du > 0 and d.premier_credit < now() - interval '30 days'

  union all
  -- Produit actif rattaché à aucune origine : il n'apparaît nulle part
  select 'sans_origine', 'moyenne', 'Produit rattaché à aucune origine',
    p.designation || ' — cochez REC ou un programme dans la Base',
    'base', 'origine:' || p.id
  from produits p
  where p.actif and not exists (select 1 from produits_programmes pp where pp.produit_id = p.id)

  union all
  -- Commande au district toujours pas reçue après 45 jours
  select 'commande_attente', 'info', 'Commande au district pas encore reçue',
    coalesce(c.numero, 'Commande') || ' envoyée le ' || to_char(c.created_at, 'DD/MM/YYYY'),
    'rapport', 'commande:' || c.id
  from commandes c
  where c.statut in ('envoyee', 'partielle') and c.created_at < now() - interval '45 days'

  union all
  -- Sauvegarde trop ancienne
  select 'sauvegarde', 'moyenne', 'Sauvegarde à faire',
    coalesce('Dernière sauvegarde le ' || to_char((s.valeur ->> 'date')::timestamptz, 'DD/MM/YYYY'), 'Aucune sauvegarde téléchargée'),
    'reglages', 'sauvegarde'
  from (select 1) x
  left join parametres s on s.cle = 'derniere_sauvegarde'
  where s.valeur is null or (s.valeur ->> 'date')::timestamptz < now() - interval '7 days';
end;
$$;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 12}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.anomalies() from public, anon;
grant execute on function public.anomalies() to authenticated;
