-- Scénario métier complet, rejoué sur une base PostgreSQL locale (tests/sql/run.sh).
-- Chaque bloc échoue (ASSERT) si le comportement attendu n'est pas obtenu.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- Comptes : le premier devient gérant ; les suivants sont créés par le gérant
insert into auth.users (email, raw_user_meta_data) values ('gerant@pharmacie.local', '{"nom":"Gérante","identifiant":"gerant"}');
insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values
  ('awa@pharmacie.local', '{"nom":"Awa","identifiant":"awa"}', '{"cree_par_gerant":true,"role":"vendeur"}'),
  ('kone@pharmacie.local', '{"nom":"Koné","identifiant":"kone"}', '{"cree_par_gerant":true,"role":"responsable"}'),
  ('intrus@pharmacie.local', '{"nom":"Intrus"}', '{}');

do $$ begin
  assert (select role from profiles where identifiant = 'gerant') = 'gerant', 'le premier compte doit être gérant';
  assert (select actif and not doit_changer_mdp from profiles where identifiant = 'gerant'), 'gérant actif, sans changement imposé';
  assert (select role = 'vendeur' and actif and doit_changer_mdp from profiles where identifiant = 'awa'), 'vendeur créé par le gérant : actif, doit changer son mot de passe';
  assert (select role = 'responsable' and actif from profiles where identifiant = 'kone'), 'responsable créé par le gérant';
  assert (select not actif and role = 'vendeur' from profiles where email = 'intrus@pharmacie.local'), 'inscription libre : compte inactif';
end $$;

-- Produits de test (hors catalogue réel)
insert into produits (designation, prix_achat, prix_vente, stock_min) values ('ZZ TEST AMOXICILLINE', 60, 100, 5), ('ZZ TEST ACT ENFANT', 0, 0, 0), ('ZZ TEST JAMAIS', 10, 20, 2);
insert into produits_programmes (produit_id, programme_id)
select p.id, g.id from produits p, programmes g
where (p.designation = 'ZZ TEST AMOXICILLINE' and g.est_vente) or (p.designation = 'ZZ TEST ACT ENFANT' and g.code = 'PNLP')
   or (p.designation = 'ZZ TEST JAMAIS' and g.est_vente);

create temp table t (cle text primary key, val text);
grant all on t to authenticated;
insert into t select 'amox', id::text from produits where designation = 'ZZ TEST AMOXICILLINE';
insert into t select 'act', id::text from produits where designation = 'ZZ TEST ACT ENFANT';
insert into t select 'jamais', id::text from produits where designation = 'ZZ TEST JAMAIS';
insert into t select 'vente', id::text from programmes where est_vente;
insert into t select 'pnlp', id::text from programmes where code = 'PNLP';
create function pg_temp.v(k text) returns int language sql as $$ select val::int from t where cle = k $$;

insert into t select 'u_' || split_part(email, '@', 1), id::text from auth.users;
-- Se connecter en tant que… (le rôle « authenticated » reste, seul l'utilisateur change)
create function pg_temp.qui(nom text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select val from t where cle = 'u_' || nom), false) $$;
-- Attendre une erreur précise
create function pg_temp.refus(sql text, motif text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ATTENDU UN REFUS (%), mais « % » a réussi', motif, sql;
exception when others then
  if sqlerrm like 'ATTENDU UN REFUS%' then raise; end if;
  if sqlerrm not ilike '%' || motif || '%' then
    raise exception 'Refus inattendu pour « % » : % (attendu : %)', sql, sqlerrm, motif;
  end if;
end $$;

set role authenticated;

-- ---------- 1. Droits et RLS ----------
select pg_temp.qui('intrus');
do $$ begin
  assert (select count(*) from produits) = 0, 'un compte inactif ne voit aucun produit';
  perform pg_temp.refus('select ouvrir_caisse(0)', 'non autorisée');
end $$;

select pg_temp.qui('awa');
do $$ begin
  assert (select count(*) from produits) > 100, 'un vendeur voit le catalogue';
  assert (select count(*) from journal) = 0, 'le journal est réservé au gérant';
  perform pg_temp.refus($q$insert into parametres (cle, valeur) values ('x', '{}')$q$, 'row-level security');
  perform pg_temp.refus($q$select valider_inventaire('{"comptes":[]}')$q$, 'non autorisée (corriger)');
  perform pg_temp.refus($q$select enregistrer_commande('{"programme_id":1,"mois":"2026-01-01","lignes":[]}')$q$, 'non autorisée (rapports)');
end $$;
-- Aucune modification directe des tables métier : tout passe par les fonctions contrôlées
do $$ declare n int; begin
  update lots set quantite = 999;
  get diagnostics n = row_count;
  assert n = 0, 'un vendeur ne peut pas modifier un lot directement';
  perform pg_temp.refus($q$insert into ventes (programme_id, mode_paiement) values (1, 'especes')$q$, 'row-level security');
end $$;

-- ---------- 2. Entrées de stock (gérant) ----------
select pg_temp.qui('gerant');
do $$ declare l1 int; l2 int; begin
  -- deux lots : celui qui périme le plus tôt doit partir en premier (FEFO)
  l1 := enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 10,
    'numero_lot', 'TARD', 'peremption', (current_date + 400)::text, 'prix_achat', 60, 'fournisseur', 'DPCI'));
  l2 := enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 5,
    'numero_lot', 'TOT', 'peremption', (current_date + 30)::text, 'prix_achat', 60));
  -- même lot ressaisi : la quantité s'ajoute au lot existant
  assert enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 1,
    'numero_lot', 'TOT', 'peremption', (current_date + 30)::text)) = l2, 'un lot identique est complété, pas dupliqué';
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('act'), 'programme_id', pg_temp.v('pnlp'), 'quantite', 50, 'numero_lot', 'P1'));
  insert into t values ('lot_tard', l1), ('lot_tot', l2);
  assert (select quantite from v_stock where produit_id = pg_temp.v('amox') and programme_id = pg_temp.v('vente')) = 16, 'stock vente = 16';
  assert (select nb_lots from v_stock where produit_id = pg_temp.v('jamais')) = 0, 'produit jamais reçu : 0 lot';
  perform pg_temp.refus($q$select enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 0))$q$, 'Quantité invalide');
end $$;

-- ---------- 3. Caisse et ventes ----------
select pg_temp.qui('awa');
do $$ declare r jsonb; r2 jsonb; ref uuid := gen_random_uuid(); begin
  perform pg_temp.refus($q$select enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 1))))$q$, 'Ouvrez la caisse');
  perform ouvrir_caisse(1000);
  perform pg_temp.refus('select ouvrir_caisse(0)', 'déjà ouverte');

  r := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'especes', 'montant_recu', 1000, 'ref_client', ref,
    'patient', jsonb_build_object('nom', 'Test', 'age', 3, 'unite', 'ans', 'sexe', 'F'),
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 7))));
  assert (r ->> 'total')::numeric = 700, 'total = 7 × 100';
  assert (select patient_tranche from ventes where id = (r ->> 'id')::bigint) = '1 – 4 ans', 'tranche d''âge calculée';
  -- FEFO : le lot TOT (6) est vidé d'abord, puis 1 du lot TARD
  assert (select quantite from lots where id = pg_temp.v('lot_tot')) = 0, 'FEFO : lot qui périme en premier vidé';
  assert (select quantite from lots where id = pg_temp.v('lot_tard')) = 9, 'FEFO : reste pris sur le lot suivant';
  assert (select count(*) from ventes_lignes where vente_id = (r ->> 'id')::bigint) = 2, 'une ligne par lot';

  -- Rejouée (file hors ligne) : renvoyée sans être enregistrée deux fois
  r2 := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'especes', 'ref_client', ref,
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 7))));
  assert (r2 ->> 'deja')::boolean and r2 ->> 'id' = r ->> 'id', 'même ref_client : même vente';
  assert (select quantite from v_stock where produit_id = pg_temp.v('amox') and programme_id = pg_temp.v('vente')) = 9, 'stock non décompté deux fois';
  insert into t values ('vente1', r ->> 'id');

  -- Vente faite hors ligne il y a 10 jours : datée au plus 3 jours en arrière
  r := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'momo', 'ref_client', gen_random_uuid(),
    'hors_ligne', true, 'date_locale', (now() - interval '10 days')::text,
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 1))));
  assert (select saisie_hors_ligne and created_at between now() - interval '3 days 1 minute' and now() - interval '3 days' + interval '1 minute'
          from ventes where id = (r ->> 'id')::bigint), 'date hors ligne bornée à 3 jours';
  assert (select bool_and(created_at = (select created_at from ventes where id = (r ->> 'id')::bigint)) from mouvements where vente_id = (r ->> 'id')::bigint),
    'les mouvements portent la date de la vente';

  perform pg_temp.refus($q$select enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 50))))$q$, 'Stock insuffisant');
  perform pg_temp.refus($q$select enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('act'), 'quantite', 1))))$q$, 'n''est pas rattaché');
  perform pg_temp.refus($q$select enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'lignes', '[]'::jsonb))$q$, 'panier est vide');
  -- une vente refusée ne laisse rien derrière elle
  assert (select quantite from v_stock where produit_id = pg_temp.v('amox') and programme_id = pg_temp.v('vente')) = 8, 'stock intact après refus';

  -- Distribution gratuite d'un programme
  r := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('pnlp'), 'categorie', 'Enfant < 5 ans',
    'patient', jsonb_build_object('age', 8, 'unite', 'mois'),
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('act'), 'quantite', 3))));
  assert (r ->> 'total')::numeric = 0 and (r ->> 'numero') like 'PNLP-%', 'distribution gratuite numérotée par programme';
  assert (select mode_paiement from ventes where id = (r ->> 'id')::bigint) = 'gratuit', 'mode gratuit';
end $$;

-- ---------- 4. Crédit ----------
select pg_temp.qui('gerant');
insert into clients (nom, plafond) values ('ZZ Client', 500);
do $$ declare c int := (select id from clients where nom = 'ZZ Client'); begin
  perform enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'credit', 'client_id', c,
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 3))));
  assert (select du from v_dettes where client_id = c) = 300, 'dette = 300';
  perform pg_temp.refus(format($q$select enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'credit', 'client_id', %s,
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 3))))$q$, c), 'Plafond');
  perform pg_temp.refus(format('select rembourser_credit(%s, 400)', c), 'dépasse');
  perform rembourser_credit(c, 100);
  assert (select du from v_dettes where client_id = c) = 200, 'dette après remboursement = 200';
end $$;

-- ---------- 5. Fermeture de caisse et annulation verrouillée ----------
select pg_temp.qui('awa');
do $$ declare r jsonb; begin
  r := fermer_caisse(1800);
  -- fond 1000 + espèces 700 + remboursement 100 = 1800 (la vente Mobile Money et le crédit ne sont pas dans le tiroir)
  assert (r ->> 'attendu')::numeric = 1800 and (r ->> 'ecart')::numeric = 0, 'caisse juste : ' || r::text;
  perform pg_temp.refus(format('select annuler_vente(%s, %L)', pg_temp.v('vente1'), 'Erreur'), 'non autorisée (annuler)');
  perform pg_temp.refus(format('select rembourser_credit(%s, 10)', (select id from clients where nom = 'ZZ Client')), 'Ouvrez la caisse');
end $$;
-- Le responsable a le droit d'annuler… mais plus après la fermeture de la caisse
select pg_temp.qui('kone');
do $$ begin
  perform pg_temp.refus(format('select annuler_vente(%s, %L)', pg_temp.v('vente1'), 'Erreur'), 'seul le gérant');
end $$;
select pg_temp.qui('gerant');
do $$ begin
  perform annuler_vente(pg_temp.v('vente1'), 'Erreur de produit');
  assert (select annulee from ventes where id = pg_temp.v('vente1')), 'annulée par le gérant';
  assert (select quantite from lots where id = pg_temp.v('lot_tot')) = 6, 'stock remis dans le lot d''origine';
  assert (select details ->> 'caisse_fermee' from journal where action = 'annulation' order by id desc limit 1) = 'true', 'journal : caisse fermée';
  perform pg_temp.refus(format('select annuler_vente(%s, %L)', pg_temp.v('vente1'), 'x'), 'déjà annulée');
end $$;

-- ---------- 6. Inventaire ----------
do $$ declare r jsonb; begin
  -- lot TARD : 10 − 1 (vente FEFO) − 1 (hors ligne) − 3 (crédit) + 1 (annulation) = 6
  assert (select quantite from lots where id = pg_temp.v('lot_tard')) = 6, 'lot TARD = 6 avant inventaire';
  -- la feuille affichait 7 : une vente est passée entre-temps → refus, rien n'est écrit
  perform pg_temp.refus(format($q$select valider_inventaire('{"comptes":[{"lot_id":%s,"reel":4,"attendu":7}]}')$q$, pg_temp.v('lot_tard')), 'a bougé');
  assert (select quantite from lots where id = pg_temp.v('lot_tard')) = 6, 'refus : lot inchangé';
  r := valider_inventaire(jsonb_build_object('reference', 'Inventaire test',
    'comptes', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.v('lot_tard'), 'reel', 5, 'attendu', 6),
                                 jsonb_build_object('lot_id', pg_temp.v('lot_tot'), 'reel', 6, 'attendu', 6)),
    'nouveaux', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('jamais'), 'programme_id', pg_temp.v('vente'), 'quantite', 12, 'numero', 'DEP', 'peremption', (current_date + 200)::text),
                                  jsonb_build_object('produit_id', pg_temp.v('jamais'), 'programme_id', pg_temp.v('vente'), 'quantite', 0))));
  assert (r ->> 'corrections')::int = 1 and (r ->> 'lots_ajoutes')::int = 1, 'inventaire : ' || r::text;
  assert (select quantite from lots where id = pg_temp.v('lot_tard')) = 5, 'lot corrigé';
  assert (select type = 'correction' and quantite = -1 from mouvements where lot_id = pg_temp.v('lot_tard') order by id desc limit 1), 'écart = correction −1';
  assert (select fournisseur from mouvements where produit_id = pg_temp.v('jamais') and type = 'entree') = 'Stock de départ / inventaire', 'stock de départ = entrée';
  assert (select nb_lots from v_stock where produit_id = pg_temp.v('jamais')) = 1, 'le produit a maintenant un lot';
end $$;
-- Lot périmé retiré pendant l'inventaire : compté comme « périmé »
reset role;
insert into lots (produit_id, programme_id, numero, peremption, quantite) values (pg_temp.v('act'), pg_temp.v('pnlp'), 'VIEUX', current_date - 10, 4);
insert into mouvements (produit_id, programme_id, lot_id, type, quantite) select produit_id, programme_id, id, 'entree', 4 from lots where numero = 'VIEUX';
insert into t select 'lot_vieux', id from lots where numero = 'VIEUX';
set role authenticated;
do $$ begin
  assert (select quantite_perimee from v_stock where produit_id = pg_temp.v('act') and programme_id = pg_temp.v('pnlp')) = 4, 'stock périmé visible';
  perform valider_inventaire(jsonb_build_object('comptes', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.v('lot_vieux'), 'reel', 0, 'attendu', 4))));
  assert (select type from mouvements where lot_id = pg_temp.v('lot_vieux') order by id desc limit 1) = 'perime', 'lot périmé retiré = périmé';
end $$;

-- ---------- 7. Commandes au district ----------
do $$ declare r jsonb; c int; begin
  r := enregistrer_commande(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mois', to_char(current_date, 'YYYY-MM-01'),
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 20, 'prix_unitaire', 60),
                                jsonb_build_object('produit_id', pg_temp.v('jamais'), 'quantite', 0, 'prix_unitaire', 10))));
  c := (r ->> 'id')::int;
  assert (r ->> 'total')::numeric = 1200 and r ->> 'numero' like 'CMD-%', 'commande : ' || r::text;
  assert (select count(*) from commandes_lignes where commande_id = c) = 1, 'les lignes à 0 sont ignorées';
  -- un produit hors commande ne change pas son statut
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('jamais'), 'programme_id', pg_temp.v('vente'), 'quantite', 1, 'commande_id', c));
  assert (select statut from commandes where id = c) = 'envoyee', 'produit hors commande : statut inchangé';
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 8, 'commande_id', c, 'numero_lot', 'CMD'));
  assert (select statut from commandes where id = c) = 'partielle', 'reçu en partie';
  perform pg_temp.refus(format('select annuler_commande(%s)', c), 'déjà été reçus');
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 12, 'commande_id', c, 'numero_lot', 'CMD'));
  assert (select statut from commandes where id = c) = 'soldee', 'commande soldée';
  perform pg_temp.refus(format($q$select enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 1, 'commande_id', %s))$q$, c), 'pas ouverte');
  -- reliquat abandonné
  r := enregistrer_commande(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mois', to_char(current_date, 'YYYY-MM-01'),
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 10, 'prix_unitaire', 60))));
  c := (r ->> 'id')::int;
  perform pg_temp.refus(format('select clore_commande(%s)', c), 'reçue en partie');
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 4, 'commande_id', c));
  perform clore_commande(c);
  assert (select statut = 'soldee' and note like '%reliquat%' from commandes where id = c), 'commande close';
  -- annulation d'une commande non reçue
  r := enregistrer_commande(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mois', to_char(current_date, 'YYYY-MM-01'),
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 1))));
  perform annuler_commande((r ->> 'id')::int);
  assert (select statut from commandes where id = (r ->> 'id')::int) = 'annulee', 'commande annulée';
end $$;

-- ---------- 8. Rapport mensuel : A + B − C − D = SD, pour toutes les origines ----------
do $$ declare g record; x record; begin
  for g in select id from programmes loop
    for x in select * from rapport_mensuel(g.id, current_date) loop
      assert x.stock_initial + x.recu - x.dispense - x.perimes = x.stock_disponible,
        format('équation fausse pour %s : %s + %s - %s - %s <> %s', x.designation, x.stock_initial, x.recu, x.dispense, x.perimes, x.stock_disponible);
    end loop;
  end loop;
  select * into x from rapport_mensuel(pg_temp.v('vente'), current_date) where produit_id = pg_temp.v('amox');
  -- reçu 16 + 8 + 12 + 4 = 40 ; vendu 7 + 1 + 3 − 7 (annulation) = 4 ; pertes 1 (inventaire)
  assert x.recu = 40 and x.dispense = 4 and x.perimes = 1 and x.stock_disponible = 35, 'rapport amoxicilline : ' || row_to_json(x)::text;
  assert x.stock_disponible = (select sum(quantite) from lots where produit_id = pg_temp.v('amox') and programme_id = pg_temp.v('vente')), 'SD = somme des lots';
  select * into x from rapport_mensuel(pg_temp.v('vente'), current_date) where produit_id = pg_temp.v('jamais');
  assert x.jours_rupture = 0, 'pas de rupture comptée avant la première réception';
  -- quantité corrigée à la main, partagée entre les postes
  perform corriger_quantite_rapport(pg_temp.v('vente'), current_date, pg_temp.v('amox'), 50);
  select * into x from rapport_mensuel(pg_temp.v('vente'), current_date) where produit_id = pg_temp.v('amox');
  assert x.corrigee and x.quantite_commandee = 50 and x.montant = 50 * 60, 'quantité corrigée';
  perform corriger_quantite_rapport(pg_temp.v('vente'), current_date, pg_temp.v('amox'), null);
  select * into x from rapport_mensuel(pg_temp.v('vente'), current_date) where produit_id = pg_temp.v('amox');
  assert not x.corrigee and x.quantite_commandee = x.quantite_calculee, 'retour au calcul';
end $$;

-- ---------- 9. Garde-fous de la Base ----------
do $$ begin
  perform pg_temp.refus(format('delete from produits_programmes where produit_id = %s and programme_id = %s', pg_temp.v('amox'), pg_temp.v('vente')), 'encore du stock');
  update produits set prix_vente = 125 where id = pg_temp.v('amox');
  assert (select details ->> 'apres' from journal where action = 'prix' order by id desc limit 1) = '125.00', 'changement de prix journalisé';
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', pg_temp.v('vente'), 'quantite', 1, 'prix_vente', 130));
  assert (select count(*) from journal where action = 'prix') = 2, 'prix changé à l''entrée : une seule ligne de journal de plus';
  assert (select (valeur ->> 'version')::int from parametres where cle = 'version_base') = 5, 'version de la base';
end $$;
select pg_temp.qui('awa');
do $$ declare n int; begin
  update produits set prix_vente = 1 where id = pg_temp.v('amox');
  get diagnostics n = row_count;
  assert n = 0, 'un vendeur sans droit « prix » ne change pas un prix';
end $$;

-- ---------- 10. Mot de passe temporaire ----------
select pg_temp.qui('awa');
select mot_de_passe_personnel_defini();
do $$ begin
  assert (select not doit_changer_mdp from profiles where identifiant = 'awa'), 'mot de passe personnel enregistré';
end $$;

reset role;

-- ---------- 11. Hygiène de sécurité (comme les conseils Supabase) ----------
do $$ declare x text; begin
  select string_agg(tablename, ', ') into x from pg_tables where schemaname = 'public' and not rowsecurity;
  assert x is null, 'tables sans RLS : ' || x;
  select string_agg(p.proname, ', ') into x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  assert x is null, 'fonctions SECURITY DEFINER sans search_path : ' || x;
  select string_agg(p.proname, ', ') into x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  assert x is null, 'fonctions appelables sans connexion : ' || x;
  select string_agg(c.relname, ', ') into x from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> '{security_invoker=true}', false);
  assert x is null, 'vues sans security_invoker : ' || x;
end $$;

\echo 'Scénario base de données : OK'
