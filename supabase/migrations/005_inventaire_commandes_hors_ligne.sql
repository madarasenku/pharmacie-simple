-- Pharmacie Simple — inventaire, commandes au district, ventes hors ligne,
-- verrou après clôture de caisse, mot de passe à changer, performances.

-- ============================================================
-- 1. Performances (audit Supabase)
-- ============================================================

create index if not exists caisses_ouverte_par_idx on public.caisses (ouverte_par);
create index if not exists caisses_fermee_par_idx on public.caisses (fermee_par);
create index if not exists credits_paiements_caisse_idx on public.credits_paiements (caisse_id);
create index if not exists credits_paiements_client_idx on public.credits_paiements (client_id);
create index if not exists credits_paiements_created_by_idx on public.credits_paiements (created_by);
create index if not exists journal_user_idx on public.journal (user_id);
create index if not exists lots_programme_idx on public.lots (programme_id);
create index if not exists mouvements_created_by_idx on public.mouvements (created_by);
create index if not exists mouvements_lot_idx on public.mouvements (lot_id);
create index if not exists mouvements_programme_idx on public.mouvements (programme_id);
create index if not exists mouvements_vente_idx on public.mouvements (vente_id);
create index if not exists ventes_annulee_par_idx on public.ventes (annulee_par);
create index if not exists ventes_caisse_idx on public.ventes (caisse_id);
create index if not exists ventes_created_by_idx on public.ventes (created_by);
create index if not exists ventes_programme_idx on public.ventes (programme_id);
create index if not exists ventes_lignes_lot_idx on public.ventes_lignes (lot_id);
create index if not exists ventes_lignes_produit_idx on public.ventes_lignes (produit_id);
drop index if exists public.produits_designation_idx;

-- auth.uid() évalué une seule fois par requête
drop policy profiles_lecture on public.profiles;
create policy profiles_lecture on public.profiles for select to authenticated
  using (public.est_membre() or id = (select auth.uid()));

-- Une seule politique de lecture par table : les politiques d'écriture ne couvrent plus le SELECT
drop policy parametres_gerant on public.parametres;
create policy parametres_ajout on public.parametres for insert to authenticated with check (public.est_gerant());
create policy parametres_modif on public.parametres for update to authenticated using (public.est_gerant()) with check (public.est_gerant());
create policy parametres_suppr on public.parametres for delete to authenticated using (public.est_gerant());

drop policy programmes_gerant on public.programmes;
create policy programmes_ajout on public.programmes for insert to authenticated with check (public.peut('base'));
create policy programmes_modif on public.programmes for update to authenticated using (public.peut('base')) with check (public.peut('base'));

-- ============================================================
-- 2. Mot de passe temporaire à changer à la première connexion
-- ============================================================

alter table public.profiles add column doit_changer_mdp boolean not null default false;

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
  insert into profiles (id, nom, email, identifiant, role, actif, doit_changer_mdp)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nom', split_part(new.email, '@', 1)),
    new.email,
    nullif(new.raw_user_meta_data ->> 'identifiant', ''),
    case when v_premier then 'gerant' when v_par_gerant then v_role else 'vendeur' end,
    v_premier or v_par_gerant,
    v_par_gerant and not v_premier
  );
  return new;
end;
$$;

-- Appelée par l'application juste après que l'utilisateur a choisi son propre mot de passe
create or replace function public.mot_de_passe_personnel_defini() returns void
language sql security definer set search_path = public as $$
  update profiles set doit_changer_mdp = false where id = auth.uid();
$$;

-- ============================================================
-- 3. Ventes rejouées depuis la file hors ligne : jamais en double
-- ============================================================

alter table public.ventes add column ref_client uuid unique;
alter table public.ventes add column saisie_hors_ligne boolean not null default false;

-- ============================================================
-- 4. Commandes au district (bon de commande + reliquat)
-- ============================================================

create table public.commandes (
  id serial primary key,
  numero text,
  programme_id int not null references public.programmes (id),
  mois date not null,
  statut text not null default 'envoyee' check (statut in ('envoyee', 'partielle', 'soldee', 'annulee')),
  total numeric(12, 2) not null default 0,
  note text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index commandes_programme_idx on public.commandes (programme_id);
create index commandes_created_by_idx on public.commandes (created_by);

create table public.commandes_lignes (
  id serial primary key,
  commande_id int not null references public.commandes (id) on delete cascade,
  produit_id int not null references public.produits (id),
  quantite int not null check (quantite > 0),
  prix_unitaire numeric(12, 2) not null default 0,
  recu int not null default 0,
  unique (commande_id, produit_id)
);
create index commandes_lignes_produit_idx on public.commandes_lignes (produit_id);

alter table public.mouvements add column commande_id int references public.commandes (id);
create index mouvements_commande_idx on public.mouvements (commande_id);

-- Quantités du rapport corrigées à la main (partagées entre tous les postes)
create table public.rapports_corrections (
  programme_id int not null references public.programmes (id),
  mois date not null,
  produit_id int not null references public.produits (id),
  quantite int not null check (quantite >= 0),
  corrige_par uuid references public.profiles (id) default auth.uid(),
  corrige_le timestamptz not null default now(),
  primary key (programme_id, mois, produit_id)
);
create index rapports_corrections_produit_idx on public.rapports_corrections (produit_id);
create index rapports_corrections_par_idx on public.rapports_corrections (corrige_par);

alter table public.commandes enable row level security;
alter table public.commandes_lignes enable row level security;
alter table public.rapports_corrections enable row level security;
create policy commandes_lecture on public.commandes for select to authenticated using (public.est_membre());
create policy commandes_lignes_lecture on public.commandes_lignes for select to authenticated using (public.est_membre());
create policy rapports_corrections_lecture on public.rapports_corrections for select to authenticated using (public.est_membre());

-- ============================================================
-- 5. Fonctions métier
-- ============================================================

-- Vente : identifiant client pour rejouer sans doublon, date d'origine pour une vente hors ligne
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

  if v_prog.est_vente then
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
    if not exists (select 1 from produits_programmes where produit_id = v_produit.id and programme_id = v_prog.id) then
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
              case when v_prog.est_vente then v_produit.prix_vente else 0 end, v_produit.prix_achat);
      insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, vente_id, created_at)
      values (v_produit.id, v_prog.id, v_lot.id,
              case when v_prog.est_vente then 'vente' else 'distribution' end, -v_pris, null, v_vente_id, v_date);
      if v_prog.est_vente then
        v_total := v_total + v_pris * v_produit.prix_vente;
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

-- Annulation : une fois la caisse fermée, seul le gérant peut annuler (comme la journée verrouillée de labo)
create or replace function public.annuler_vente(p_vente_id bigint, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_vente ventes%rowtype;
  v_l record;
  v_caisse_fermee boolean;
begin
  perform exiger('annuler');
  select * into v_vente from ventes where id = p_vente_id for update;
  if not found or v_vente.annulee then
    raise exception 'Vente introuvable ou déjà annulée.';
  end if;
  select fermee_le is not null into v_caisse_fermee from caisses where id = v_vente.caisse_id;
  if coalesce(v_caisse_fermee, false) and not est_gerant() then
    raise exception 'La caisse de cette vente est déjà fermée : seul le gérant peut l''annuler.';
  end if;
  for v_l in select * from ventes_lignes where vente_id = p_vente_id loop
    update lots set quantite = quantite + v_l.quantite where id = v_l.lot_id;
    insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, motif, vente_id)
    values (v_l.produit_id, v_vente.programme_id, v_l.lot_id, 'annulation', v_l.quantite, v_vente.numero, p_motif, p_vente_id);
  end loop;
  update ventes set annulee = true, annulee_par = auth.uid(), annulee_le = now(), motif_annulation = p_motif where id = p_vente_id;
  perform journaliser('annulation', jsonb_build_object('vente', v_vente.numero, 'total', v_vente.total, 'motif', p_motif,
    'caisse_fermee', coalesce(v_caisse_fermee, false)));
end;
$$;

-- Entrée de stock : peut être rattachée à une commande (le reçu s'impute sur le reliquat)
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
  values (v_produit, v_prog.id, v_lot, 'entree', v_qte, case when v_prog.est_vente then v_pa end,
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
  return v_lot;
end;
$$;

-- Correction d'un lot : « périmé » seulement si la quantité baisse
create or replace function public.corriger_stock(p_lot_id int, p_quantite_reelle int, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lot lots%rowtype;
  v_ecart int;
begin
  perform exiger('corriger');
  if p_quantite_reelle is null or p_quantite_reelle < 0 then
    raise exception 'Quantité invalide.';
  end if;
  select * into v_lot from lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lot introuvable.';
  end if;
  v_ecart := p_quantite_reelle - v_lot.quantite;
  if v_ecart = 0 then
    return;
  end if;
  update lots set quantite = p_quantite_reelle where id = p_lot_id;
  insert into mouvements (produit_id, programme_id, lot_id, type, quantite, motif)
  values (v_lot.produit_id, v_lot.programme_id, p_lot_id,
          case when v_ecart < 0 and p_motif ilike 'périm%' then 'perime' else 'correction' end, v_ecart, p_motif);
  perform journaliser('correction', jsonb_build_object('lot', p_lot_id, 'produit', v_lot.produit_id, 'avant', v_lot.quantite, 'apres', p_quantite_reelle, 'motif', p_motif));
end;
$$;

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
drop function public.rapport_mensuel(int, date);
create function public.rapport_mensuel(p_programme int, p_debut date)
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
create trigger produits_journal_prix after update of prix_vente on public.produits
  for each row when (old.prix_vente is distinct from new.prix_vente) execute function public.journal_prix();

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
create trigger produits_programmes_detachement before delete on public.produits_programmes
  for each row execute function public.empecher_detachement();

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
