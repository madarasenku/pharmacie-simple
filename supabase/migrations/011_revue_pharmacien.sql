-- Pharmacie Simple — corrections de la revue « pharmacien » (version 1.8.0).
--   • Entrée de stock : un lot déjà périmé est refusé par le serveur (l'écran le refusait déjà).
--   • Rapport district : la CMM du mois en cours se calcule sur les 3 derniers mois jusqu'à aujourd'hui
--     (avant : jusqu'à la fin du mois, donc sous-estimée tant que le mois n'est pas fini) ;
--     la quantité à commander ne compte pas les lots déjà périmés encore sur l'étagère.
--     Les colonnes du formulaire (A + B − C − D = SD) ne changent pas.

create or replace function public.enregistrer_entree(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_produit int := (p ->> 'produit_id')::int;
  v_prog programmes%rowtype;
  v_qte int := (p ->> 'quantite')::int;
  v_numero text := coalesce(trim(p ->> 'numero_lot'), '');
  v_per date := nullif(p ->> 'peremption', '')::date;
  v_lot int;
  v_pa numeric := nullif(p ->> 'prix_achat', '')::numeric;
  v_pv numeric := nullif(p ->> 'prix_vente', '')::numeric;
  v_commande int := nullif(p ->> 'commande_id', '')::int;
begin
  perform exiger('entree');
  select * into v_prog from programmes where id = (p ->> 'programme_id')::int;
  if not found then
    raise exception 'Origine inconnue.';
  end if;
  if v_qte is null or v_qte <= 0 then
    raise exception 'Quantité invalide.';
  end if;
  -- Un médicament déjà périmé ne doit jamais entrer dans le stock utilisable
  if v_per is not null and v_per < current_date then
    raise exception 'Ce lot est déjà périmé (%) : il ne peut pas entrer en stock.', to_char(v_per, 'DD/MM/YYYY');
  end if;
  if v_commande is not null and not exists (
    select 1 from commandes where id = v_commande and programme_id = v_prog.id and statut in ('envoyee', 'partielle')
  ) then
    raise exception 'Cette commande n''est pas ouverte pour cette origine.';
  end if;
  insert into produits_programmes (produit_id, programme_id) values (v_produit, v_prog.id) on conflict do nothing;

  select id into v_lot from lots
  where produit_id = v_produit and programme_id = v_prog.id and numero = v_numero and peremption is not distinct from v_per
  limit 1;
  if v_lot is null then
    insert into lots (produit_id, programme_id, numero, peremption, quantite)
    values (v_produit, v_prog.id, v_numero, v_per, v_qte) returning id into v_lot;
  else
    update lots set quantite = quantite + v_qte where id = v_lot;
  end if;

  insert into mouvements (produit_id, programme_id, lot_id, type, quantite, prix_unitaire, fournisseur, reference, commande_id)
  values (v_produit, v_prog.id, v_lot, 'entree', v_qte, case when v_prog.est_vente or v_prog.recouvrable then v_pa end,
          nullif(p ->> 'fournisseur', ''), nullif(p ->> 'reference', ''), v_commande);

  if v_commande is not null then
    -- Un produit hors commande reste une entrée normale : la commande n'est alors pas touchée
    update commandes_lignes set recu = recu + v_qte where commande_id = v_commande and produit_id = v_produit;
    if found then
      update commandes set statut = case
          when not exists (select 1 from commandes_lignes where commande_id = v_commande and recu < quantite) then 'soldee'
          else 'partielle' end
      where id = v_commande;
    end if;
  end if;

  if v_prog.est_vente and v_pa is not null then
    update produits set prix_achat = v_pa where id = v_produit;
  end if;
  if v_prog.est_vente and v_pv is not null and peut('prix') then
    -- noté dans le journal par le déclencheur produits_journal_prix
    update produits set prix_vente = v_pv where id = v_produit and prix_vente is distinct from v_pv;
  end if;
  -- Programme recouvrable : son prix de vente est propre à l'origine (journal : produits_programmes_journal_prix)
  if v_prog.recouvrable and v_pv is not null and peut('prix') then
    update produits_programmes set prix_vente = v_pv
    where produit_id = v_produit and programme_id = v_prog.id and prix_vente is distinct from v_pv;
  end if;
  return v_lot;
end;
$$;

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
  v_en_cours boolean := now() < date_trunc('month', p_debut) + interval '1 month';
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
      -- 3 mois qui se terminent à la fin du mois, ou aujourd'hui pour le mois en cours (sinon la CMM est sous-estimée)
      and m.created_at >= v_borne - interval '3 months' and m.created_at < v_borne
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
  -- Mois en cours : les lots déjà périmés encore sur l'étagère ne peuvent pas être servis ;
  -- la quantité à commander se calcule sur le stock utilisable (le SD du formulaire, lui, reste A + B − C − D)
  hors_usage as (
    select l.produit_id, sum(l.quantite)::int as q from lots l
    where v_en_cours and l.programme_id = p_programme and l.quantite > 0 and l.peremption < current_date
    group by l.produit_id
  ),
  calc as (
    select pr.id, pr.designation, pr.prix_achat,
      coalesce(a.q, 0) as si, coalesce(d.recu, 0) as recu, coalesce(d.dispense, 0) as dispense, coalesce(d.perimes, 0) as perimes,
      coalesce(a.q, 0) + coalesce(d.net, 0) as sd,
      greatest(0, ceil(coalesce(r.secondes, 0) / 86400.0))::int as jr,
      round(coalesce(c.cmm, 0), 1) as cmm,
      greatest(0, ceil(2 * coalesce(c.cmm, 0) - greatest(0, coalesce(a.q, 0) + coalesce(d.net, 0) - coalesce(h.q, 0))))::int as qcalc,
      rc.quantite as qcorr
    from prods pr
    left join avant a on a.produit_id = pr.id
    left join dans d on d.produit_id = pr.id
    left join conso c on c.produit_id = pr.id
    left join rupture r on r.produit_id = pr.id
    left join hors_usage h on h.produit_id = pr.id
    left join rapports_corrections rc on rc.programme_id = p_programme and rc.mois = v_debut::date and rc.produit_id = pr.id
  )
  select calc.id, calc.designation, calc.si, calc.recu, calc.dispense, calc.perimes, calc.sd, calc.jr, calc.cmm,
    calc.qcalc, coalesce(calc.qcorr, calc.qcalc), calc.qcorr is not null,
    calc.prix_achat::numeric, coalesce(calc.qcorr, calc.qcalc) * calc.prix_achat
  from calc
  order by calc.designation;
end;
$$;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 11}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.enregistrer_entree(jsonb) from public, anon;
revoke execute on function public.rapport_mensuel(int, date) from public, anon;
grant execute on function public.enregistrer_entree(jsonb) to authenticated;
grant execute on function public.rapport_mensuel(int, date) to authenticated;
