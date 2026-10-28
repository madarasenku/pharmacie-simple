-- Pharmacie Simple — SUITE de la mise à jour 005 (base de production).
-- La 005 collée dans l'éditeur SQL s'est arrêtée avant valider_inventaire : ce fichier reprend
-- exactement la fin de 005, sans rien supprimer, et peut être relancé sans risque.

-- Inventaire : comptage de lots existants + stock de départ (nouveaux lots), en une seule fois
-- p : { reference, comptes: [{lot_id, reel, attendu}], nouveaux: [{produit_id, programme_id, quantite, numero, peremption}] }
-- « attendu » = quantité affichée sur la feuille au moment du comptage (protège des ventes faites entre-temps).
-- Un lot déjà périmé qui baisse est noté « périmé » (colonne D du rapport), les autres écarts « correction ».
create or replace function public.valider_inventaire(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c jsonb;
  v_lot lots%rowtype;
  v_reel int;
  v_ecart int;
  v_nb_corr int := 0;
  v_nb_nouv int := 0;
  v_ref text := coalesce(nullif(trim(p ->> 'reference'), ''), 'Inventaire du ' || to_char(now(), 'DD/MM/YYYY'));
  v_lot_id int;
  v_qte int;
  v_numero text;
  v_per date;
  v_bouge text[] := '{}';
begin
  perform exiger('corriger');

  -- 1. Le stock a-t-il bougé (vente, entrée) depuis que la feuille de comptage a été ouverte ?
  --    Si oui on n'écrase rien : la personne vérifie ces lignes puis valide à nouveau.
  for v_c in select * from jsonb_array_elements(coalesce(p -> 'comptes', '[]'::jsonb)) loop
    v_reel := (v_c ->> 'reel')::int;
    if v_reel is null or v_reel < 0 then
      raise exception 'Quantité comptée invalide.';
    end if;
    select * into v_lot from lots where id = (v_c ->> 'lot_id')::int for update;
    if not found then
      raise exception 'Lot introuvable : rechargez la page d''inventaire.';
    end if;
    if (v_c -> 'attendu') is not null and (v_c ->> 'attendu')::int is distinct from v_lot.quantite then
      v_bouge := array_append(v_bouge, (select designation from produits where id = v_lot.produit_id)
        || case when v_lot.numero <> '' then ' (lot ' || v_lot.numero || ')' else '' end);
    end if;
  end loop;
  if cardinality(v_bouge) > 0 then
    raise exception 'Le stock a bougé pendant l''inventaire pour : %. Vérifiez ces lignes puis validez à nouveau.', array_to_string(v_bouge, ', ');
  end if;

  -- 2. Les écarts comptés deviennent des corrections
  for v_c in select * from jsonb_array_elements(coalesce(p -> 'comptes', '[]'::jsonb)) loop
    v_reel := (v_c ->> 'reel')::int;
    select * into v_lot from lots where id = (v_c ->> 'lot_id')::int;
    v_ecart := v_reel - v_lot.quantite;
    if v_ecart <> 0 then
      update lots set quantite = v_reel where id = v_lot.id;
      insert into mouvements (produit_id, programme_id, lot_id, type, quantite, motif, reference)
      values (v_lot.produit_id, v_lot.programme_id, v_lot.id,
              case when v_ecart < 0 and v_lot.peremption < current_date then 'perime' else 'correction' end,
              v_ecart, case when v_ecart < 0 and v_lot.peremption < current_date then 'Inventaire : périmé retiré' else 'Inventaire' end, v_ref);
      v_nb_corr := v_nb_corr + 1;
    end if;
  end loop;

  -- 3. Produits trouvés sur l'étagère sans lot connu : stock de départ (une entrée, pour que le rapport reste juste)
  for v_c in select * from jsonb_array_elements(coalesce(p -> 'nouveaux', '[]'::jsonb)) loop
    v_qte := (v_c ->> 'quantite')::int;
    if v_qte is null or v_qte <= 0 then
      continue;
    end if;
    v_numero := coalesce(trim(v_c ->> 'numero'), '');
    v_per := nullif(v_c ->> 'peremption', '')::date;
    insert into produits_programmes (produit_id, programme_id)
    values ((v_c ->> 'produit_id')::int, (v_c ->> 'programme_id')::int) on conflict do nothing;
    select id into v_lot_id from lots
    where produit_id = (v_c ->> 'produit_id')::int and programme_id = (v_c ->> 'programme_id')::int
      and numero = v_numero and peremption is not distinct from v_per
    limit 1;
    if v_lot_id is null then
      insert into lots (produit_id, programme_id, numero, peremption, quantite)
      values ((v_c ->> 'produit_id')::int, (v_c ->> 'programme_id')::int, v_numero, v_per, v_qte) returning id into v_lot_id;
    else
      update lots set quantite = quantite + v_qte where id = v_lot_id;
    end if;
    insert into mouvements (produit_id, programme_id, lot_id, type, quantite, fournisseur, reference)
    values ((v_c ->> 'produit_id')::int, (v_c ->> 'programme_id')::int, v_lot_id, 'entree', v_qte, 'Stock de départ / inventaire', v_ref);
    v_nb_nouv := v_nb_nouv + 1;
    v_lot_id := null;
  end loop;

  perform journaliser('inventaire', jsonb_build_object('reference', v_ref, 'corrections', v_nb_corr, 'lots_ajoutes', v_nb_nouv));
  return jsonb_build_object('corrections', v_nb_corr, 'lots_ajoutes', v_nb_nouv);
end;
$$;

-- Commande au district à partir du rapport
-- p : { programme_id, mois, note, lignes: [{produit_id, quantite, prix_unitaire}] }
create or replace function public.enregistrer_commande(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
  v_l jsonb;
  v_total numeric := 0;
  v_mois date := date_trunc('month', (p ->> 'mois')::date)::date;
begin
  perform exiger('rapports');
  if jsonb_array_length(coalesce(p -> 'lignes', '[]'::jsonb)) = 0 then
    raise exception 'Aucun produit à commander.';
  end if;
  insert into commandes (programme_id, mois, note) values ((p ->> 'programme_id')::int, v_mois, nullif(trim(p ->> 'note'), ''))
  returning id into v_id;
  for v_l in select * from jsonb_array_elements(p -> 'lignes') loop
    if coalesce((v_l ->> 'quantite')::int, 0) > 0 then
      insert into commandes_lignes (commande_id, produit_id, quantite, prix_unitaire)
      values (v_id, (v_l ->> 'produit_id')::int, (v_l ->> 'quantite')::int, coalesce((v_l ->> 'prix_unitaire')::numeric, 0));
      v_total := v_total + (v_l ->> 'quantite')::int * coalesce((v_l ->> 'prix_unitaire')::numeric, 0);
    end if;
  end loop;
  update commandes set total = v_total, numero = 'CMD-' || to_char(v_mois, 'YYYY-MM') || '-' || lpad(v_id::text, 3, '0') where id = v_id;
  perform journaliser('commande', jsonb_build_object('commande', v_id, 'total', v_total));
  return jsonb_build_object('id', v_id, 'numero', (select numero from commandes where id = v_id), 'total', v_total);
end;
$$;

create or replace function public.annuler_commande(p_commande int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exiger('rapports');
  if exists (select 1 from commandes_lignes where commande_id = p_commande and recu > 0) then
    raise exception 'Des produits de cette commande ont déjà été reçus : elle ne peut plus être annulée.';
  end if;
  update commandes set statut = 'annulee' where id = p_commande and statut = 'envoyee';
  if not found then
    raise exception 'Commande introuvable ou déjà traitée.';
  end if;
  perform journaliser('commande_annulee', jsonb_build_object('commande', p_commande));
end;
$$;

-- Commande livrée en partie et dont le reste ne viendra pas : on la clôt (le reliquat est abandonné)
create or replace function public.clore_commande(p_commande int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exiger('rapports');
  update commandes set statut = 'soldee',
    note = concat_ws(' · ', note, 'Close le ' || to_char(now(), 'DD/MM/YYYY') || ' : reliquat non livré')
  where id = p_commande and statut = 'partielle';
  if not found then
    raise exception 'Seule une commande reçue en partie peut être close.';
  end if;
  perform journaliser('commande_close', jsonb_build_object('commande', p_commande));
end;
$$;

-- Correction manuelle de la quantité commandée dans le rapport (null = revenir au calcul)
create or replace function public.corriger_quantite_rapport(p_programme int, p_mois date, p_produit int, p_quantite int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exiger('rapports');
  if p_quantite is null then
    delete from rapports_corrections where programme_id = p_programme and mois = date_trunc('month', p_mois)::date and produit_id = p_produit;
  else
    if p_quantite < 0 then
      raise exception 'Quantité invalide.';
    end if;
    insert into rapports_corrections (programme_id, mois, produit_id, quantite)
    values (p_programme, date_trunc('month', p_mois)::date, p_produit, p_quantite)
    on conflict (programme_id, mois, produit_id)
    do update set quantite = excluded.quantite, corrige_par = auth.uid(), corrige_le = now();
  end if;
end;
$$;

-- Rapport mensuel : A + B − C − D = SD toujours vrai.
--   B (reçu)   = entrées + corrections positives (stock retrouvé)
--   D (pertes) = périmés + corrections négatives (casse, écart d'inventaire)
-- L'ancienne version (sans les colonnes de correction) est mise de côté sous un autre nom : rien n'est supprimé
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rapport_mensuel' and position('qcorr' in p.prosrc) = 0)
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rapport_mensuel_v4') then
    alter function public.rapport_mensuel(int, date) rename to rapport_mensuel_v4;
  end if;
end $$;
create or replace function public.rapport_mensuel(p_programme int, p_debut date)
returns table (
  produit_id int, designation text, stock_initial int, recu int, dispense int, perimes int,
  stock_disponible int, jours_rupture int, cmm numeric, quantite_calculee int, quantite_commandee int,
  corrigee boolean, prix_unitaire numeric, montant numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_debut timestamptz := date_trunc('month', p_debut);
  v_fin timestamptz := date_trunc('month', p_debut) + interval '1 month';
  v_borne timestamptz := least(v_fin, now());
begin
  if not peut('rapports') and not peut('programmes') then
    raise exception 'Action non autorisée (rapports).';
  end if;
  return query
  with prods as (
    select pr.id, pr.designation, pr.prix_achat
    from produits pr
    join produits_programmes pp on pp.produit_id = pr.id and pp.programme_id = p_programme
    where pr.actif
  ),
  avant as (
    select m.produit_id, sum(m.quantite)::int as q from mouvements m
    where m.programme_id = p_programme and m.created_at < v_debut group by m.produit_id
  ),
  dans as (
    select m.produit_id,
      coalesce(sum(m.quantite) filter (where m.type = 'entree' or (m.type = 'correction' and m.quantite > 0)), 0)::int as recu,
      coalesce(-sum(m.quantite) filter (where m.type in ('vente', 'distribution', 'annulation')), 0)::int as dispense,
      coalesce(-sum(m.quantite) filter (where m.type = 'perime' or (m.type = 'correction' and m.quantite < 0)), 0)::int as perimes,
      coalesce(sum(m.quantite), 0)::int as net
    from mouvements m
    where m.programme_id = p_programme and m.created_at >= v_debut and m.created_at < v_fin
    group by m.produit_id
  ),
  conso as (
    select m.produit_id, -sum(m.quantite) / 3.0 as cmm from mouvements m
    where m.programme_id = p_programme and m.type in ('vente', 'distribution', 'annulation')
      and m.created_at >= v_fin - interval '3 months' and m.created_at < v_fin
    group by m.produit_id
  ),
  evts as (
    select m.produit_id, m.created_at,
      coalesce(a.q, 0) + sum(m.quantite) over (partition by m.produit_id order by m.created_at, m.id) as solde,
      lead(m.created_at) over (partition by m.produit_id order by m.created_at, m.id) as suivant
    from mouvements m
    left join avant a on a.produit_id = m.produit_id
    where m.programme_id = p_programme and m.created_at >= v_debut and m.created_at < v_borne
  ),
  rupture as (
    -- Un produit jamais reçu n'est pas « en rupture » : on ne compte que ceux qui ont déjà eu du stock
    select pr.id as produit_id,
      case when coalesce(a.q, 0) <= 0 and not exists (select 1 from evts e where e.produit_id = pr.id) then 0
      else
        coalesce((
          select sum(extract(epoch from (coalesce(e.suivant, v_borne) - e.created_at)))
          from evts e where e.produit_id = pr.id and e.solde <= 0
        ), 0)
        + case when coalesce(a.q, 0) <= 0 and exists (select 1 from mouvements m2 where m2.produit_id = pr.id and m2.programme_id = p_programme and m2.created_at < v_debut) then
            extract(epoch from (coalesce((select min(e.created_at) from evts e where e.produit_id = pr.id), v_borne) - v_debut))
          else 0 end
      end as secondes
    from prods pr left join avant a on a.produit_id = pr.id
  ),
  calc as (
    select pr.id, pr.designation, pr.prix_achat,
      coalesce(a.q, 0) as si, coalesce(d.recu, 0) as recu, coalesce(d.dispense, 0) as dispense, coalesce(d.perimes, 0) as perimes,
      coalesce(a.q, 0) + coalesce(d.net, 0) as sd,
      greatest(0, ceil(coalesce(r.secondes, 0) / 86400.0))::int as jr,
      round(coalesce(c.cmm, 0), 1) as cmm,
      greatest(0, ceil(2 * coalesce(c.cmm, 0) - (coalesce(a.q, 0) + coalesce(d.net, 0))))::int as qcalc,
      rc.quantite as qcorr
    from prods pr
    left join avant a on a.produit_id = pr.id
    left join dans d on d.produit_id = pr.id
    left join conso c on c.produit_id = pr.id
    left join rupture r on r.produit_id = pr.id
    left join rapports_corrections rc on rc.programme_id = p_programme and rc.mois = v_debut::date and rc.produit_id = pr.id
  )
  select calc.id, calc.designation, calc.si, calc.recu, calc.dispense, calc.perimes, calc.sd, calc.jr, calc.cmm,
    calc.qcalc, coalesce(calc.qcorr, calc.qcalc), calc.qcorr is not null,
    calc.prix_achat::numeric, coalesce(calc.qcorr, calc.qcalc) * calc.prix_achat
  from calc
  order by calc.designation;
end;
$$;

-- Fermeture : la caisse est verrouillée pendant le calcul, une vente en cours est donc comptée
create or replace function public.fermer_caisse(p_especes_comptees numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
  v_res jsonb;
  v_attendu numeric;
begin
  perform exiger('vendre');
  if p_especes_comptees is null or p_especes_comptees < 0 then
    raise exception 'Montant compté invalide.';
  end if;
  select id into v_id from caisses where fermee_le is null for update;
  if v_id is null then
    raise exception 'Aucune caisse ouverte.';
  end if;
  v_res := resume_caisse(v_id);
  v_attendu := (v_res ->> 'fond')::numeric + (v_res ->> 'especes')::numeric + (v_res ->> 'remboursements')::numeric;
  update caisses set
    fermee_par = auth.uid(), fermee_le = now(),
    especes_attendues = v_attendu, especes_comptees = p_especes_comptees,
    ecart = p_especes_comptees - v_attendu
  where id = v_id;
  perform journaliser('fermeture_caisse', v_res || jsonb_build_object('caisse', v_id, 'comptees', p_especes_comptees, 'ecart', p_especes_comptees - v_attendu));
  return v_res || jsonb_build_object('attendu', v_attendu, 'ecart', p_especes_comptees - v_attendu);
end;
$$;

-- Remboursement de crédit : encaissé dans la caisse ouverte (sinon il échapperait au comptage du tiroir).
-- Le client est verrouillé : deux remboursements simultanés ne peuvent pas dépasser la dette.
create or replace function public.rembourser_credit(p_client int, p_montant numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_du numeric;
  v_caisse int;
begin
  perform exiger('credit');
  if p_montant is null or p_montant <= 0 then
    raise exception 'Montant invalide.';
  end if;
  perform 1 from clients where id = p_client for update;
  if not found then
    raise exception 'Client introuvable.';
  end if;
  select id into v_caisse from caisses where fermee_le is null for share;
  if v_caisse is null then
    raise exception 'Ouvrez la caisse pour encaisser un remboursement.';
  end if;
  select du into v_du from v_dettes where client_id = p_client;
  if p_montant > coalesce(v_du, 0) then
    raise exception 'Le montant dépasse ce que le client doit (% F).', coalesce(v_du, 0);
  end if;
  insert into credits_paiements (client_id, montant, caisse_id) values (p_client, p_montant, v_caisse);
  perform journaliser('remboursement', jsonb_build_object('client', p_client, 'montant', p_montant));
end;
$$;

-- Stock : nombre de lots connus, pour ne pas signaler « rupture » un produit jamais reçu
create or replace view public.v_stock with (security_invoker = true) as
select
  pp.produit_id,
  pp.programme_id,
  coalesce(sum(l.quantite) filter (where l.peremption is null or l.peremption >= current_date), 0)::int as quantite,
  coalesce(sum(l.quantite) filter (where l.peremption < current_date), 0)::int as quantite_perimee,
  min(l.peremption) filter (where l.quantite > 0 and (l.peremption is null or l.peremption >= current_date)) as prochaine_peremption,
  count(l.id)::int as nb_lots
from public.produits_programmes pp
left join public.lots l on l.produit_id = pp.produit_id and l.programme_id = pp.programme_id
group by pp.produit_id, pp.programme_id;

-- ============================================================
-- 6. Garde-fous sur la Base
-- ============================================================

-- Tout changement de prix de vente est noté au journal, qu'il vienne de l'Entrée ou de la Base
create or replace function public.journal_prix() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform journaliser('prix', jsonb_build_object('produit', new.designation, 'avant', old.prix_vente, 'apres', new.prix_vente));
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'produits_journal_prix') then
    create trigger produits_journal_prix after update of prix_vente on public.produits
      for each row when (old.prix_vente is distinct from new.prix_vente) execute function public.journal_prix();
  end if;
end $$;

-- On ne détache pas un produit d'une origine où il reste du stock (il disparaîtrait des écrans et des rapports)
create or replace function public.empecher_detachement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from lots where produit_id = old.produit_id and programme_id = old.programme_id and quantite > 0) then
    raise exception 'Ce produit a encore du stock dans cette origine : mettez-le à zéro (inventaire) avant de le décocher.';
  end if;
  return old;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'produits_programmes_detachement') then
    create trigger produits_programmes_detachement before delete on public.produits_programmes
      for each row execute function public.empecher_detachement();
  end if;
end $$;

-- Version de la base attendue par l'application (affichée au gérant si elle est en retard)
insert into public.parametres (cle, valeur) values ('version_base', '{"version": 5}')
on conflict (cle) do update set valeur = excluded.valeur;

-- Les fonctions ne sont appelables que par les utilisateurs connectés
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.journaliser(text, jsonb) from authenticated;
revoke execute on function public.creer_profil() from authenticated;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.journal_prix() from public, anon, authenticated;
revoke execute on function public.empecher_detachement() from public, anon, authenticated;
-- Fonctions internes, appelées seulement par les autres fonctions du serveur (jamais par le site)
revoke execute on function public.exiger(text) from public, anon, authenticated;
revoke execute on function public.caisse_ouverte() from public, anon, authenticated;
-- Ancienne version du rapport gardée de côté : plus appelable depuis le site
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rapport_mensuel_v4') then
    revoke execute on function public.rapport_mensuel_v4(int, date) from public, anon, authenticated;
  end if;
end $$;
