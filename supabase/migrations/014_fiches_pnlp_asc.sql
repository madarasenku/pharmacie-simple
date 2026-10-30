-- Pharmacie Simple — fiches PNLP du district (version 1.11.0).
--   • Les trois « RAPPORT-COMMANDE MENSUEL » de la Nouvelle PSP : ESPC (le centre), IDE (l'infirmier qui
--     approvisionne les ASC) et ASC (les agents de santé communautaires), remplis à partir du stock.
--   • Les agents de santé communautaires (ASC) : liste, remises de produits (sorties de stock notées
--     « distribution » avec l'ASC), saisie mensuelle de ce que chaque ASC a dispensé et perdu.
--   • Un code par produit (le code de la fiche du district), modifiable dans la Base.
-- Rien n'est effacé : tables et colonnes ajoutées seulement.

-- ---------- Produits : code du district ----------
alter table public.produits add column if not exists code text;

-- ---------- Agents de santé communautaires ----------
create table if not exists public.agents_asc (
  id serial primary key,
  nom text not null check (btrim(nom) <> ''),
  localite text,
  telephone text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

-- Remise à un ASC : une sortie de stock « distribution » qui nomme l'ASC (aucun patient, donc aucune vente)
alter table public.mouvements add column if not exists asc_id int references public.agents_asc (id);
create index if not exists mouvements_asc_idx on public.mouvements (asc_id) where asc_id is not null;

-- ---------- Lignes des fiches, dans l'ordre du formulaire papier ----------
create table if not exists public.fiches_lignes (
  id serial primary key,
  cle text not null unique,
  ordre int not null,
  designation text not null,
  unite text not null,
  sur_espc boolean not null default false,
  sur_ide boolean not null default false,
  sur_asc boolean not null default false,
  produit_id int references public.produits (id) on delete set null,
  programme_id int references public.programmes (id) on delete set null
);
-- Un produit d'une origine ne compte que sur une seule ligne (sinon il serait compté deux fois)
create unique index if not exists fiches_lignes_produit_unique on public.fiches_lignes (produit_id, programme_id) where produit_id is not null;
create index if not exists fiches_lignes_programme_idx on public.fiches_lignes (programme_id);

-- Ce qui se saisit à la main sur une fiche, gardé pour le mois : TDR, gouttes épaisses, commentaires,
-- et la quantité allouée corrigée ligne par ligne ({"l12": {"q": 40, "com": "..."}})
create table if not exists public.fiches_mois (
  fiche text not null check (fiche in ('ESPC', 'IDE', 'ASC')),
  mois date not null check (mois = date_trunc('month', mois)::date),
  tdr_realises int check (tdr_realises >= 0),
  tdr_positifs int check (tdr_positifs >= 0),
  ge_realisees int check (ge_realisees >= 0),
  ge_positives int check (ge_positives >= 0),
  commentaire text not null default '',
  lignes jsonb not null default '{}'::jsonb,
  maj_par uuid references public.profiles (id) default auth.uid(),
  maj_le timestamptz not null default now(),
  primary key (fiche, mois)
);
create index if not exists fiches_mois_maj_par_idx on public.fiches_mois (maj_par);

-- Rapport mensuel de chaque ASC : par ligne, stock initial (seulement s'il est corrigé), dispensé,
-- pertes et jours de rupture ({"l1": {"si": 10, "c": 4, "d": 0, "f": 0}}), et ses TDR
create table if not exists public.asc_mois (
  asc_id int not null references public.agents_asc (id),
  mois date not null check (mois = date_trunc('month', mois)::date),
  tdr_realises int check (tdr_realises >= 0),
  tdr_positifs int check (tdr_positifs >= 0),
  lignes jsonb not null default '{}'::jsonb,
  maj_par uuid references public.profiles (id) default auth.uid(),
  maj_le timestamptz not null default now(),
  primary key (asc_id, mois)
);
create index if not exists asc_mois_maj_par_idx on public.asc_mois (maj_par);

alter table public.agents_asc enable row level security;
alter table public.fiches_lignes enable row level security;
alter table public.fiches_mois enable row level security;
alter table public.asc_mois enable row level security;
-- Lecture pour l'équipe ; toute écriture passe par les fonctions ci-dessous
create policy agents_asc_lecture on public.agents_asc for select to authenticated using (public.est_membre());
create policy fiches_lignes_lecture on public.fiches_lignes for select to authenticated using (public.est_membre());
create policy fiches_mois_lecture on public.fiches_mois for select to authenticated using (public.est_membre());
create policy asc_mois_lecture on public.asc_mois for select to authenticated using (public.est_membre());

-- ---------- Les 30 lignes des fiches (ESPC : toutes ; IDE : 24 ; ASC : 16) ----------
insert into public.fiches_lignes (cle, ordre, designation, unite, sur_espc, sur_ide, sur_asc) values
  ('ASAQ25',   1, 'ARTESUNATE/AMODIAQUINE 25 / 67.5 mg ENFANT (2 - 11 MOIS) PLAQ/3 comp. BTE/25', 'PLAQUETTE', true, true, true),
  ('ASAQ50',   2, 'ARTESUNATE/AMODIAQUINE 50 / 135 mg ENFANT (1 - 5ANS) PLAQ/3 comp. BTE/25', 'PLAQUETTE', true, true, true),
  ('AL20P6',   3, 'ARTEMETHER/LUMEFANTRINE 20 / 120 mg (0 - 3ANS) PLAQ/6 comp. BTE/30', 'PLAQUETTE', true, true, true),
  ('AL20P12',  4, 'ARTEMETHER/LUMEFANTRINE 20 / 120 mg (3 - 8 ANS) PLAQ/12 comp. BTE/30', 'PLAQUETTE', true, true, true),
  ('AL60',     5, 'ARTEMETHER/LUMEFANTRINE 60/360 mg PLAQ/6 comp. Bte/30', 'PLAQUETTE', true, true, false),
  ('AL80',     6, 'ARTEMETHER/ LUMEFANTRINE 80/480mg PLAQ/6 comp. BTE/30', 'PLAQUETTE', true, true, false),
  ('ASPYR',    7, 'ARTESUNATE / PYRONARIDINE 20/60 mg granulé susp buv. BTE/90', 'SACHET', true, true, true),
  ('DHA40',    8, 'DIHYDROARTEMISININE / PIPERAQUINE PHOSPHATE 40 / 320 mg Comp. PLQ/9', 'PLAQUETTE', true, true, false),
  ('DHA80',    9, 'DIHYDROARTEMISININE / PIPERAQUINE PHOSPHATE 80 / 640 mg PLQ/6 Comp. BTE/25', 'PLAQUETTE', true, true, false),
  ('SP500',   10, 'SULFADOXINE+PYRIMETHAMINE 500/25 mg comp.', 'COMPRIME', true, true, false),
  ('SP250',   11, 'SULFADOXINE+PYRIMETHAMINE 250 /12.5 mg comp', 'COMPRIME', true, true, false),
  ('ASRECT',  12, 'ARTESUNATE 100 MG RECTOCAPS BTE/2', 'RECTOCAPS', true, false, true),
  ('PARA100', 13, 'PARACETAMOL 100 mg comp. BTE/100', 'COMPRIME', true, false, true),
  ('PARA250', 14, 'PARACETAMOL 250 mg comp BTE/100', 'COMPRIME', true, false, true),
  ('AMOX250', 15, 'AMOXICILLINE 250 mg Comp. Dispersible', 'COMPRIME', true, false, true),
  ('SROZINC', 16, 'KIT DE SELS DE REHYDRATATION ORAL BP 20.5g sachet+ ZINC 20mg comp plq/10 KIT', 'KIT', true, false, true),
  ('TDR',     17, 'TEST DE DIAGNOSTIC RAPIDE DU PALUDISME', 'TEST', true, true, true),
  ('GIEMSA',  18, 'GIEMSA SOLUTION FL/500ML', 'FLACON', true, true, false),
  ('LAME',    19, 'LAME PORTE OBJET BTE/50', 'LAME', true, true, false),
  ('HUILE',   20, 'HUILE A IMMERSION FL/250ML', 'FLACON', true, true, false),
  ('GANTS',   21, 'GANTS D''EXAMEN LATEX MM PQT/100', 'GANT', true, true, true),
  ('MILDAD',  22, 'MILDA Dual AI BALLE/50', 'MOUSTIQUAIRE', true, true, true),
  ('MILDAIG', 23, 'MILDA IG 2 BALLE/50', 'MOUSTIQUAIRE', true, true, true),
  ('MILDAS',  24, 'MILDA STANDARD/DELTAMETHRINE BALLE/50', 'MOUSTIQUAIRE', true, true, true),
  ('TAMPON',  25, 'TAMPON ISOPROPANOL 70% PQT/100', 'TAMPON', true, false, true),
  ('ASI120',  26, 'ARTESUNATE 120 mg pdre pr susp. inj. + solvant FL/10 ml BTE/1', 'AMPOULE', true, true, false),
  ('ASI60',   27, 'ARTESUNATE 60 mg pdre susp. inj. + SOLVANT FL/5 ml BTE/1', 'AMPOULE', true, true, false),
  ('ARM20',   28, 'ARTEMETHER 20 MG INJ BTE/6', 'AMPOULE', true, true, false),
  ('ARM80',   29, 'ARTEMETHER 80 MG INJ', 'AMPOULE', true, true, false),
  ('QUIN300', 30, 'QUININE SULFATE 300MG COMP. 10X10 BLISTERS', 'COMPRIME', true, true, false)
on conflict (cle) do nothing;

-- Programme du paludisme (code PNLP)
create or replace function public.programme_pnlp() returns int
language sql stable set search_path = public as $$
  select id from programmes where code = 'PNLP' or sigle = 'PNLP' order by (code = 'PNLP') desc, id limit 1
$$;

-- Relier les lignes aux produits déjà dans le PNLP, d'après leur nom (« A A (2-11 mois) », « AL 60/360 »…).
-- « AL 20/120 mg » sans âge ni plaquette n'est relié à aucune des deux lignes : le gérant choisit.
do $$
declare
  v_pnlp int := public.programme_pnlp();
  r record;
  v_produit int;
begin
  if v_pnlp is null then
    return;
  end if;
  for r in select * from (values
    ('ASAQ25', '(2 ?- ?11 ?mois|25 ?/ ?67)'),
    ('ASAQ50', '(1 ?- ?5 ?ans|50 ?/ ?135)'),
    ('AL20P6', '20 ?/ ?120.*(0 ?- ?3 ?ans|plaq ?/ ?6)'),
    ('AL20P12', '20 ?/ ?120.*(3 ?- ?8 ?ans|plaq ?/ ?12)'),
    ('AL60', '60 ?/ ?360'),
    ('AL80', '80 ?/ ?480'),
    ('ASPYR', '(pyramax|pyronaridine)'),
    ('DHA40', '40 ?/ ?320'),
    ('DHA80', '(80 ?/ ?640|d-artep)'),
    ('SP500', '^(sp|sulfadoxine)\M(?!.*250)'),
    ('SP250', '^(sp|sulfadoxine)\M.*250'),
    ('ASRECT', '(rectocap|suppo)'),
    ('PARA100', '^parac[eé]tamol 100 ?mg(?! ?/)'),
    ('PARA250', '^parac[eé]tamol 250 ?mg(?! ?/)'),
    ('AMOX250', '^amoxicilline 250.*dispers'),
    ('SROZINC', '(sro|r[eé]hydratation).*zinc'),
    ('TDR', '((^tdr|diagnostic rapide).*palu)'),
    ('GIEMSA', 'giemsa'),
    ('LAME', 'lame porte'),
    ('HUILE', 'huile.*immersion'),
    ('GANTS', '^gants?\M.*latex'),
    ('MILDAD', 'milda.*dual'),
    ('MILDAIG', 'milda.*ig ?2'),
    ('MILDAS', 'milda.*(standard|deltam)'),
    ('TAMPON', 'tampon.*isopropanol'),
    ('ASI120', 'art[eé]sunate 120'),
    ('ASI60', 'art[eé]sunate 60 ?mg'),
    ('ARM20', 'art[eé]m[eé]ther 20 ?mg inj'),
    ('ARM80', 'art[eé]m[eé]ther 80 ?mg inj'),
    ('QUIN300', 'quinine.*300')
  ) as m(cle, motif) loop
    select p.id into v_produit
    from public.produits p join public.produits_programmes pp on pp.produit_id = p.id and pp.programme_id = v_pnlp
    where p.actif and p.designation ~* r.motif
      and not exists (select 1 from public.fiches_lignes f where f.produit_id = p.id and f.programme_id = v_pnlp)
    order by p.id limit 1;
    if v_produit is not null then
      update public.fiches_lignes set produit_id = v_produit, programme_id = v_pnlp where cle = r.cle and produit_id is null;
    end if;
  end loop;
end $$;

-- ---------- Petits outils internes ----------
create or replace function public.nom_mois(d date) returns text
language sql immutable set search_path = public as $$
  select (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'])[extract(month from d)::int]
    || ' ' || extract(year from d)::int
$$;

-- Entier positif ou nul saisi dans un formulaire ('' ou null → null ; autre chose → erreur claire)
create or replace function public.entier_saisi(p_texte text, p_quoi text) returns int
language plpgsql immutable set search_path = public as $$
begin
  if p_texte is null or btrim(p_texte) = '' then
    return null;
  end if;
  if btrim(p_texte) !~ '^\d{1,9}$' then
    raise exception '% : nombre entier positif attendu (« % »).', p_quoi, p_texte;
  end if;
  return btrim(p_texte)::int;
end;
$$;

-- Stock de chaque ASC, ligne par ligne, pour un mois : A = stock initial (fin du mois précédent, ou celui saisi),
-- B = reçu (remises du mois), C = dispensé, D = pertes, E = A + B − C − D, F = jours de rupture, M-1 et M-2 = dispensé.
create or replace function public.asc_calcul(p_mois date, p_asc int default null)
returns table (asc_id int, ligne_id int, a int, b int, c int, d int, e int, f int, m1 int, m2 int, si int, saisi boolean)
language sql stable set search_path = public as $$
  with bornes as (select date_trunc('month', p_mois)::date as m0),
  lignes as (select fl.id, 'l' || fl.id as k, fl.produit_id, fl.programme_id from fiches_lignes fl where fl.sur_asc),
  agents as (select ag.id from agents_asc ag where (p_asc is null and ag.actif) or ag.id = p_asc),
  remises as (
    select m.asc_id, l.id as ligne_id, date_trunc('month', m.created_at)::date as mois, -sum(m.quantite)::int as b
    from mouvements m join lignes l on l.produit_id = m.produit_id and l.programme_id = m.programme_id
    where m.asc_id in (select id from agents) and m.type = 'distribution'
      and m.created_at < (select m0 from bornes) + interval '1 month'
    group by 1, 2, 3
  ),
  saisies as (
    select am.asc_id, l.id as ligne_id, am.mois,
      nullif(am.lignes -> l.k ->> 'si', '')::int as si,
      coalesce(nullif(am.lignes -> l.k ->> 'c', '')::int, 0) as c,
      coalesce(nullif(am.lignes -> l.k ->> 'd', '')::int, 0) as d,
      coalesce(nullif(am.lignes -> l.k ->> 'f', '')::int, 0) as f
    from asc_mois am join lignes l on am.lignes ? l.k
    where am.asc_id in (select id from agents) and am.mois <= (select m0 from bornes)
  ),
  cles as (
    select r.asc_id, r.ligne_id, r.mois from remises r
    union select s.asc_id, s.ligne_id, s.mois from saisies s
    union select ag.id, l.id, (select m0 from bornes) from agents ag cross join lignes l
  ),
  serie as (
    select k.asc_id, k.ligne_id, k.mois, coalesce(r.b, 0) as b, s.si, coalesce(s.c, 0) as c, coalesce(s.d, 0) as d, coalesce(s.f, 0) as f,
      s.asc_id is not null as saisi,
      -- un stock initial saisi repart de ce chiffre : chaque saisie ouvre un nouveau groupe
      count(s.si) over (partition by k.asc_id, k.ligne_id order by k.mois) as grp
    from cles k
    left join remises r on r.asc_id = k.asc_id and r.ligne_id = k.ligne_id and r.mois = k.mois
    left join saisies s on s.asc_id = k.asc_id and s.ligne_id = k.ligne_id and s.mois = k.mois
  ),
  calc as (
    select serie.*, coalesce(first_value(serie.si) over w, 0) + sum(serie.b - serie.c - serie.d) over w as e
    from serie window w as (partition by serie.asc_id, serie.ligne_id, serie.grp order by serie.mois)
  )
  select x.asc_id, x.ligne_id, (x.e - x.b + x.c + x.d)::int, x.b, x.c, x.d, x.e::int, x.f,
    coalesce((select y.c from calc y where y.asc_id = x.asc_id and y.ligne_id = x.ligne_id and y.mois = ((select m0 from bornes) - interval '1 month')::date), 0),
    coalesce((select y.c from calc y where y.asc_id = x.asc_id and y.ligne_id = x.ligne_id and y.mois = ((select m0 from bornes) - interval '2 months')::date), 0),
    x.si, x.saisi
  from calc x
  where x.mois = (select m0 from bornes)
$$;

-- ---------- La fiche du mois : ESPC, IDE, ou ASC (tous les ASC, ou un seul) ----------
-- ESPC : A stock initial · B reçu du DS · (remis aux ASC) · C dispensé, remises aux ASC comprises · D pertes et ajustements (±)
--        E = A + B − C ± D · F jours de rupture · G M-2 · H M-1 · I = (C + G + H) / 3 · J = E / I · K = I × 2 − E
-- IDE  : A · B · C remis aux ASC · D dispensé aux patients · E pertes (±) · F = A + B − C − D ± E · G · H · I
--        J = (D + H + I) / 3 · K = F / J · L = Σ des quantités à allouer à chaque ASC
-- ASC  : A · B reçu de l'IDE · C dispensé · D pertes · E = A + B − C − D · F · G · H · I = (C + G + H) / 3 · J = E / I · K = I × 1,5 − E
create or replace function public.fiche_pnlp(p_fiche text, p_mois date, p_asc int default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_m0 date := date_trunc('month', p_mois)::date;
  v_debut timestamptz := date_trunc('month', p_mois);
  v_fin timestamptz := date_trunc('month', p_mois) + interval '1 month';
  v_m1 timestamptz := date_trunc('month', p_mois) - interval '1 month';
  v_m2 timestamptz := date_trunc('month', p_mois) - interval '2 months';
  v_max numeric := case when p_fiche = 'ASC' then 1.5 else 2 end;
  v_pnlp int := programme_pnlp();
  v_fm fiches_mois%rowtype;
  v_am asc_mois%rowtype;
  v_ag agents_asc%rowtype;
  v_lignes jsonb;
  v_entete jsonb;
  v_tdr record;
begin
  if not peut('rapports') and not peut('programmes') then
    raise exception 'Action non autorisée (rapports).' using errcode = '42501';
  end if;
  if p_fiche is null or p_fiche not in ('ESPC', 'IDE', 'ASC') then
    raise exception 'Fiche inconnue : ESPC, IDE ou ASC.';
  end if;
  if p_mois is null then
    raise exception 'Mois invalide.';
  end if;
  if p_asc is not null then
    if p_fiche <> 'ASC' then
      raise exception 'Un ASC ne se choisit que sur la fiche ASC.';
    end if;
    select * into v_ag from agents_asc where id = p_asc;
    if not found then
      raise exception 'ASC inconnu.';
    end if;
    select * into v_am from asc_mois where asc_id = p_asc and mois = v_m0;
  else
    select * into v_fm from fiches_mois where fiche = p_fiche and mois = v_m0;
  end if;

  if p_fiche in ('ESPC', 'IDE') then
    with lignes as (
      select fl.id as ligne_id, 'l' || fl.id as k, fl.ordre, fl.designation, fl.unite, fl.produit_id, fl.programme_id, fl.sur_asc as dans_asc
      from fiches_lignes fl
      where (p_fiche = 'ESPC' and fl.sur_espc) or (p_fiche = 'IDE' and fl.sur_ide)
      union all
      -- Autres produits du PNLP, absents du formulaire : les lignes vides du bas de la fiche
      select null, 'p' || p.id, 1000, p.designation, coalesce(upper(p.presentation), ''), p.id, v_pnlp, false
      from produits p join produits_programmes pp on pp.produit_id = p.id and pp.programme_id = v_pnlp
      where p.actif and not exists (select 1 from fiches_lignes f2 where f2.produit_id = p.id and f2.programme_id = v_pnlp)
    ),
    ruptures as (
      select g.pid, r.produit_id, r.jours_rupture
      from (select distinct programme_id as pid from lignes where programme_id is not null) g
      cross join lateral rapport_mensuel(g.pid, v_m0) r
    ),
    mv as (
      select l.k,
        coalesce(sum(m.quantite) filter (where m.created_at < v_debut), 0) as a,
        coalesce(sum(m.quantite) filter (where m.created_at >= v_debut and m.type = 'entree'), 0) as b,
        coalesce(-sum(m.quantite) filter (where m.created_at >= v_debut and m.type = 'distribution' and m.asc_id is not null), 0) as asc_q,
        coalesce(-sum(m.quantite) filter (where m.created_at >= v_debut and m.type in ('vente', 'distribution', 'annulation') and m.asc_id is null), 0) as disp,
        coalesce(sum(m.quantite) filter (where m.created_at >= v_debut and m.type in ('perime', 'correction')), 0) as d,
        coalesce(sum(m.quantite), 0) as e,
        -- Consommations passées : remises aux ASC comprises sur l'ESPC, patients seulement sur l'IDE
        coalesce(-sum(m.quantite) filter (where m.created_at >= v_m1 and m.created_at < v_debut and m.type in ('vente', 'distribution', 'annulation')
                                            and (p_fiche = 'ESPC' or m.asc_id is null)), 0) as m1,
        coalesce(-sum(m.quantite) filter (where m.created_at >= v_m2 and m.created_at < v_m1 and m.type in ('vente', 'distribution', 'annulation')
                                            and (p_fiche = 'ESPC' or m.asc_id is null)), 0) as m2
      from lignes l
      join mouvements m on m.produit_id = l.produit_id and m.programme_id = l.programme_id and m.created_at < v_fin
      group by l.k
    ),
    asc_k as (
      select x.ligne_id, sum(greatest(0, ceil((x.c + x.m1 + x.m2) / 3.0 * 1.5 - x.e)))::int as q
      from asc_calcul(v_m0, null) x group by x.ligne_id
    ),
    calc as (
      select l.k, l.ligne_id, l.ordre, l.designation, l.unite, l.produit_id, l.programme_id,
        p.designation as produit, p.code, g.sigle as origine,
        coalesce(mv.a, 0)::int as a, coalesce(mv.b, 0)::int as b, coalesce(mv.asc_q, 0)::int as asc_q,
        (coalesce(mv.disp, 0) + case when p_fiche = 'ESPC' then coalesce(mv.asc_q, 0) else 0 end)::int as c,
        coalesce(mv.d, 0)::int as d, coalesce(mv.e, 0)::int as e, coalesce(r.jours_rupture, 0) as f,
        coalesce(mv.m1, 0)::int as m1, coalesce(mv.m2, 0)::int as m2,
        case when l.dans_asc then coalesce(ak.q, 0) end as qasc
      from lignes l
      left join produits p on p.id = l.produit_id
      left join programmes g on g.id = l.programme_id
      left join mv on mv.k = l.k
      left join ruptures r on r.pid = l.programme_id and r.produit_id = l.produit_id
      left join asc_k ak on ak.ligne_id = l.ligne_id
    ),
    fin as (
      select calc.*, (c + m1 + m2) / 3.0 as cmm,
        case when p_fiche = 'ESPC' then greatest(0, ceil((c + m1 + m2) / 3.0 * v_max - e))::int else qasc end as qcalc
      from calc
    )
    select jsonb_agg(jsonb_build_object(
      'k', k, 'ligne_id', ligne_id, 'designation', designation, 'unite', unite, 'code', code,
      'produit_id', produit_id, 'programme_id', programme_id, 'produit', produit, 'origine', origine,
      'a', a, 'b', b, 'asc', asc_q, 'c', c, 'd', d, 'e', e, 'f', f, 'm2', m2, 'm1', m1,
      'cmm', round(cmm, 1), 'msd', case when cmm > 0 then round(e / cmm, 1) end,
      'niveau', case when produit_id is null or cmm <= 0 then null when e / cmm < 0.5 then 'urgent' when e / cmm < 1 then 'bas' when e / cmm > v_max then 'sur' else 'ok' end,
      'qcalc', qcalc,
      'q', case when produit_id is null then null else coalesce(nullif(v_fm.lignes -> k ->> 'q', '')::int, qcalc) end,
      'corrigee', produit_id is not null and nullif(v_fm.lignes -> k ->> 'q', '') is not null,
      'commentaire', coalesce(v_fm.lignes -> k ->> 'com', '')
    ) order by ordre, designation) into v_lignes
    from fin;

    v_entete := jsonb_build_object('tdr_realises', v_fm.tdr_realises, 'tdr_positifs', v_fm.tdr_positifs,
      'ge_realisees', v_fm.ge_realisees, 'ge_positives', v_fm.ge_positives, 'commentaire', coalesce(v_fm.commentaire, ''),
      'maj_le', v_fm.maj_le, 'maj_par', (select nom from profiles where id = v_fm.maj_par));

  else
    with x as (select * from asc_calcul(v_m0, p_asc)),
    agg as (
      select x.ligne_id, sum(x.a)::int as a, sum(x.b)::int as b, sum(x.c)::int as c, sum(x.d)::int as d, sum(x.e)::int as e,
        max(x.f)::int as f, sum(x.m1)::int as m1, sum(x.m2)::int as m2, max(x.si) as si
      from x group by x.ligne_id
    ),
    calc as (
      select 'l' || fl.id as k, fl.id as ligne_id, fl.ordre, fl.designation, fl.unite, fl.produit_id, fl.programme_id,
        p.designation as produit, p.code, g.sigle as origine,
        coalesce(agg.a, 0) as a, coalesce(agg.b, 0) as b, coalesce(agg.c, 0) as c, coalesce(agg.d, 0) as d, coalesce(agg.e, 0) as e,
        coalesce(agg.f, 0) as f, coalesce(agg.m1, 0) as m1, coalesce(agg.m2, 0) as m2, agg.si,
        (coalesce(agg.c, 0) + coalesce(agg.m1, 0) + coalesce(agg.m2, 0)) / 3.0 as cmm
      from fiches_lignes fl
      left join agg on agg.ligne_id = fl.id
      left join produits p on p.id = fl.produit_id
      left join programmes g on g.id = fl.programme_id
      where fl.sur_asc
    ),
    fin as (select calc.*, greatest(0, ceil(cmm * v_max - e))::int as qcalc from calc)
    select jsonb_agg(jsonb_build_object(
      'k', k, 'ligne_id', ligne_id, 'designation', designation, 'unite', unite, 'code', code,
      'produit_id', produit_id, 'programme_id', programme_id, 'produit', produit, 'origine', origine,
      'a', a, 'b', b, 'asc', null, 'c', c, 'd', d, 'e', e, 'f', f, 'm2', m2, 'm1', m1, 'si', si,
      'cmm', round(cmm, 1), 'msd', case when cmm > 0 then round(e / cmm, 1) end,
      'niveau', case when cmm <= 0 then null when e / cmm < 0.5 then 'urgent' when e / cmm < 1 then 'bas' when e / cmm > v_max then 'sur' else 'ok' end,
      'qcalc', qcalc,
      'q', case when p_asc is null then coalesce(nullif(v_fm.lignes -> k ->> 'q', '')::int, qcalc) else qcalc end,
      'corrigee', p_asc is null and nullif(v_fm.lignes -> k ->> 'q', '') is not null,
      'commentaire', case when p_asc is null then coalesce(v_fm.lignes -> k ->> 'com', '') else '' end
    ) order by ordre) into v_lignes
    from fin;

    if p_asc is null then
      select sum(am.tdr_realises)::int as r, sum(am.tdr_positifs)::int as p into v_tdr
      from asc_mois am join agents_asc ag on ag.id = am.asc_id and ag.actif where am.mois = v_m0;
      v_entete := jsonb_build_object('tdr_realises', coalesce(v_fm.tdr_realises, v_tdr.r), 'tdr_positifs', coalesce(v_fm.tdr_positifs, v_tdr.p),
        'tdr_des_asc', jsonb_build_object('realises', v_tdr.r, 'positifs', v_tdr.p),
        'commentaire', coalesce(v_fm.commentaire, ''), 'maj_le', v_fm.maj_le, 'maj_par', (select nom from profiles where id = v_fm.maj_par));
    else
      v_entete := jsonb_build_object('tdr_realises', v_am.tdr_realises, 'tdr_positifs', v_am.tdr_positifs,
        'maj_le', v_am.maj_le, 'maj_par', (select nom from profiles where id = v_am.maj_par));
    end if;
  end if;

  v_lignes := coalesce(v_lignes, '[]'::jsonb);
  return jsonb_build_object(
    'fiche', p_fiche, 'mois', v_m0, 'en_cours', now() < v_fin,
    'niveaux', jsonb_build_object('max', v_max, 'min', 1, 'urgence', 0.5),
    'urgent', exists (select 1 from jsonb_array_elements(v_lignes) l where l ->> 'niveau' = 'urgent'),
    'nombre_asc', case when p_fiche = 'ASC' then (select count(*) from agents_asc where actif) end,
    'asc', case when p_asc is not null then jsonb_build_object('id', v_ag.id, 'nom', v_ag.nom, 'localite', v_ag.localite, 'actif', v_ag.actif) end,
    'entete', v_entete,
    'lignes', v_lignes);
end;
$$;

-- ---------- Enregistrer ce qui se saisit à la main sur une fiche (ESPC, IDE ou ASC consolidée) ----------
create or replace function public.enregistrer_fiche(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fiche text := p ->> 'fiche';
  v_mois date := date_trunc('month', (p ->> 'mois')::date)::date;
  v_tr int := entier_saisi(p ->> 'tdr_realises', 'TDR réalisés');
  v_tp int := entier_saisi(p ->> 'tdr_positifs', 'TDR positifs');
  v_gr int := entier_saisi(p ->> 'ge_realisees', 'Gouttes épaisses réalisées');
  v_gp int := entier_saisi(p ->> 'ge_positives', 'Gouttes épaisses positives');
  v_l record;
  v_q int;
  v_com text;
  v_lignes jsonb := '{}'::jsonb;
  v_nb int := 0;
begin
  if not peut('rapports') and not peut('programmes') then
    raise exception 'Action non autorisée (rapports).' using errcode = '42501';
  end if;
  if v_fiche is null or v_fiche not in ('ESPC', 'IDE', 'ASC') then
    raise exception 'Fiche inconnue : ESPC, IDE ou ASC.';
  end if;
  if v_mois is null or v_mois > current_date then
    raise exception 'Mois invalide.';
  end if;
  if v_tp > v_tr or v_gp > v_gr then
    raise exception 'Les positifs ne peuvent pas dépasser le nombre réalisé.';
  end if;
  for v_l in select key, value from jsonb_each(coalesce(p -> 'lignes', '{}'::jsonb)) loop
    if v_l.key !~ '^[lp]\d+$' then
      raise exception 'Ligne de fiche inconnue.';
    end if;
    v_q := entier_saisi(v_l.value ->> 'q', 'Quantité');
    v_com := left(btrim(coalesce(v_l.value ->> 'com', '')), 300);
    if v_q is not null or v_com <> '' then
      v_lignes := v_lignes || jsonb_build_object(v_l.key, jsonb_strip_nulls(jsonb_build_object('q', v_q, 'com', nullif(v_com, ''))));
      if v_q is not null then
        v_nb := v_nb + 1;
      end if;
    end if;
  end loop;
  insert into fiches_mois (fiche, mois, tdr_realises, tdr_positifs, ge_realisees, ge_positives, commentaire, lignes, maj_par, maj_le)
  values (v_fiche, v_mois, v_tr, v_tp, v_gr, v_gp, left(btrim(coalesce(p ->> 'commentaire', '')), 1000), v_lignes, auth.uid(), now())
  on conflict (fiche, mois) do update set
    tdr_realises = excluded.tdr_realises, tdr_positifs = excluded.tdr_positifs,
    ge_realisees = excluded.ge_realisees, ge_positives = excluded.ge_positives,
    commentaire = excluded.commentaire, lignes = excluded.lignes, maj_par = excluded.maj_par, maj_le = excluded.maj_le;
  perform journal_texte('fiche_pnlp', 'Fiche ' || v_fiche || ' · ' || nom_mois(v_mois)
    || case when v_nb > 0 then ' · ' || v_nb || ' quantité(s) corrigée(s)' else '' end
    || case when v_tr is not null then ' · TDR ' || v_tr || coalesce(' (' || v_tp || ' positifs)', '') else '' end
    || case when v_gr is not null then ' · GE ' || v_gr || coalesce(' (' || v_gp || ' positives)', '') else '' end,
    jsonb_build_object('fiche', v_fiche, 'mois', v_mois));
end;
$$;

-- ---------- Agents de santé communautaires : ajouter ou modifier ----------
create or replace function public.enregistrer_asc(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id int := nullif(p ->> 'id', '')::int;
  v_nom text := upper(btrim(coalesce(p ->> 'nom', '')));
  v_loc text := nullif(btrim(coalesce(p ->> 'localite', '')), '');
  v_tel text := nullif(btrim(coalesce(p ->> 'telephone', '')), '');
  v_actif boolean := coalesce((p ->> 'actif')::boolean, true);
  v_avant agents_asc%rowtype;
  ch text[] := '{}';
begin
  perform exiger('programmes');
  if v_nom = '' then
    raise exception 'Le nom de l''ASC est obligatoire.';
  end if;
  if v_id is null then
    insert into agents_asc (nom, localite, telephone, actif) values (v_nom, v_loc, v_tel, v_actif) returning id into v_id;
    perform journal_texte('asc_cree', 'ASC ' || v_nom || coalesce(' · ' || v_loc, '') || coalesce(' · ' || v_tel, ''), jsonb_build_object('asc', v_id));
    return v_id;
  end if;
  select * into v_avant from agents_asc where id = v_id for update;
  if not found then
    raise exception 'ASC inconnu.';
  end if;
  update agents_asc set nom = v_nom, localite = v_loc, telephone = v_tel, actif = v_actif where id = v_id;
  if v_nom is distinct from v_avant.nom then ch := ch || ('nom « ' || v_avant.nom || ' » → « ' || v_nom || ' »'); end if;
  if v_loc is distinct from v_avant.localite then ch := ch || ('localité ' || coalesce(v_loc, 'retirée')); end if;
  if v_tel is distinct from v_avant.telephone then ch := ch || ('téléphone ' || coalesce(v_tel, 'retiré')); end if;
  if v_actif is distinct from v_avant.actif then ch := ch || case when v_actif then 'réactivé' else 'désactivé' end; end if;
  if cardinality(ch) > 0 then
    perform journal_texte('asc_modifie', 'ASC ' || v_nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('asc', v_id));
  end if;
  return v_id;
end;
$$;

-- ---------- Remettre des produits à un ASC : sortie de stock, du lot qui périme le plus tôt (FEFO) ----------
create or replace function public.remettre_asc(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ag agents_asc%rowtype;
  v_l jsonb;
  v_produit produits%rowtype;
  v_prog programmes%rowtype;
  v_q int;
  v_reste int;
  v_pris int;
  v_lot record;
  v_total int := 0;
  v_articles text[] := '{}';
  v_sigles text[] := '{}';
begin
  perform exiger('programmes');
  select * into v_ag from agents_asc where id = nullif(p ->> 'asc_id', '')::int;
  if not found or not v_ag.actif then
    raise exception 'Choisissez un ASC actif.';
  end if;
  if jsonb_array_length(coalesce(p -> 'lignes', '[]'::jsonb)) = 0 then
    raise exception 'Rien à remettre : indiquez au moins une quantité.';
  end if;
  for v_l in select * from jsonb_array_elements(p -> 'lignes') loop
    select * into v_produit from produits where id = nullif(v_l ->> 'produit_id', '')::int;
    select * into v_prog from programmes where id = nullif(v_l ->> 'programme_id', '')::int;
    if v_produit.id is null or v_prog.id is null
       or not exists (select 1 from produits_programmes where produit_id = v_produit.id and programme_id = v_prog.id) then
      raise exception 'Produit inconnu pour cette origine.';
    end if;
    v_q := entier_saisi(v_l ->> 'quantite', 'Quantité de ' || v_produit.designation);
    if v_q is null or v_q <= 0 then
      raise exception 'Quantité invalide pour %.', v_produit.designation;
    end if;
    v_reste := v_q;
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
      insert into mouvements (produit_id, programme_id, lot_id, type, quantite, reference, motif, asc_id)
      values (v_produit.id, v_prog.id, v_lot.id, 'distribution', -v_pris, 'ASC ' || v_ag.nom, 'Remise ASC', v_ag.id);
      v_reste := v_reste - v_pris;
    end loop;
    if v_reste > 0 then
      raise exception 'Stock insuffisant pour % (% manquant(s)).', v_produit.designation, v_reste;
    end if;
    v_total := v_total + v_q;
    v_articles := v_articles || (v_produit.designation || ' × ' || v_q);
    if not v_prog.sigle = any (v_sigles) then
      v_sigles := v_sigles || v_prog.sigle;
    end if;
  end loop;
  perform journal_texte('remise_asc', 'ASC ' || v_ag.nom || coalesce(' (' || v_ag.localite || ')', '') || ' · '
    || array_to_string(v_sigles, ', ') || ' · ' || left(array_to_string(v_articles, ', '), 400),
    jsonb_build_object('asc', v_ag.id, 'unites', v_total));
  return jsonb_build_object('unites', v_total, 'lignes', cardinality(v_articles));
end;
$$;

-- ---------- Saisir le rapport du mois d'un ASC (ce qu'il a dispensé, perdu, ses jours de rupture, ses TDR) ----------
create or replace function public.saisir_asc(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ag agents_asc%rowtype;
  v_mois date := date_trunc('month', (p ->> 'mois')::date)::date;
  v_tr int := entier_saisi(p ->> 'tdr_realises', 'TDR réalisés');
  v_tp int := entier_saisi(p ->> 'tdr_positifs', 'TDR positifs');
  v_l record;
  v_si int;
  v_c int;
  v_d int;
  v_f int;
  v_lignes jsonb := '{}'::jsonb;
  v_x record;
begin
  perform exiger('programmes');
  select * into v_ag from agents_asc where id = nullif(p ->> 'asc_id', '')::int;
  if not found then
    raise exception 'ASC inconnu.';
  end if;
  if v_mois is null or v_mois > current_date then
    raise exception 'Mois invalide.';
  end if;
  if v_tp > v_tr then
    raise exception 'Les TDR positifs ne peuvent pas dépasser les TDR réalisés.';
  end if;
  for v_l in select key, value from jsonb_each(coalesce(p -> 'lignes', '{}'::jsonb)) loop
    if not exists (select 1 from fiches_lignes where 'l' || id = v_l.key and sur_asc) then
      raise exception 'Ligne inconnue de la fiche ASC.';
    end if;
    v_si := entier_saisi(v_l.value ->> 'si', 'Stock initial');
    v_c := entier_saisi(v_l.value ->> 'c', 'Quantité dispensée');
    v_d := entier_saisi(v_l.value ->> 'd', 'Pertes');
    v_f := entier_saisi(v_l.value ->> 'f', 'Jours de rupture');
    if v_f > 31 then
      raise exception 'Jours de rupture : 31 au plus.';
    end if;
    if v_si is not null or coalesce(v_c, 0) > 0 or coalesce(v_d, 0) > 0 or coalesce(v_f, 0) > 0 then
      v_lignes := v_lignes || jsonb_build_object(v_l.key, jsonb_strip_nulls(jsonb_build_object('si', v_si, 'c', nullif(v_c, 0), 'd', nullif(v_d, 0), 'f', nullif(v_f, 0))));
    end if;
  end loop;
  insert into asc_mois (asc_id, mois, tdr_realises, tdr_positifs, lignes, maj_par, maj_le)
  values (v_ag.id, v_mois, v_tr, v_tp, v_lignes, auth.uid(), now())
  on conflict (asc_id, mois) do update set
    tdr_realises = excluded.tdr_realises, tdr_positifs = excluded.tdr_positifs, lignes = excluded.lignes,
    maj_par = excluded.maj_par, maj_le = excluded.maj_le;
  -- Un ASC ne peut pas dispenser plus que ce qu'il avait
  select fl.designation, x.a + x.b as dispo, x.c + x.d as sorti into v_x
  from asc_calcul(v_mois, v_ag.id) x join fiches_lignes fl on fl.id = x.ligne_id
  where x.e < 0 order by fl.ordre limit 1;
  if found then
    raise exception 'Stock de l''ASC négatif pour % : il avait %, la saisie en fait sortir %. Vérifiez le stock initial et le dispensé.',
      v_x.designation, v_x.dispo, v_x.sorti;
  end if;
  perform journal_texte('saisie_asc', 'ASC ' || v_ag.nom || ' · ' || nom_mois(v_mois) || ' · '
    || (select count(*) from jsonb_object_keys(v_lignes)) || ' produit(s) saisi(s)'
    || case when v_tr is not null then ' · TDR ' || v_tr || coalesce(' (' || v_tp || ' positifs)', '') else '' end,
    jsonb_build_object('asc', v_ag.id, 'mois', v_mois));
end;
$$;

-- ---------- Base : relier une ligne de fiche à un produit, créer les produits qui manquent ----------
create or replace function public.lier_ligne_fiche(p_ligne int, p_produit int, p_programme int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ligne fiches_lignes%rowtype;
  v_produit text;
  v_origine text;
begin
  perform exiger('base');
  select * into v_ligne from fiches_lignes where id = p_ligne for update;
  if not found then
    raise exception 'Ligne de fiche inconnue.';
  end if;
  if p_produit is null then
    update fiches_lignes set produit_id = null, programme_id = null where id = p_ligne;
    perform journal_texte('fiche_ligne_liee', 'Fiche · « ' || v_ligne.designation || ' » : plus reliée à aucun produit', jsonb_build_object('ligne', p_ligne));
    return;
  end if;
  if not exists (select 1 from produits_programmes where produit_id = p_produit and programme_id = p_programme) then
    raise exception 'Ce produit n''est pas rattaché à cette origine.';
  end if;
  if exists (select 1 from fiches_lignes where produit_id = p_produit and programme_id = p_programme and id <> p_ligne) then
    raise exception 'Ce produit est déjà sur une autre ligne de la fiche.';
  end if;
  update fiches_lignes set produit_id = p_produit, programme_id = p_programme where id = p_ligne;
  select designation into v_produit from produits where id = p_produit;
  select sigle into v_origine from programmes where id = p_programme;
  perform journal_texte('fiche_ligne_liee', 'Fiche · « ' || v_ligne.designation || ' » → ' || v_produit || ' (' || v_origine || ')',
    jsonb_build_object('ligne', p_ligne, 'produit', p_produit));
end;
$$;

-- Crée dans le PNLP les produits des lignes encore sans produit (toutes, ou celles demandées)
create or replace function public.creer_produits_fiche(p_lignes int[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_pnlp int := programme_pnlp();
  v_ligne fiches_lignes%rowtype;
  v_produit int;
  v_nb int := 0;
begin
  perform exiger('base');
  if v_pnlp is null then
    raise exception 'Aucun programme PNLP : créez-le d''abord dans la Base.';
  end if;
  for v_ligne in
    select * from fiches_lignes where produit_id is null and (p_lignes is null or id = any (p_lignes)) order by ordre for update
  loop
    -- Un produit du même nom déjà au PNLP (et libre) est repris plutôt que doublé
    select p.id into v_produit from produits p join produits_programmes pp on pp.produit_id = p.id and pp.programme_id = v_pnlp
    where upper(p.designation) = upper(v_ligne.designation)
      and not exists (select 1 from fiches_lignes f where f.produit_id = p.id and f.programme_id = v_pnlp)
    order by p.actif desc, p.id limit 1;
    if v_produit is null then
      insert into produits (designation, presentation) values (v_ligne.designation, initcap(v_ligne.unite)) returning id into v_produit;
      insert into produits_programmes (produit_id, programme_id) values (v_produit, v_pnlp);
      v_nb := v_nb + 1;
    end if;
    update fiches_lignes set produit_id = v_produit, programme_id = v_pnlp where id = v_ligne.id;
    v_produit := null;
  end loop;
  return v_nb;
end;
$$;

-- ---------- Journal : le code d'un produit modifié est noté aussi ----------
create or replace function public.journal_base() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch text[] := '{}';
  v_produit text;
  v_origine text;
begin
  if tg_table_name = 'produits' then
    if tg_op = 'INSERT' then
      perform journal_texte('produit_cree', new.designation || ' · achat ' || fmt_f(new.prix_achat) || ' · vente ' || fmt_f(new.prix_vente), jsonb_build_object('produit', new.id));
      return null;
    end if;
    if new.designation is distinct from old.designation then ch := ch || ('nom « ' || old.designation || ' » → « ' || new.designation || ' »'); end if;
    if new.prix_achat is distinct from old.prix_achat then ch := ch || ('prix d''achat ' || fmt_f(old.prix_achat) || ' → ' || fmt_f(new.prix_achat)); end if;
    if new.stock_min is distinct from old.stock_min then ch := ch || ('minimum ' || old.stock_min || ' → ' || new.stock_min); end if;
    if new.code_barres is distinct from old.code_barres then ch := ch || ('code-barres ' || coalesce(new.code_barres, 'retiré')); end if;
    if new.code is distinct from old.code then ch := ch || ('code ' || coalesce(new.code, 'retiré')); end if;
    if new.presentation is distinct from old.presentation then ch := ch || ('présentation ' || coalesce(new.presentation, 'retirée')); end if;
    if new.actif is distinct from old.actif then ch := ch || case when new.actif then 'réactivé' else 'désactivé' end; end if;
    -- le prix de vente a déjà son propre journal (déclencheur produits_journal_prix)
    if cardinality(ch) > 0 then
      perform journal_texte('produit_modifie', new.designation || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('produit', new.id));
    end if;

  elsif tg_table_name = 'programmes' then
    if tg_op = 'INSERT' then
      perform journal_texte('programme_cree', new.nom || ' (' || new.sigle || ') · '
        || case when new.est_vente then 'produits recouvrables' when new.recouvrable then 'recouvrable (payant)' else 'gratuit' end, jsonb_build_object('programme', new.id));
      return null;
    end if;
    if new.nom is distinct from old.nom then ch := ch || ('nom « ' || old.nom || ' » → « ' || new.nom || ' »'); end if;
    if new.sigle is distinct from old.sigle then ch := ch || ('sigle ' || old.sigle || ' → ' || new.sigle); end if;
    if new.recouvrable is distinct from old.recouvrable then ch := ch || case when new.recouvrable then 'devient recouvrable (payant)' else 'devient gratuit' end; end if;
    if new.frequence is distinct from old.frequence then ch := ch || ('rapport ' || new.frequence); end if;
    if new.categories is distinct from old.categories then ch := ch || ('catégories : ' || array_to_string(new.categories, ', ')); end if;
    if new.destinataire is distinct from old.destinataire then ch := ch || ('envoyer à ' || coalesce(new.destinataire, '—')); end if;
    if new.actif is distinct from old.actif then ch := ch || case when new.actif then 'réactivé' else 'désactivé' end; end if;
    if cardinality(ch) > 0 then
      perform journal_texte('programme_modifie', new.nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('programme', new.id));
    end if;

  elsif tg_table_name = 'produits_programmes' then
    if tg_op = 'INSERT' then
      select designation into v_produit from produits where id = new.produit_id;
      select sigle into v_origine from programmes where id = new.programme_id;
      perform journal_texte('origine_ajoutee', coalesce(v_produit, '?') || ' : coché ' || coalesce(v_origine, '?'), jsonb_build_object('produit', new.produit_id));
    else
      select designation into v_produit from produits where id = old.produit_id;
      select sigle into v_origine from programmes where id = old.programme_id;
      if v_produit is not null and v_origine is not null then
        perform journal_texte('origine_retiree', v_produit || ' : décoché ' || v_origine, jsonb_build_object('produit', old.produit_id));
      end if;
    end if;

  elsif tg_table_name = 'clients' then
    if tg_op = 'INSERT' then
      perform journal_texte('client_cree', new.nom || coalesce(' · ' || nullif(new.telephone, ''), '') || ' · plafond ' || fmt_f(new.plafond), jsonb_build_object('client', new.id));
      return null;
    end if;
    if new.nom is distinct from old.nom then ch := ch || ('nom « ' || old.nom || ' » → « ' || new.nom || ' »'); end if;
    if new.telephone is distinct from old.telephone then ch := ch || ('téléphone ' || coalesce(new.telephone, 'retiré')); end if;
    if new.plafond is distinct from old.plafond then ch := ch || ('plafond ' || fmt_f(old.plafond) || ' → ' || fmt_f(new.plafond)); end if;
    if cardinality(ch) > 0 then
      perform journal_texte('client_modifie', new.nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('client', new.id));
    end if;
  end if;
  return null;
end;
$$;

-- ---------- Droits d'exécution ----------
revoke execute on function public.programme_pnlp() from public, anon, authenticated;
revoke execute on function public.nom_mois(date) from public, anon, authenticated;
revoke execute on function public.entier_saisi(text, text) from public, anon, authenticated;
revoke execute on function public.asc_calcul(date, int) from public, anon, authenticated;
revoke execute on function public.journal_base() from public, anon, authenticated;
revoke execute on function public.fiche_pnlp(text, date, int) from public, anon;
revoke execute on function public.enregistrer_fiche(jsonb) from public, anon;
revoke execute on function public.enregistrer_asc(jsonb) from public, anon;
revoke execute on function public.remettre_asc(jsonb) from public, anon;
revoke execute on function public.saisir_asc(jsonb) from public, anon;
revoke execute on function public.lier_ligne_fiche(int, int, int) from public, anon;
revoke execute on function public.creer_produits_fiche(int[]) from public, anon;
grant execute on function public.fiche_pnlp(text, date, int) to authenticated;
grant execute on function public.enregistrer_fiche(jsonb) to authenticated;
grant execute on function public.enregistrer_asc(jsonb) to authenticated;
grant execute on function public.remettre_asc(jsonb) to authenticated;
grant execute on function public.saisir_asc(jsonb) to authenticated;
grant execute on function public.lier_ligne_fiche(int, int, int) to authenticated;
grant execute on function public.creer_produits_fiche(int[]) to authenticated;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 14}')
on conflict (cle) do update set valeur = excluded.valeur;
