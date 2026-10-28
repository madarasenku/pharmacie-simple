-- Pharmacie Simple — schéma principal
-- Tables, sécurité (RLS) et fonctions de gestion du stock.

-- ============================================================
-- Tables
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nom text not null default '',
  email text,
  role text not null default 'vendeur' check (role in ('gerant', 'vendeur')),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.parametres (
  cle text primary key,
  valeur jsonb not null default '{}'::jsonb
);

-- Un « programme » est une origine de stock. La Vente est un programme spécial (est_vente).
create table public.programmes (
  id serial primary key,
  code text not null unique,
  nom text not null,
  sigle text not null,
  est_vente boolean not null default false,
  frequence text not null default 'mensuel' check (frequence in ('mensuel', 'trimestriel')),
  categories text[] not null default '{}',
  destinataire text,
  actif boolean not null default true,
  ordre int not null default 100,
  created_at timestamptz not null default now()
);

create table public.produits (
  id serial primary key,
  designation text not null,
  code_barres text unique,
  presentation text,
  prix_achat numeric(12, 2) not null default 0,
  prix_vente numeric(12, 2) not null default 0,
  stock_min int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create index produits_designation_idx on public.produits (lower(designation));

create table public.produits_programmes (
  produit_id int not null references public.produits (id) on delete cascade,
  programme_id int not null references public.programmes (id) on delete cascade,
  primary key (produit_id, programme_id)
);
create index produits_programmes_programme_idx on public.produits_programmes (programme_id);

create table public.lots (
  id serial primary key,
  produit_id int not null references public.produits (id) on delete cascade,
  programme_id int not null references public.programmes (id),
  numero text not null default '',
  peremption date,
  quantite int not null default 0 check (quantite >= 0),
  created_at timestamptz not null default now()
);
create index lots_produit_programme_idx on public.lots (produit_id, programme_id);

create table public.clients (
  id serial primary key,
  nom text not null,
  telephone text,
  plafond numeric(12, 2) not null default 10000,
  created_at timestamptz not null default now()
);

create table public.caisses (
  id serial primary key,
  ouverte_par uuid references public.profiles (id),
  ouverte_le timestamptz not null default now(),
  fond numeric(12, 2) not null default 0,
  fermee_par uuid references public.profiles (id),
  fermee_le timestamptz,
  especes_attendues numeric(12, 2),
  especes_comptees numeric(12, 2),
  ecart numeric(12, 2)
);
create unique index caisses_une_ouverte on public.caisses ((true)) where fermee_le is null;

create table public.ventes (
  id bigserial primary key,
  numero text,
  programme_id int not null references public.programmes (id),
  mode_paiement text not null check (mode_paiement in ('especes', 'momo', 'credit', 'gratuit')),
  client_id int references public.clients (id),
  total numeric(12, 2) not null default 0,
  montant_recu numeric(12, 2),
  patient_nom text,
  patient_age numeric(6, 2),
  patient_age_unite text check (patient_age_unite in ('ans', 'mois')),
  patient_tranche text,
  patient_sexe text not null default 'NP' check (patient_sexe in ('M', 'F', 'NP')),
  patient_enceinte boolean not null default false,
  categorie text,
  caisse_id int references public.caisses (id),
  annulee boolean not null default false,
  annulee_par uuid references public.profiles (id),
  annulee_le timestamptz,
  motif_annulation text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index ventes_created_at_idx on public.ventes (created_at);
create index ventes_client_idx on public.ventes (client_id);

create table public.ventes_lignes (
  id bigserial primary key,
  vente_id bigint not null references public.ventes (id) on delete cascade,
  produit_id int not null references public.produits (id),
  lot_id int references public.lots (id),
  quantite int not null check (quantite > 0),
  prix_unitaire numeric(12, 2) not null default 0,
  cout_unitaire numeric(12, 2) not null default 0
);
create index ventes_lignes_vente_idx on public.ventes_lignes (vente_id);

-- Chaque entrée ou sortie de stock. quantite est signée : + entrée, − sortie.
create table public.mouvements (
  id bigserial primary key,
  produit_id int not null references public.produits (id),
  programme_id int not null references public.programmes (id),
  lot_id int references public.lots (id),
  type text not null check (type in ('entree', 'vente', 'distribution', 'correction', 'perime', 'annulation')),
  quantite int not null,
  prix_unitaire numeric(12, 2),
  fournisseur text,
  reference text,
  motif text,
  vente_id bigint references public.ventes (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index mouvements_produit_idx on public.mouvements (produit_id, programme_id, created_at);
create index mouvements_created_at_idx on public.mouvements (created_at);

create table public.credits_paiements (
  id bigserial primary key,
  client_id int not null references public.clients (id),
  montant numeric(12, 2) not null check (montant > 0),
  caisse_id int references public.caisses (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.journal (
  id bigserial primary key,
  user_id uuid references public.profiles (id) default auth.uid(),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index journal_created_at_idx on public.journal (created_at);

-- ============================================================
-- Fonctions d'aide (droits)
-- ============================================================

create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and actif);
$$;

create or replace function public.est_gerant() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and actif and role = 'gerant');
$$;

-- Droits du vendeur : vendre, entree, credit, programmes, corriger, annuler, prix, rapports, base
create or replace function public.peut(p_droit text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.est_gerant() or (
    public.est_membre() and coalesce(
      (select (valeur ->> p_droit)::boolean from parametres where cle = 'droits_vendeur'), false)
  );
$$;

create or replace function public.exiger(p_droit text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.peut(p_droit) then
    raise exception 'Action non autorisée (%).', p_droit using errcode = '42501';
  end if;
end;
$$;

create or replace function public.tranche_age(p_age numeric, p_unite text) returns text
language sql immutable as $$
  select case
    when p_age is null then null
    when (case when p_unite = 'mois' then p_age / 12.0 else p_age end) < 1 then '< 1 an'
    when (case when p_unite = 'mois' then p_age / 12.0 else p_age end) < 5 then '1 – 4 ans'
    when (case when p_unite = 'mois' then p_age / 12.0 else p_age end) < 15 then '5 – 14 ans'
    when (case when p_unite = 'mois' then p_age / 12.0 else p_age end) < 50 then '15 – 49 ans'
    else '50 ans et +'
  end;
$$;

create or replace function public.journaliser(p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into journal (user_id, action, details) values (auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Profil créé automatiquement à l'inscription. Le premier compte devient gérant.
create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nom, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nom', split_part(new.email, '@', 1)),
    new.email,
    case when exists (select 1 from profiles where role = 'gerant') then 'vendeur' else 'gerant' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.creer_profil();

-- ============================================================
-- Sécurité : RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.parametres enable row level security;
alter table public.programmes enable row level security;
alter table public.produits enable row level security;
alter table public.produits_programmes enable row level security;
alter table public.lots enable row level security;
alter table public.clients enable row level security;
alter table public.caisses enable row level security;
alter table public.ventes enable row level security;
alter table public.ventes_lignes enable row level security;
alter table public.mouvements enable row level security;
alter table public.credits_paiements enable row level security;
alter table public.journal enable row level security;

-- Lecture : tout membre actif
create policy profiles_lecture on public.profiles for select to authenticated using (public.est_membre() or id = auth.uid());
create policy parametres_lecture on public.parametres for select to authenticated using (public.est_membre());
create policy programmes_lecture on public.programmes for select to authenticated using (public.est_membre());
create policy produits_lecture on public.produits for select to authenticated using (public.est_membre());
create policy produits_programmes_lecture on public.produits_programmes for select to authenticated using (public.est_membre());
create policy lots_lecture on public.lots for select to authenticated using (public.est_membre());
create policy clients_lecture on public.clients for select to authenticated using (public.est_membre());
create policy caisses_lecture on public.caisses for select to authenticated using (public.est_membre());
create policy ventes_lecture on public.ventes for select to authenticated using (public.est_membre());
create policy ventes_lignes_lecture on public.ventes_lignes for select to authenticated using (public.est_membre());
create policy mouvements_lecture on public.mouvements for select to authenticated using (public.est_membre());
create policy credits_paiements_lecture on public.credits_paiements for select to authenticated using (public.est_membre());
create policy journal_lecture on public.journal for select to authenticated using (public.est_gerant());

-- Écritures directes autorisées (le reste passe par les fonctions ci-dessous)
create policy profiles_gerant on public.profiles for update to authenticated using (public.est_gerant()) with check (public.est_gerant());
create policy parametres_gerant on public.parametres for all to authenticated using (public.est_gerant()) with check (public.est_gerant());
create policy programmes_gerant on public.programmes for all to authenticated using (public.peut('base')) with check (public.peut('base'));
create policy produits_ajout on public.produits for insert to authenticated with check (public.peut('base') or public.peut('entree'));
create policy produits_modif on public.produits for update to authenticated using (public.peut('base') or public.peut('prix')) with check (public.peut('base') or public.peut('prix'));
create policy produits_programmes_ajout on public.produits_programmes for insert to authenticated with check (public.peut('base') or public.peut('entree'));
create policy produits_programmes_suppr on public.produits_programmes for delete to authenticated using (public.peut('base'));
create policy clients_ajout on public.clients for insert to authenticated with check (public.peut('credit'));
create policy clients_modif on public.clients for update to authenticated using (public.peut('credit')) with check (public.peut('credit'));

-- ============================================================
-- Vues (respectent la RLS de l'utilisateur)
-- ============================================================

create view public.v_stock with (security_invoker = true) as
select
  pp.produit_id,
  pp.programme_id,
  coalesce(sum(l.quantite) filter (where l.peremption is null or l.peremption >= current_date), 0)::int as quantite,
  coalesce(sum(l.quantite) filter (where l.peremption < current_date), 0)::int as quantite_perimee,
  min(l.peremption) filter (where l.quantite > 0 and (l.peremption is null or l.peremption >= current_date)) as prochaine_peremption
from public.produits_programmes pp
left join public.lots l on l.produit_id = pp.produit_id and l.programme_id = pp.programme_id
group by pp.produit_id, pp.programme_id;

-- Consommation moyenne mensuelle sur les 3 derniers mois
create view public.v_cmm with (security_invoker = true) as
select
  produit_id,
  programme_id,
  round(coalesce(-sum(quantite), 0) / 3.0, 1) as cmm
from public.mouvements
where type in ('vente', 'distribution', 'annulation')
  and created_at >= now() - interval '90 days'
group by produit_id, programme_id;

create view public.v_dettes with (security_invoker = true) as
select
  c.id as client_id,
  c.nom,
  c.telephone,
  c.plafond,
  coalesce((select sum(v.total) from public.ventes v where v.client_id = c.id and v.mode_paiement = 'credit' and not v.annulee), 0)
    - coalesce((select sum(p.montant) from public.credits_paiements p where p.client_id = c.id), 0) as du,
  (select min(v.created_at) from public.ventes v where v.client_id = c.id and v.mode_paiement = 'credit' and not v.annulee) as premier_credit
from public.clients c;

-- ============================================================
-- Fonctions métier
-- ============================================================

create or replace function public.caisse_ouverte() returns int
language sql stable security definer set search_path = public as $$
  select id from caisses where fermee_le is null limit 1;
$$;

create or replace function public.ouvrir_caisse(p_fond numeric) returns int
language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  perform exiger('vendre');
  if caisse_ouverte() is not null then
    raise exception 'La caisse est déjà ouverte.';
  end if;
  insert into caisses (ouverte_par, fond) values (auth.uid(), coalesce(p_fond, 0)) returning id into v_id;
  perform journaliser('ouverture_caisse', jsonb_build_object('caisse', v_id, 'fond', p_fond));
  return v_id;
end;
$$;

create or replace function public.resume_caisse(p_caisse int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fond', c.fond,
    'especes', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'especes' and not annulee), 0),
    'momo', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'momo' and not annulee), 0),
    'credit', coalesce((select sum(total) from ventes where caisse_id = c.id and mode_paiement = 'credit' and not annulee), 0),
    'remboursements', coalesce((select sum(montant) from credits_paiements where caisse_id = c.id), 0)
  )
  from caisses c where c.id = p_caisse and public.est_membre();
$$;

create or replace function public.fermer_caisse(p_especes_comptees numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id int := caisse_ouverte();
  v_res jsonb;
  v_attendu numeric;
begin
  perform exiger('vendre');
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

-- p : { programme_id, mode, client_id, montant_recu, categorie,
--       patient: { nom, age, unite, tranche, sexe, enceinte },
--       lignes: [ { produit_id, quantite } ] }
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
begin
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
    v_caisse := caisse_ouverte();
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

  insert into ventes (programme_id, mode_paiement, client_id, montant_recu, categorie,
                      patient_nom, patient_age, patient_age_unite, patient_tranche, patient_sexe, patient_enceinte, caisse_id)
  values (
    v_prog.id, v_mode, v_client, nullif(p ->> 'montant_recu', '')::numeric, nullif(p ->> 'categorie', ''),
    nullif(trim(p #>> '{patient,nom}'), ''),
    v_age,
    case when v_age is null then null else v_unite end,
    coalesce(tranche_age(v_age, v_unite), nullif(p #>> '{patient,tranche}', '')),
    coalesce(nullif(p #>> '{patient,sexe}', ''), 'NP'),
    coalesce((p #>> '{patient,enceinte}')::boolean, false),
    v_caisse
  ) returning id into v_vente_id;

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

    -- Le lot qui périme le plus tôt sort en premier
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
      insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, vente_id)
      values (v_produit.id, v_prog.id, v_lot.id,
              case when v_prog.est_vente then 'vente' else 'distribution' end, -v_pris, null, v_vente_id);
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
    numero = (case when v_prog.est_vente then 'V' else v_prog.sigle end) || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_vente_id::text, 5, '0')
  where id = v_vente_id;
  update mouvements set reference = (select numero from ventes where id = v_vente_id) where vente_id = v_vente_id;

  return jsonb_build_object('id', v_vente_id, 'numero', (select numero from ventes where id = v_vente_id), 'total', v_total);
end;
$$;

create or replace function public.annuler_vente(p_vente_id bigint, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_vente ventes%rowtype;
  v_l record;
begin
  perform exiger('annuler');
  select * into v_vente from ventes where id = p_vente_id for update;
  if not found or v_vente.annulee then
    raise exception 'Vente introuvable ou déjà annulée.';
  end if;
  for v_l in select * from ventes_lignes where vente_id = p_vente_id loop
    update lots set quantite = quantite + v_l.quantite where id = v_l.lot_id;
    insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, motif, vente_id)
    values (v_l.produit_id, v_vente.programme_id, v_l.lot_id, 'annulation', v_l.quantite, v_vente.numero, p_motif, p_vente_id);
  end loop;
  update ventes set annulee = true, annulee_par = auth.uid(), annulee_le = now(), motif_annulation = p_motif where id = p_vente_id;
  perform journaliser('annulation', jsonb_build_object('vente', v_vente.numero, 'total', v_vente.total, 'motif', p_motif));
end;
$$;

-- p : { produit_id, programme_id, quantite, numero_lot, peremption, prix_achat, prix_vente, fournisseur, reference }
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
begin
  perform exiger('entree');
  select * into v_prog from programmes where id = (p ->> 'programme_id')::int;
  if not found then
    raise exception 'Origine inconnue.';
  end if;
  if v_qte is null or v_qte <= 0 then
    raise exception 'Quantité invalide.';
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

  insert into mouvements (produit_id, programme_id, lot_id, type, quantite, prix_unitaire, fournisseur, reference)
  values (v_produit, v_prog.id, v_lot, 'entree', v_qte, case when v_prog.est_vente then v_pa end,
          nullif(p ->> 'fournisseur', ''), nullif(p ->> 'reference', ''));

  if v_prog.est_vente and v_pa is not null then
    update produits set prix_achat = v_pa where id = v_produit;
  end if;
  if v_prog.est_vente and v_pv is not null and peut('prix') then
    update produits set prix_vente = v_pv where id = v_produit and prix_vente is distinct from v_pv;
    if found then
      perform journaliser('prix', jsonb_build_object('produit', v_produit, 'prix_vente', v_pv));
    end if;
  end if;
  return v_lot;
end;
$$;

-- Corrige un lot à la quantité réellement comptée.
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
          case when p_motif ilike 'périm%' then 'perime' else 'correction' end, v_ecart, p_motif);
  perform journaliser('correction', jsonb_build_object('lot', p_lot_id, 'produit', v_lot.produit_id, 'avant', v_lot.quantite, 'apres', p_quantite_reelle, 'motif', p_motif));
end;
$$;

create or replace function public.rembourser_credit(p_client int, p_montant numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_du numeric;
begin
  perform exiger('credit');
  select du into v_du from v_dettes where client_id = p_client;
  if p_montant is null or p_montant <= 0 then
    raise exception 'Montant invalide.';
  end if;
  if p_montant > coalesce(v_du, 0) then
    raise exception 'Le montant dépasse ce que le client doit (% F).', v_du;
  end if;
  insert into credits_paiements (client_id, montant, caisse_id) values (p_client, p_montant, caisse_ouverte());
end;
$$;

-- Rapport mensuel d'une origine (Vente = « commandes recouvrables », ou un programme)
create or replace function public.rapport_mensuel(p_programme int, p_debut date)
returns table (
  produit_id int, designation text, stock_initial int, recu int, dispense int, perimes int,
  stock_disponible int, jours_rupture int, cmm numeric, quantite_commandee int, prix_unitaire numeric, montant numeric
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
      coalesce(sum(m.quantite) filter (where m.type = 'entree'), 0)::int as recu,
      coalesce(-sum(m.quantite) filter (where m.type in ('vente', 'distribution', 'annulation')), 0)::int as dispense,
      coalesce(-sum(m.quantite) filter (where m.type = 'perime'), 0)::int as perimes,
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
    -- solde après chaque mouvement du mois, pour compter les jours à zéro
    select m.produit_id, m.created_at,
      coalesce(a.q, 0) + sum(m.quantite) over (partition by m.produit_id order by m.created_at, m.id) as solde,
      lead(m.created_at) over (partition by m.produit_id order by m.created_at, m.id) as suivant
    from mouvements m
    left join avant a on a.produit_id = m.produit_id
    where m.programme_id = p_programme and m.created_at >= v_debut and m.created_at < v_borne
  ),
  rupture as (
    select pr.id as produit_id,
      coalesce((
        select sum(extract(epoch from (coalesce(e.suivant, v_borne) - e.created_at)))
        from evts e where e.produit_id = pr.id and e.solde <= 0
      ), 0)
      + case when coalesce(a.q, 0) <= 0 then
          extract(epoch from (coalesce((select min(e.created_at) from evts e where e.produit_id = pr.id), v_borne) - v_debut))
        else 0 end as secondes
    from prods pr left join avant a on a.produit_id = pr.id
  )
  select
    pr.id,
    pr.designation,
    coalesce(a.q, 0),
    coalesce(d.recu, 0),
    coalesce(d.dispense, 0),
    coalesce(d.perimes, 0),
    coalesce(a.q, 0) + coalesce(d.net, 0),
    greatest(0, ceil(coalesce(r.secondes, 0) / 86400.0))::int,
    round(coalesce(c.cmm, 0), 1),
    greatest(0, ceil(2 * coalesce(c.cmm, 0) - (coalesce(a.q, 0) + coalesce(d.net, 0))))::int,
    pr.prix_achat::numeric,
    greatest(0, ceil(2 * coalesce(c.cmm, 0) - (coalesce(a.q, 0) + coalesce(d.net, 0)))) * pr.prix_achat
  from prods pr
  left join avant a on a.produit_id = pr.id
  left join dans d on d.produit_id = pr.id
  left join conso c on c.produit_id = pr.id
  left join rupture r on r.produit_id = pr.id
  order by pr.designation;
end;
$$;

create or replace function public.stats_beneficiaires(p_programme int, p_debut date)
returns table (tranche text, sexe text, nombre int)
language sql stable security definer set search_path = public as $$
  select coalesce(v.patient_tranche, 'Non précisée'), v.patient_sexe, count(*)::int
  from ventes v
  where public.est_membre()
    and v.programme_id = p_programme and not v.annulee
    and v.created_at >= date_trunc('month', p_debut)
    and v.created_at < date_trunc('month', p_debut) + interval '1 month'
  group by 1, 2;
$$;

-- Les fonctions ne sont appelables que par les utilisateurs connectés
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.journaliser(text, jsonb) from authenticated;
