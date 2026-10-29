-- Pharmacie Simple — programmes « recouvrables » (PHPSP) : médicaments d'un programme VENDUS,
-- avec leur propre prix et leur propre point, séparé du point de la Vente.
-- Et : noms des agents toujours en MAJUSCULES.

-- ============================================================
-- 1. Programme recouvrable et prix propre à une origine
-- ============================================================

alter table public.programmes add column if not exists recouvrable boolean not null default false;
alter table public.programmes add constraint programmes_vente_ou_recouvrable check (not (est_vente and recouvrable));

-- Prix de vente pour cette origine (ex. prix PHPSP). Vide = prix de vente du produit.
alter table public.produits_programmes add column if not exists prix_vente numeric(12, 2) check (prix_vente >= 0);

-- Le prix d'une origine se modifie comme les autres prix (droits « base » ou « prix »),
-- et seulement le prix : changer le produit ou l'origine d'un rattachement reste impossible
revoke update on public.produits_programmes from authenticated, anon;
grant update (prix_vente) on public.produits_programmes to authenticated;
create policy produits_programmes_modif on public.produits_programmes for update to authenticated
  using (public.peut('base') or public.peut('prix')) with check (public.peut('base') or public.peut('prix'));

create or replace function public.journal_prix_origine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform journaliser('prix', jsonb_build_object(
    'produit', (select designation from produits where id = new.produit_id),
    'origine', (select sigle from programmes where id = new.programme_id),
    'avant', old.prix_vente, 'apres', new.prix_vente));
  return new;
end;
$$;
create trigger produits_programmes_journal_prix after update of prix_vente on public.produits_programmes
  for each row when (old.prix_vente is distinct from new.prix_vente) execute function public.journal_prix_origine();

-- Le programme PHPSP (à renommer au besoin dans l'onglet Base)
insert into public.programmes (code, nom, sigle, est_vente, recouvrable, ordre)
values ('PHPSP', 'PHPSP', 'PHPSP', false, true, 5)
on conflict (code) do update set recouvrable = true;

-- ============================================================
-- 2. Vente et entrée de stock pour un programme recouvrable
-- ============================================================

create or replace function public.enregistrer_vente(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prog programmes%rowtype;
  v_vente_id bigint;
  v_mode text := coalesce(p ->> 'mode', 'especes');
  v_ligne jsonb;
  v_produit produits%rowtype;
  v_reste int;
  v_pris int;
  v_lot record;
  v_total numeric := 0;
  v_caisse int;
  v_client int := nullif(p ->> 'client_id', '')::int;
  v_age numeric := nullif(p #>> '{patient,age}', '')::numeric;
  v_unite text := coalesce(nullif(p #>> '{patient,unite}', ''), 'ans');
  v_dette numeric;
  v_plafond numeric;
  v_ref uuid := nullif(p ->> 'ref_client', '')::uuid;
  v_date timestamptz := now();
  v_hors_ligne boolean := coalesce((p ->> 'hors_ligne')::boolean, false);
  v_existante ventes%rowtype;
  v_payant boolean;
  v_prix numeric;
begin
  -- Déjà enregistrée (la file hors ligne rejoue une vente arrivée au serveur) : on la renvoie telle quelle
  if v_ref is not null then
    select * into v_existante from ventes where ref_client = v_ref;
    if found then
      return jsonb_build_object('id', v_existante.id, 'numero', v_existante.numero, 'total', v_existante.total, 'deja', true);
    end if;
  end if;

  -- Vente faite hors ligne : on garde l'heure réelle (au plus 3 jours en arrière, jamais dans le futur)
  if v_hors_ligne and nullif(p ->> 'date_locale', '') is not null then
    v_date := greatest(least((p ->> 'date_locale')::timestamptz, now()), now() - interval '3 days');
  end if;

  select * into v_prog from programmes where id = (p ->> 'programme_id')::int and actif;
  if not found then
    raise exception 'Origine inconnue.';
  end if;

  -- Payant : la Vente, et les programmes « recouvrables » (PHPSP…) qui ont leur propre point
  v_payant := v_prog.est_vente or v_prog.recouvrable;
  if v_payant then
    perform exiger('vendre');
    if v_mode not in ('especes', 'momo', 'credit') then
      raise exception 'Mode de paiement invalide.';
    end if;
    if v_mode = 'credit' then
      perform exiger('credit');
      if v_client is null then
        raise exception 'Choisissez le client pour une vente à crédit.';
      end if;
    end if;
    -- Verrou partagé : une fermeture de caisse attend la fin de cette vente (et inversement)
    select id into v_caisse from caisses where fermee_le is null for share;
    if v_caisse is null then
      raise exception 'Ouvrez la caisse avant de vendre.';
    end if;
  else
    perform exiger('programmes');
    v_mode := 'gratuit';
    v_client := null;
    v_caisse := caisse_ouverte();
  end if;

  if jsonb_array_length(coalesce(p -> 'lignes', '[]'::jsonb)) = 0 then
    raise exception 'Le panier est vide.';
  end if;

  begin
    insert into ventes (programme_id, mode_paiement, client_id, montant_recu, categorie,
                        patient_nom, patient_age, patient_age_unite, patient_tranche, patient_sexe, patient_enceinte,
                        caisse_id, ref_client, saisie_hors_ligne, created_at)
    values (
      v_prog.id, v_mode, v_client, nullif(p ->> 'montant_recu', '')::numeric, nullif(p ->> 'categorie', ''),
      nullif(trim(p #>> '{patient,nom}'), ''),
      v_age,
      case when v_age is null then null else v_unite end,
      coalesce(tranche_age(v_age, v_unite), nullif(p #>> '{patient,tranche}', '')),
      coalesce(nullif(p #>> '{patient,sexe}', ''), 'NP'),
      coalesce((p #>> '{patient,enceinte}')::boolean, false),
      v_caisse, v_ref, v_hors_ligne, v_date
    ) returning id into v_vente_id;
  exception when unique_violation then
    -- Même vente envoyée au même instant par deux onglets : l'autre envoi l'a déjà enregistrée
    select * into v_existante from ventes where ref_client = v_ref;
    if found then
      return jsonb_build_object('id', v_existante.id, 'numero', v_existante.numero, 'total', v_existante.total, 'deja', true);
    end if;
    raise;
  end;

  for v_ligne in select * from jsonb_array_elements(p -> 'lignes') loop
    select * into v_produit from produits where id = (v_ligne ->> 'produit_id')::int;
    if not found then
      raise exception 'Produit inconnu.';
    end if;
    -- Prix de cette origine (ex. prix PHPSP), sinon le prix de vente du produit
    select coalesce(pp.prix_vente, v_produit.prix_vente) into v_prix
    from produits_programmes pp where pp.produit_id = v_produit.id and pp.programme_id = v_prog.id;
    if not found then
      raise exception '% n''est pas rattaché à %.', v_produit.designation, v_prog.nom;
    end if;
    v_reste := (v_ligne ->> 'quantite')::int;
    if v_reste is null or v_reste <= 0 then
      raise exception 'Quantité invalide pour %.', v_produit.designation;
    end if;

    for v_lot in
      select id, quantite from lots
      where produit_id = v_produit.id and programme_id = v_prog.id and quantite > 0
        and (peremption is null or peremption >= current_date)
      order by peremption nulls last, id
      for update
    loop
      exit when v_reste = 0;
      v_pris := least(v_reste, v_lot.quantite);
      update lots set quantite = quantite - v_pris where id = v_lot.id;
      insert into ventes_lignes (vente_id, produit_id, lot_id, quantite, prix_unitaire, cout_unitaire)
      values (v_vente_id, v_produit.id, v_lot.id, v_pris,
              case when v_payant then v_prix else 0 end, v_produit.prix_achat);
      insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, vente_id, created_at)
      values (v_produit.id, v_prog.id, v_lot.id,
              case when v_payant then 'vente' else 'distribution' end, -v_pris, null, v_vente_id, v_date);
      if v_payant then
        v_total := v_total + v_pris * v_prix;
      end if;
      v_reste := v_reste - v_pris;
    end loop;

    if v_reste > 0 then
      raise exception 'Stock insuffisant pour % (% manquant(s)).', v_produit.designation, v_reste;
    end if;
  end loop;

  if v_mode = 'credit' then
    select plafond into v_plafond from clients where id = v_client;
    select du into v_dette from v_dettes where client_id = v_client;
    if coalesce(v_dette, 0) + v_total > coalesce(v_plafond, 0) then
      raise exception 'Plafond de crédit dépassé pour ce client.';
    end if;
  end if;

  update ventes set
    total = v_total,
    numero = (case when v_prog.est_vente then 'V' else v_prog.sigle end) || '-' || to_char(v_date, 'YYYY') || '-' || lpad(v_vente_id::text, 5, '0')
  where id = v_vente_id;
  update mouvements set reference = (select numero from ventes where id = v_vente_id) where vente_id = v_vente_id;

  return jsonb_build_object('id', v_vente_id, 'numero', (select numero from ventes where id = v_vente_id), 'total', v_total);
end;
$$;

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


-- Résumé de caisse : l'argent des programmes recouvrables est dans le tiroir, mais on le montre à part
create or replace function public.resume_caisse(p_caisse int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fond', c.fond,
    'especes', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'especes' and not annulee), 0),
    'momo', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'momo' and not annulee), 0),
    'credit', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'credit' and not annulee), 0),
    'remboursements', coalesce((select sum(montant) from credits_paiements where caisse_id = c.id), 0),
    'recouvrables', coalesce((
      select jsonb_agg(jsonb_build_object('sigle', g.sigle,
        'especes', coalesce((select sum(total) from ventes v where v.caisse_id = c.id and v.programme_id = g.id and v.mode_paiement = 'especes' and not v.annulee), 0),
        'momo', coalesce((select sum(total) from ventes v where v.caisse_id = c.id and v.programme_id = g.id and v.mode_paiement = 'momo' and not v.annulee), 0),
        'credit', coalesce((select sum(total) from ventes v where v.caisse_id = c.id and v.programme_id = g.id and v.mode_paiement = 'credit' and not v.annulee), 0)
      ) order by g.ordre, g.id)
      from programmes g
      where g.recouvrable and exists (select 1 from ventes v where v.caisse_id = c.id and v.programme_id = g.id and not v.annulee)
    ), '[]'::jsonb)
  )
  from caisses c where c.id = p_caisse and public.est_membre();
$$;

-- ============================================================
-- 3. Noms des agents en MAJUSCULES
-- ============================================================

create or replace function public.nom_majuscule() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nom := upper(trim(new.nom));
  return new;
end;
$$;
create trigger profiles_nom_majuscule before insert or update of nom on public.profiles
  for each row execute function public.nom_majuscule();
update public.profiles set nom = upper(trim(nom)) where nom is distinct from upper(trim(nom));

-- ============================================================
-- 4. Version et droits
-- ============================================================

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 7}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.journal_prix_origine() from public, anon, authenticated;
revoke execute on function public.nom_majuscule() from public, anon, authenticated;
revoke execute on function public.enregistrer_vente(jsonb) from public, anon;
revoke execute on function public.enregistrer_entree(jsonb) from public, anon;
revoke execute on function public.resume_caisse(int) from public, anon;
grant execute on function public.enregistrer_vente(jsonb) to authenticated;
grant execute on function public.enregistrer_entree(jsonb) to authenticated;
grant execute on function public.resume_caisse(int) to authenticated;
