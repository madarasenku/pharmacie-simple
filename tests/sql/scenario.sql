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
  perform pg_temp.refus(format($q$select valider_inventaire('{"comptes":[{"lot_id":%s,"reel":4,"attendu":7}]}')$q$, pg_temp.v('lot_tard')), 'a bougé pendant l''inventaire pour : ZZ TEST AMOXICILLINE (lot TARD). Vérifiez');
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
  assert (select (valeur ->> 'version')::int from parametres where cle = 'version_base') = 14, 'version de la base';
end $$;
select pg_temp.qui('awa');
do $$ declare n int; begin
  update produits set prix_vente = 1 where id = pg_temp.v('amox');
  get diagnostics n = row_count;
  assert n = 0, 'un vendeur sans droit « prix » ne change pas un prix';
end $$;

-- ---------- 10. Suppression de produits et de programmes ----------
select pg_temp.qui('awa');
do $$ begin
  perform pg_temp.refus('select supprimer_produits(array[1])', 'non autorisée (base)');
end $$;
select pg_temp.qui('gerant');
do $$ declare r jsonb; neuf int; vide int; g_neuf int; g_vide int; begin
  insert into produits (designation) values ('ZZ JAMAIS UTILISE') returning id into neuf;
  insert into produits (designation) values ('ZZ VIDE') returning id into vide;
  insert into produits_programmes (produit_id, programme_id) values (neuf, pg_temp.v('vente'));
  -- produit utilisé puis remis à zéro : historique, plus de stock
  perform enregistrer_entree(jsonb_build_object('produit_id', vide, 'programme_id', pg_temp.v('vente'), 'quantite', 2));
  perform valider_inventaire(jsonb_build_object('comptes', jsonb_build_array(jsonb_build_object('lot_id', (select id from lots where produit_id = vide), 'reel', 0))));
  r := supprimer_produits(array[neuf, vide, pg_temp.v('amox'), 999999]);
  assert r -> 'supprimes' = '["ZZ JAMAIS UTILISE"]' and r -> 'desactives' = '["ZZ VIDE"]' and r -> 'refuses' = '["ZZ TEST AMOXICILLINE"]', 'produits : ' || r::text;
  assert not exists (select 1 from produits where id = neuf), 'produit jamais utilisé : effacé';
  assert not exists (select 1 from produits_programmes where produit_id = neuf), 'ses rattachements aussi';
  assert (select not actif from produits where id = vide), 'produit avec historique : désactivé, pas effacé';
  assert (select count(*) from mouvements where produit_id = vide) = 2, 'son historique reste intact';
  assert (select actif from produits where id = pg_temp.v('amox')), 'produit encore en stock : intact';

  insert into programmes (code, nom, sigle) values ('ZZ1', 'ZZ Programme neuf', 'ZZN') returning id into g_neuf;
  insert into programmes (code, nom, sigle) values ('ZZ2', 'ZZ Programme vide', 'ZZV') returning id into g_vide;
  insert into produits_programmes (produit_id, programme_id) values (pg_temp.v('amox'), g_neuf), (pg_temp.v('amox'), g_vide);
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', g_vide, 'quantite', 1, 'numero_lot', 'ZZV'));
  perform valider_inventaire(jsonb_build_object('comptes', jsonb_build_array(jsonb_build_object('lot_id', (select id from lots where numero = 'ZZV'), 'reel', 0))));
  r := supprimer_programmes(array[g_neuf, g_vide, pg_temp.v('pnlp'), pg_temp.v('vente')]);
  assert r -> 'supprimes' = '["ZZ Programme neuf"]' and r -> 'desactives' = '["ZZ Programme vide"]'
     and (r -> 'refuses') @> '["Paludisme"]' and jsonb_array_length(r -> 'refuses') = 2, 'programmes : ' || r::text;
  assert not exists (select 1 from programmes where id = g_neuf), 'programme jamais utilisé : effacé';
  assert exists (select 1 from produits where id = pg_temp.v('amox')), 'ses produits ne sont pas touchés';
  assert (select not actif from programmes where id = g_vide), 'programme avec historique : désactivé';
  assert (select actif from programmes where est_vente), 'Vente jamais supprimée';
  assert (select count(*) from journal where action in ('produits_supprimes', 'programmes_supprimes')) = 2, 'suppressions au journal';
end $$;

-- ---------- 11. Programme recouvrable PHPSP : vendu, avec son propre prix et son propre point ----------
do $$ declare g int := (select id from programmes where code = 'PHPSP'); r jsonb; c jsonb; begin
  assert (select recouvrable and not est_vente and actif from programmes where id = g), 'PHPSP créé, recouvrable';
  insert into t values ('phpsp', g);
  insert into produits_programmes (produit_id, programme_id, prix_vente) values (pg_temp.v('amox'), g, 80);
  -- entrée PHPSP avec un nouveau prix : il change le prix PHPSP, pas le prix de la Vente
  perform enregistrer_entree(jsonb_build_object('produit_id', pg_temp.v('amox'), 'programme_id', g, 'quantite', 5, 'numero_lot', 'PH1',
    'peremption', (current_date + 300)::text, 'prix_achat', 40, 'prix_vente', 90));
  assert (select prix_vente from produits_programmes where produit_id = pg_temp.v('amox') and programme_id = g) = 90, 'prix PHPSP mis à jour';
  perform pg_temp.refus(format('update produits_programmes set programme_id = %s where produit_id = %s and programme_id = %s', pg_temp.v('pnlp'), pg_temp.v('amox'), g), 'permission denied');
  update produits_programmes set prix_vente = 90 where produit_id = pg_temp.v('amox') and programme_id = g;
  assert (select prix_vente from produits where id = pg_temp.v('amox')) = 130, 'prix de la Vente inchangé';
  assert (select details ->> 'origine' from journal where action = 'prix' order by id desc limit 1) = 'PHPSP', 'changement de prix PHPSP journalisé';
  -- vente PHPSP : payante, caisse obligatoire
  perform pg_temp.refus(format($q$select enregistrer_vente(jsonb_build_object('programme_id', %s, 'mode', 'especes', 'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 1))))$q$, g), 'Ouvrez la caisse');
  perform ouvrir_caisse(0);
  r := enregistrer_vente(jsonb_build_object('programme_id', g, 'mode', 'especes', 'montant_recu', 200,
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 2))));
  assert (r ->> 'total')::numeric = 180 and r ->> 'numero' like 'PHPSP-%', 'vente PHPSP au prix PHPSP : ' || r::text;
  assert (select mode_paiement from ventes where id = (r ->> 'id')::bigint) = 'especes', 'payée, pas gratuite';
  assert (select bool_and(type = 'vente') from mouvements where vente_id = (r ->> 'id')::bigint), 'mouvement de vente';
  assert (select quantite from lots where numero = 'PH1') = 3, 'stock PHPSP diminué';
  -- une vente Vente du même produit garde le prix normal
  r := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'momo',
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('amox'), 'quantite', 1))));
  assert (r ->> 'total')::numeric = 130, 'prix normal pour la Vente';
  c := resume_caisse((select id from caisses where fermee_le is null));
  assert (c ->> 'especes')::numeric = 180 and (c -> 'recouvrables' -> 0 ->> 'sigle') = 'PHPSP' and (c -> 'recouvrables' -> 0 ->> 'especes')::numeric = 180,
    'caisse : argent PHPSP montré à part : ' || c::text;
  perform fermer_caisse(180);
  -- l'équation du rapport tient aussi pour PHPSP
  assert (select bool_and(stock_initial + recu - dispense - perimes = stock_disponible) from rapport_mensuel(g, current_date)), 'rapport PHPSP juste';
end $$;

-- ---------- 12. Noms des agents en majuscules ----------
do $$ begin
  assert (select bool_and(nom = upper(nom)) from profiles), 'noms existants en majuscules';
end $$;
reset role;
insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('yao@pharmacie.local', '{"nom":"yao koffi","identifiant":"yao"}', '{"cree_par_gerant":true,"role":"vendeur"}');
update profiles set nom = 'awa traoré' where identifiant = 'awa';
set role authenticated;
do $$ begin
  assert (select nom from profiles where identifiant = 'yao') = 'YAO KOFFI', 'nouveau compte en majuscules';
  assert (select nom from profiles where identifiant = 'awa') = upper('awa traoré'), 'nom modifié remis en majuscules';
end $$;

-- ---------- 13. Journal des erreurs et anomalies (gérant) ----------
select pg_temp.qui('awa');
do $$ begin
  perform signaler_erreur('{"page":"comptoir","message":"Stock insuffisant pour X","version":"1.5.0","details":{"code":"P0001"}}');
  assert (select count(*) from erreurs) = 0, 'un vendeur ne lit pas le journal des erreurs';
  perform pg_temp.refus('select * from anomalies()', 'non autorisée');
  perform pg_temp.refus('select marquer_erreurs_vues(null)', 'non autorisée');
end $$;
select pg_temp.qui('gerant');
do $$ declare sp int; v jsonb; begin
  -- erreur signalée par Awa, visible par le gérant, avec qui / quand / page
  assert (select count(*) from erreurs where page = 'comptoir' and message like 'Stock insuffisant%'
          and user_id = (select val::uuid from t where cle = 'u_awa') and not vu) = 1, 'erreur signalée et lisible par le gérant';
  assert marquer_erreurs_vues(null) = 1, 'une erreur marquée vue';
  assert (select bool_and(vu) from erreurs), 'toutes les erreurs sont vues';
  -- produit à vendre sans prix : l'anomalie donne son NOM
  insert into produits (designation, prix_vente) values ('ZZ SANS PRIX', 0) returning id into sp;
  insert into produits_programmes (produit_id, programme_id) values (sp, pg_temp.v('vente'));
  assert exists (select 1 from anomalies() where code = 'prix_manquant' and detail = 'ZZ SANS PRIX — REC' and page = 'base'), 'produit sans prix nommé';
  -- vendu à 0 F
  perform ouvrir_caisse(0);
  perform enregistrer_entree(jsonb_build_object('produit_id', sp, 'programme_id', pg_temp.v('vente'), 'quantite', 2));
  v := enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'especes',
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', sp, 'quantite', 1))));
  assert exists (select 1 from anomalies() where code = 'vente_zero' and detail like 'ZZ SANS PRIX — vente ' || (v ->> 'numero') || '%'), 'vente à 0 F signalée avec le produit et le numéro';
  perform fermer_caisse(0);
end $$;
reset role;
insert into lots (produit_id, programme_id, numero, peremption, quantite) values (pg_temp.v('amox'), pg_temp.v('vente'), 'PERIME-X', current_date - 3, 2);
update caisses set ecart = -500 where id = (select max(id) from caisses);
set role authenticated;
do $$ begin
  assert exists (select 1 from anomalies() where code = 'perime_en_stock' and detail like 'ZZ TEST AMOXICILLINE — 2 unité(s), lot PERIME-X%'), 'lot périmé en stock signalé';
  assert exists (select 1 from anomalies() where code = 'ecart_caisse' and detail like '%il manquait 500 F%'), 'écart de caisse signalé';
  assert exists (select 1 from anomalies() where code = 'sauvegarde'), 'sauvegarde à faire signalée';
  assert not exists (select 1 from anomalies() where code = 'prix_manquant' and detail like 'ZZ TEST ACT ENFANT%'), 'produit gratuit sans prix : pas une anomalie';
end $$;

-- ---------- 13b. Bénéfices et stock valorisé (gérant et responsable, pas le vendeur) ----------
select pg_temp.qui('gerant');
do $$ declare
  b int; lot int; v jsonb; avant jsonb; apres jsonb; ligne jsonb; sv jsonb;
  d numeric;
begin
  insert into produits (designation, prix_achat, prix_vente) values ('ZZ BENEF', 40, 100) returning id into b;
  insert into produits_programmes (produit_id, programme_id) values (b, pg_temp.v('vente'));
  -- prix propre au programme gratuit (valeur d'une unité du PNLP)
  insert into produits_programmes (produit_id, programme_id, prix_vente) values (b, pg_temp.v('pnlp'), 70);
  perform ouvrir_caisse(0);
  perform enregistrer_entree(jsonb_build_object('produit_id', b, 'programme_id', pg_temp.v('vente'), 'quantite', 10));
  perform enregistrer_entree(jsonb_build_object('produit_id', b, 'programme_id', pg_temp.v('pnlp'), 'quantite', 10));
  avant := benefices(current_date, current_date + 1);
  -- 3 vendus 100 F (achetés 40 F) = 300 F de ventes, 120 F de coût
  perform enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'especes',
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'quantite', 3))));
  -- 4 donnés par le PNLP : ni vente ni bénéfice
  perform enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('pnlp'), 'mode', 'gratuit',
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'quantite', 4))));
  -- 2 unités de la Vente cassées : perte de 2 × 40 F
  select id into lot from lots where produit_id = b and programme_id = pg_temp.v('vente');
  perform corriger_stock(lot, 5, 'Casse / perte');
  apres := benefices(current_date, current_date + 1);

  d := (select coalesce(sum((x ->> 'ca')::numeric), 0) from jsonb_array_elements(apres -> 'jours') x)
     - (select coalesce(sum((x ->> 'ca')::numeric), 0) from jsonb_array_elements(avant -> 'jours') x);
  assert d = 300, 'ventes du jour : +300 F, obtenu ' || d;
  d := (select coalesce(sum((x ->> 'cout')::numeric), 0) from jsonb_array_elements(apres -> 'jours') x)
     - (select coalesce(sum((x ->> 'cout')::numeric), 0) from jsonb_array_elements(avant -> 'jours') x);
  assert d = 120, 'coût d''achat du jour : +120 F, obtenu ' || d;
  d := (select coalesce(sum((x ->> 'valeur')::numeric), 0) from jsonb_array_elements(apres -> 'pertes') x)
     - (select coalesce(sum((x ->> 'valeur')::numeric), 0) from jsonb_array_elements(avant -> 'pertes') x);
  assert d = 80, 'pertes : +80 F (2 unités cassées à 40 F), obtenu ' || d;
  ligne := jsonb_path_query_first(apres, '$.produits[*] ? (@.designation == "ZZ BENEF")');
  assert (ligne ->> 'quantite')::int = 3 and (ligne ->> 'ca')::numeric = 300 and (ligne ->> 'cout')::numeric = 120,
    'classement des produits : ZZ BENEF 3 vendus, 300 F, coût 120 F : ' || ligne::text;
  assert (ligne ->> 'sans_achat')::boolean is false, 'prix d''achat connu';
  assert (select coalesce(sum((x ->> 'ca')::numeric), 0) from jsonb_array_elements(apres -> 'jours') x)
       = (select coalesce(sum((x ->> 'ca')::numeric), 0) from jsonb_array_elements(apres -> 'produits') x), 'jours et produits donnent le même total';
  assert not exists (select 1 from jsonb_array_elements(apres -> 'produits') x where x ->> 'designation' = 'ZZ BENEF' and (x ->> 'quantite')::int = 7),
    'la distribution gratuite ne compte pas dans les bénéfices';

  -- Stock valorisé : Vente (prix 100) et PNLP (prix propre 70)
  sv := stock_valeurs(current_date, current_date + 1);
  ligne := jsonb_path_query_first(sv, ('$[*] ? (@.produit_id == ' || b || ' && @.programme_id == ' || pg_temp.v('vente') || ')')::jsonpath);
  assert (ligne ->> 'prix')::numeric = 100 and (ligne ->> 'debut')::int = 0 and (ligne ->> 'entrees')::int = 10 and (ligne ->> 'sorties')::int = 3
     and (ligne ->> 'pertes')::int = 2 and (ligne ->> 'fin')::int = 5, 'Vente : début 0, entrées 10, sorties 3, pertes 2, reste 5 : ' || ligne::text;
  ligne := jsonb_path_query_first(sv, ('$[*] ? (@.produit_id == ' || b || ' && @.programme_id == ' || pg_temp.v('pnlp') || ')')::jsonpath);
  assert (ligne ->> 'prix')::numeric = 70 and (ligne ->> 'entrees')::int = 10 and (ligne ->> 'sorties')::int = 4 and (ligne ->> 'fin')::int = 6,
    'PNLP : prix propre 70 F, entrées 10, sorties 4, reste 6 : ' || ligne::text;
  -- Un mois passé : rien n'est encore arrivé, le stock de départ et le reste sont à zéro
  sv := stock_valeurs(current_date - 40, current_date - 10);
  ligne := jsonb_path_query_first(sv, ('$[*] ? (@.produit_id == ' || b || ' && @.programme_id == ' || pg_temp.v('vente') || ')')::jsonpath);
  assert (ligne ->> 'fin')::int = 0 and (ligne ->> 'entrees')::int = 0, 'avant les mouvements, le stock reste à zéro : ' || ligne::text;
  -- Équation : début + entrées − sorties − pertes = reste, pour toutes les lignes
  assert not exists (select 1 from jsonb_array_elements(stock_valeurs(current_date, current_date + 1)) x
    where (x ->> 'debut')::int + (x ->> 'entrees')::int - (x ->> 'sorties')::int - (x ->> 'pertes')::int <> (x ->> 'fin')::int), 'équation du stock';
  perform pg_temp.refus('select benefices(current_date + 1, current_date)', 'Période invalide');
  -- Par programme : la Vente donne la même chose qu'avant ; un programme gratuit n'a jamais de bénéfice
  assert benefices(current_date, current_date + 1, pg_temp.v('vente')) = benefices(current_date, current_date + 1), 'benefices(…, Vente) = ancienne forme';
  assert jsonb_array_length(benefices(current_date, current_date + 1, pg_temp.v('pnlp')) -> 'jours') = 0, 'PNLP (gratuit) : aucun bénéfice';
  perform pg_temp.refus('select benefices(current_date, current_date + 1, -1)', 'Programme inconnu');
  perform fermer_caisse(0);
end $$;
select pg_temp.qui('kone');
do $$ begin
  assert jsonb_typeof(benefices(current_date, current_date + 1)) = 'object', 'le responsable voit les bénéfices';
  assert jsonb_typeof(benefices(current_date, current_date + 1, pg_temp.v('vente'))) = 'object', 'le responsable voit les bénéfices par programme';
  assert jsonb_typeof(stock_valeurs(current_date, current_date + 1)) = 'array', 'le responsable voit le stock valorisé';
end $$;
select pg_temp.qui('awa');
do $$ begin
  perform pg_temp.refus('select benefices(current_date, current_date + 1)', 'non autorisée');
  perform pg_temp.refus('select stock_valeurs(current_date, current_date + 1)', 'non autorisée');
  perform pg_temp.refus('select benefices(current_date, current_date + 1, 1)', 'non autorisée');
end $$;

-- ---------- 13c. Revue pharmacien : lot périmé refusé à l'entrée, commande sur le stock utilisable ----------
select pg_temp.qui('gerant');
do $$ declare b int; begin
  insert into produits (designation, prix_achat, prix_vente) values ('ZZ RAPPORT', 10, 20) returning id into b;
  insert into produits_programmes (produit_id, programme_id) values (b, pg_temp.v('vente'));
  insert into t values ('rapport', b::text);
  perform pg_temp.refus(format('select enregistrer_entree(%L::jsonb)', jsonb_build_object('produit_id', b, 'programme_id', pg_temp.v('vente'), 'quantite', 5, 'peremption', current_date - 1)), 'déjà périmé');
  perform enregistrer_entree(jsonb_build_object('produit_id', b, 'programme_id', pg_temp.v('vente'), 'quantite', 10, 'peremption', current_date + 400));
  perform ouvrir_caisse(0);
  -- 9 vendus ce mois : CMM = 3 ; il reste 1 utilisable
  perform enregistrer_vente(jsonb_build_object('programme_id', pg_temp.v('vente'), 'mode', 'especes',
    'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'quantite', 9))));
  perform fermer_caisse(0);
end $$;
reset role;
-- 5 unités trouvées sur l'étagère dans un lot déjà périmé (entrées avant leur péremption)
insert into lots (produit_id, programme_id, numero, peremption, quantite) values (pg_temp.v('rapport'), pg_temp.v('vente'), 'VIEUX', current_date - 2, 5);
insert into mouvements (produit_id, programme_id, lot_id, type, quantite)
select pg_temp.v('rapport'), pg_temp.v('vente'), id, 'entree', 5 from lots where numero = 'VIEUX' and produit_id = pg_temp.v('rapport');
set role authenticated;
do $$ declare x record; begin
  select * into x from rapport_mensuel(pg_temp.v('vente'), current_date) where produit_id = pg_temp.v('rapport');
  assert x.stock_initial + x.recu - x.dispense - x.perimes = x.stock_disponible and x.stock_disponible = 6, 'formulaire inchangé : SD = 6 : ' || row_to_json(x)::text;
  assert x.cmm = 3, 'CMM du mois en cours : 9 / 3 = 3 : ' || row_to_json(x)::text;
  -- 2 × 3 − 1 utilisable = 5 (et non 2 × 3 − 6 = 0, qui laisserait le produit en rupture)
  assert x.quantite_calculee = 5, 'commande calculée sur le stock utilisable : ' || row_to_json(x)::text;
  -- Un mois passé : le calcul ne regarde pas les lots d'aujourd'hui
  select * into x from rapport_mensuel(pg_temp.v('vente'), (current_date - interval '1 month')::date) where produit_id = pg_temp.v('rapport');
  assert x.quantite_calculee = 0 and x.stock_disponible = 0, 'mois passé : rien : ' || row_to_json(x)::text;
end $$;

-- ---------- 13d. Vocabulaire du district : l'origine Vente s'appelle REC ----------
do $$ begin
  assert (select sigle = 'REC' and nom = 'Produits recouvrables' from programmes where est_vente), 'origine Vente renommée REC';
end $$;

-- ---------- 13e. Journal de toutes les actions, avec une phrase lisible ----------
select pg_temp.qui('gerant');
do $$ declare n int; b int := (select id from produits where designation = 'ZZ BENEF'); begin
  assert exists (select 1 from journal where action = 'vente' and details ->> 'texte' like '% · REC · ZZ BENEF × 3 · 300 F en espèces'), 'vente notée avec numéro, articles, montant et paiement';
  assert exists (select 1 from journal where action = 'distribution' and details ->> 'texte' like '% · PNLP · ZZ BENEF × 4'), 'distribution notée';
  assert exists (select 1 from journal where action = 'entree' and details ->> 'texte' = 'ZZ BENEF · REC · +10'), 'entrée de stock notée';
  assert exists (select 1 from journal where action = 'entree' and details ->> 'texte' like 'ZZ RAPPORT · REC · +10 · périme %'), 'entrée avec péremption';
  assert exists (select 1 from journal where action = 'produit_cree' and details ->> 'texte' = 'ZZ BENEF · achat 40 F · vente 100 F'), 'produit créé noté';
  assert exists (select 1 from journal where action = 'origine_ajoutee' and details ->> 'texte' = 'ZZ BENEF : coché PNLP'), 'origine cochée notée';
  assert exists (select 1 from journal where action = 'rapport_corrige' and details ->> 'texte' like 'ZZ TEST AMOXICILLINE · % · quantité commandée 50'), 'correction du rapport notée';
  assert (select user_id from journal where action = 'vente' and details ->> 'texte' like '% · ZZ BENEF × 3 %' limit 1) = (select id from profiles where identifiant = 'gerant'), 'la vente est au nom du vendeur';

  -- Base, clients, réglages, droits, comptes
  update produits set stock_min = 7 where id = b;
  assert exists (select 1 from journal where action = 'produit_modifie' and details ->> 'texte' = 'ZZ BENEF · minimum 0 → 7'), 'produit modifié noté avec l’avant et l’après';
  n := (select count(*) from journal where action = 'produit_modifie');
  update produits set prix_vente = 110 where id = b;
  assert (select count(*) from journal where action = 'produit_modifie') = n, 'un changement de prix seul n’est noté qu’une fois (journal des prix)';
  assert exists (select 1 from journal where action = 'prix' and details ->> 'produit' = 'ZZ BENEF'), 'prix noté par son propre journal';
  update produits set prix_vente = 100 where id = b;
  insert into clients (nom, telephone, plafond) values ('ZZ CLIENT', '0700', 5000);
  update clients set plafond = 8000 where nom = 'ZZ CLIENT';
  assert exists (select 1 from journal where action = 'client_cree' and details ->> 'texte' = 'ZZ CLIENT · 0700 · plafond 5 000 F'), 'client créé noté';
  assert exists (select 1 from journal where action = 'client_modifie' and details ->> 'texte' = 'ZZ CLIENT · plafond 5 000 F → 8 000 F'), 'client modifié noté';
  update parametres set valeur = valeur || '{"prix": true}' where cle = 'droits_vendeur';
  assert exists (select 1 from journal where action = 'droits_modifies' and details ->> 'texte' = 'Droits du rôle vendeur · changer les prix : autorisé'), 'droits notés';
  update parametres set valeur = valeur || '{"prix": false}' where cle = 'droits_vendeur';
  insert into parametres (cle, valeur) values ('derniere_sauvegarde', jsonb_build_object('date', now())) on conflict (cle) do update set valeur = excluded.valeur;
  assert exists (select 1 from journal where action = 'sauvegarde'), 'sauvegarde notée';
  update profiles set actif = false where identifiant = 'awa';
  update profiles set actif = true where identifiant = 'awa';
  assert exists (select 1 from journal where action = 'compte_modifie' and details ->> 'texte' like '% · compte désactivé'), 'compte désactivé noté';
  n := (select count(*) from journal where action = 'version_base' or details ->> 'texte' like '%version_base%');
  assert n = 0, 'la version de la base n’est pas une action';

  -- Connexion : notée une fois, même en cas de double clic
  perform journal_connexion('connexion');
  perform journal_connexion('connexion');
  assert (select count(*) from journal where action = 'connexion' and user_id = (select id from profiles where identifiant = 'gerant')) = 1, 'connexion notée une seule fois';
  perform pg_temp.refus('select journal_connexion(''autre'')', 'Évènement inconnu');
  -- Le journal reste réservé au gérant ; personne ne peut y écrire directement
  perform pg_temp.refus('insert into journal (action) values (''faux'')', 'row-level security');
end $$;
select pg_temp.qui('awa');
do $$ begin
  assert (select count(*) from journal) = 0, 'un vendeur ne lit pas le journal';
  perform journal_connexion('connexion');
  perform pg_temp.refus('select journal_texte(''faux'', ''x'')', 'permission denied');
end $$;

-- ---------- 13f. Fiches PNLP du district (ESPC, IDE, ASC) et agents de santé communautaires ----------
select pg_temp.qui('gerant');
do $$ begin
  assert (select count(*) from fiches_lignes) = 30, '30 lignes sur les fiches';
  assert (select count(*) from fiches_lignes where sur_espc) = 30 and (select count(*) from fiches_lignes where sur_ide) = 24
     and (select count(*) from fiches_lignes where sur_asc) = 16, 'ESPC 30 lignes, IDE 24, ASC 16';
  -- Produits déjà au PNLP reliés à leur ligne d'après leur nom
  assert (select p.designation from fiches_lignes f join produits p on p.id = f.produit_id where f.cle = 'ASAQ25') = 'ACT nourrisson (2-11 mois)', 'AS/AQ 2-11 mois relié';
  assert (select p.designation from fiches_lignes f join produits p on p.id = f.produit_id where f.cle = 'ASAQ50') = 'ACT enfant (1-5 ans)', 'AS/AQ 1-5 ans relié';
  assert (select p.designation from fiches_lignes f join produits p on p.id = f.produit_id where f.cle = 'TDR') = 'TDR paludisme', 'TDR relié';
  assert (select p.designation from fiches_lignes f join produits p on p.id = f.produit_id where f.cle = 'SP500') = 'SP (TPI femme enceinte)', 'SP 500/25 relié';
  assert (select produit_id is null from fiches_lignes where cle = 'MILDAD'), 'ligne sans produit au départ';
end $$;
do $$ declare b int; a1 int; a2 int; begin
  insert into produits (designation, presentation) values ('ZZ MILDA', 'Moustiquaire') returning id into b;
  insert into produits_programmes (produit_id, programme_id) values (b, pg_temp.v('pnlp'));
  perform lier_ligne_fiche((select id from fiches_lignes where cle = 'MILDAD'), b, pg_temp.v('pnlp'));
  perform pg_temp.refus(format('select lier_ligne_fiche(%s, %s, %s)', (select id from fiches_lignes where cle = 'MILDAIG'), b, pg_temp.v('pnlp')), 'déjà sur une autre ligne');
  perform pg_temp.refus(format('select lier_ligne_fiche(%s, %s, %s)', (select id from fiches_lignes where cle = 'MILDAIG'), b, pg_temp.v('vente')), 'pas rattaché');
  a1 := enregistrer_asc('{"nom": "  aya kouassi ", "localite": "Ahouakro", "telephone": "0701"}');
  a2 := enregistrer_asc('{"nom": "Bamba Ali"}');
  assert (select nom from agents_asc where id = a1) = 'AYA KOUASSI', 'nom de l''ASC en majuscules';
  perform pg_temp.refus('select enregistrer_asc(''{"nom": " "}'')', 'obligatoire');
  insert into t values ('milda', b::text), ('asc1', a1::text), ('asc2', a2::text);
end $$;
-- Historique des deux mois passés (écrit directement, avec des dates passées)
reset role;
do $$ declare b int := pg_temp.v('milda'); g int := pg_temp.v('pnlp'); m0 timestamptz := date_trunc('month', now()); l int; begin
  insert into lots (produit_id, programme_id, numero, peremption, quantite) values (b, g, 'ZM1', current_date + 400, 15) returning id into l;
  insert into mouvements (produit_id, programme_id, lot_id, type, quantite, created_at, asc_id) values
    (b, g, l, 'entree', 60, m0 - interval '2 months' + interval '1 day', null),
    (b, g, l, 'distribution', -10, m0 - interval '2 months' + interval '5 days', null),
    (b, g, l, 'distribution', -20, m0 - interval '1 month' + interval '3 days', null),
    (b, g, l, 'distribution', -15, m0 - interval '1 month' + interval '4 days', pg_temp.v('asc1'));
end $$;
set role authenticated;
select pg_temp.qui('gerant');
do $$ declare b int := pg_temp.v('milda'); g int := pg_temp.v('pnlp'); r jsonb; begin
  -- Ce mois : 10 reçus du district, 6 donnés aux patients, 9 remis à AYA, 2 périmés retirés
  perform enregistrer_entree(jsonb_build_object('produit_id', b, 'programme_id', g, 'quantite', 10, 'numero_lot', 'ZM1', 'peremption', (current_date + 400)::text));
  perform enregistrer_vente(jsonb_build_object('programme_id', g, 'categorie', 'Autre', 'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'quantite', 6))));
  r := remettre_asc(jsonb_build_object('asc_id', pg_temp.v('asc1'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'programme_id', g, 'quantite', 9))));
  assert (r ->> 'unites')::int = 9, 'remise à l''ASC : 9 unités';
  perform corriger_stock((select id from lots where produit_id = b and numero = 'ZM1'), 8, 'Périmés retirés');
  assert (select quantite from v_stock where produit_id = b and programme_id = g) = 8, 'stock du centre : 8';
  assert exists (select 1 from mouvements where produit_id = b and asc_id = pg_temp.v('asc1') and type = 'distribution' and quantite = -9 and reference = 'ASC AYA KOUASSI'), 'remise notée en sortie, au nom de l''ASC';
  assert exists (select 1 from journal where action = 'remise_asc' and details ->> 'texte' = 'ASC AYA KOUASSI (Ahouakro) · PNLP · ZZ MILDA × 9'), 'remise notée au journal';
  assert not exists (select 1 from ventes v join ventes_lignes vl on vl.vente_id = v.id where vl.produit_id = b and v.patient_nom is null and v.categorie is null), 'une remise n''est pas une vente';
  perform pg_temp.refus(format('select remettre_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', b, 'programme_id', g, 'quantite', 1000)))), 'Stock insuffisant');
  perform pg_temp.refus(format('select remettre_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'lignes', '[]'::jsonb)), 'Rien à remettre');
  assert (select quantite from v_stock where produit_id = b and programme_id = g) = 8, 'remise refusée : stock intact';
end $$;
-- Rapports des ASC : AYA le mois passé (10 dispensés) et ce mois ; BAMBA ce mois, avec son stock de départ
select pg_temp.qui('awa');
do $$ declare k text := 'l' || (select id from fiches_lignes where cle = 'MILDAD'); begin
  perform saisir_asc(jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', (current_date - interval '1 month')::date, 'lignes', jsonb_build_object(k, jsonb_build_object('c', 10))));
  perform saisir_asc(jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', current_date, 'tdr_realises', 12, 'tdr_positifs', 4,
    'lignes', jsonb_build_object(k, jsonb_build_object('c', '8', 'd', 1, 'f', 2))));
  perform saisir_asc(jsonb_build_object('asc_id', pg_temp.v('asc2'), 'mois', current_date, 'tdr_realises', 3, 'tdr_positifs', 0,
    'lignes', jsonb_build_object(k, jsonb_build_object('si', 20, 'c', 3))));
  -- AYA avait 5 + 9 = 14 : elle ne peut pas en avoir dispensé 50
  perform pg_temp.refus(format('select saisir_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', current_date, 'lignes', jsonb_build_object(k, jsonb_build_object('c', 50)))), 'Stock de l''ASC négatif');
  perform pg_temp.refus(format('select saisir_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', current_date, 'tdr_realises', 2, 'tdr_positifs', 5)), 'positifs');
  perform pg_temp.refus(format('select saisir_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', current_date, 'lignes', jsonb_build_object(k, jsonb_build_object('c', 'beaucoup')))), 'nombre entier');
  perform pg_temp.refus(format('select saisir_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc1'), 'mois', current_date + 40)), 'Mois invalide');
  -- Un agent de santé ne relie pas les lignes de la fiche (droit Base)
  perform pg_temp.refus(format('select lier_ligne_fiche(%s, null, null)', (select id from fiches_lignes where cle = 'MILDAD')), 'non autorisée (base)');
end $$;
do $$ declare x jsonb; l jsonb; k text := 'l' || (select id from fiches_lignes where cle = 'MILDAD'); begin
  -- ESPC : A 15 · B 10 · (ASC 9) · C 6 + 9 = 15 · D −2 · E 8 · M-1 20 + 15 = 35 · M-2 10 · CMM 20 · MSD 0,4 · K = 20 × 2 − 8 = 32
  x := fiche_pnlp('ESPC', current_date);
  select e into l from jsonb_array_elements(x -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'a', l ->> 'b', l ->> 'asc', l ->> 'c', l ->> 'd', l ->> 'e', l ->> 'm1', l ->> 'm2') = ('15', '10', '9', '15', '-2', '8', '35', '10'),
    'ESPC : colonnes A à H : ' || l::text;
  assert (l ->> 'cmm')::numeric = 20 and (l ->> 'msd')::numeric = 0.4 and l ->> 'niveau' = 'urgent' and (l ->> 'q')::int = 32 and (l ->> 'qcalc')::int = 32, 'ESPC : CMM, MSD, commande urgente, K : ' || l::text;
  assert (x ->> 'urgent')::boolean and (x -> 'niveaux' ->> 'max')::numeric = 2, 'ESPC : fiche urgente, niveau maximum 2';
  assert l ->> 'code' is null and l ->> 'unite' = 'MOUSTIQUAIRE' and l ->> 'produit' = 'ZZ MILDA', 'ESPC : unité de la fiche, produit de l''application';
  assert (select bool_and((e ->> 'a')::int + (e ->> 'b')::int - (e ->> 'c')::int + (e ->> 'd')::int = (e ->> 'e')::int) from jsonb_array_elements(x -> 'lignes') e), 'ESPC : E = A + B − C ± D sur toutes les lignes';
  assert jsonb_array_length(x -> 'lignes') = 30 + (select count(*) from produits p join produits_programmes pp on pp.produit_id = p.id and pp.programme_id = pg_temp.v('pnlp')
    where p.actif and not exists (select 1 from fiches_lignes f where f.produit_id = p.id and f.programme_id = pg_temp.v('pnlp'))), 'ESPC : 30 lignes + les autres produits du PNLP en bas';
  assert exists (select 1 from jsonb_array_elements(x -> 'lignes') e where e ->> 'designation' = 'ACT adulte' and e ->> 'k' like 'p%'), 'produit PNLP hors fiche ajouté en bas';
  assert (select count(*) from jsonb_array_elements(x -> 'lignes') e where e ->> 'produit_id' is null and e ->> 'q' is not null) = 0, 'ligne sans produit : pas de quantité';

  -- IDE : C = 9 remis aux ASC · D = 6 aux patients · F = 8 · J = (6 + 20 + 10) / 3 = 12 · K = 0,7 · L = Σ ASC = 4 + 0
  x := fiche_pnlp('IDE', current_date);
  select e into l from jsonb_array_elements(x -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'asc', l ->> 'c', l ->> 'd', l ->> 'e', l ->> 'm1', l ->> 'm2', l ->> 'cmm', l ->> 'msd', l ->> 'niveau', l ->> 'q') = ('9', '6', '-2', '8', '20', '10', '12.0', '0.7', 'bas', '4'),
    'IDE : colonnes et L = somme des ASC : ' || l::text;
  assert jsonb_array_length(x -> 'lignes') = 24 + (select count(*) from produits p join produits_programmes pp on pp.produit_id = p.id and pp.programme_id = pg_temp.v('pnlp')
    where p.actif and not exists (select 1 from fiches_lignes f where f.produit_id = p.id and f.programme_id = pg_temp.v('pnlp'))), 'IDE : 24 lignes + autres produits';
  assert (select e ->> 'q' from jsonb_array_elements(x -> 'lignes') e where e ->> 'designation' like 'GIEMSA%') is null, 'IDE : ligne absente de la fiche ASC, pas de quantité pour les ASC';

  -- ASC d'AYA : A 5 · B 9 · C 8 · D 1 · E 5 · F 2 · M-1 10 · CMM 6 · MSD 0,8 · K = 6 × 1,5 − 5 = 4
  x := fiche_pnlp('ASC', current_date, pg_temp.v('asc1'));
  select e into l from jsonb_array_elements(x -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'a', l ->> 'b', l ->> 'c', l ->> 'd', l ->> 'e', l ->> 'f', l ->> 'm1', l ->> 'm2', l ->> 'cmm', l ->> 'q') = ('5', '9', '8', '1', '5', '2', '10', '0', '6.0', '4'),
    'ASC d''AYA : ' || l::text;
  assert (x -> 'entete' ->> 'tdr_realises')::int = 12 and x -> 'asc' ->> 'nom' = 'AYA KOUASSI', 'ASC d''AYA : ses TDR';
  assert (x -> 'niveaux' ->> 'max')::numeric = 1.5 and jsonb_array_length(x -> 'lignes') = 16, 'fiche ASC : maximum 1,5 et 16 lignes';
  -- BAMBA repart de son stock saisi : 20 − 3 = 17
  select e into l from jsonb_array_elements(fiche_pnlp('ASC', current_date, pg_temp.v('asc2')) -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'a', l ->> 'e', l ->> 'si', l ->> 'q') = ('20', '17', '20', '0'), 'stock initial saisi : ' || l::text;
  -- Fiche ASC de tous les ASC : sommes ; TDR = somme des ASC ; K = 7 × 1,5 − 22 → 0
  x := fiche_pnlp('ASC', current_date);
  select e into l from jsonb_array_elements(x -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'a', l ->> 'b', l ->> 'c', l ->> 'd', l ->> 'e', l ->> 'f', l ->> 'cmm', l ->> 'q') = ('25', '9', '11', '1', '22', '2', '7.0', '0'), 'ASC consolidée : ' || l::text;
  assert (x ->> 'nombre_asc')::int = 2 and (x -> 'entete' ->> 'tdr_realises')::int = 15 and (x -> 'entete' ->> 'tdr_positifs')::int = 4, 'nombre d''ASC et TDR additionnés : ' || (x -> 'entete')::text;

  -- La quantité allouée se corrige à la main ; TDR et gouttes épaisses gardés pour le mois
  perform enregistrer_fiche(jsonb_build_object('fiche', 'ESPC', 'mois', current_date, 'tdr_realises', 30, 'tdr_positifs', 8, 'ge_realisees', '5', 'ge_positives', 1,
    'commentaire', 'Rupture de MILDA au village', 'lignes', jsonb_build_object(k, jsonb_build_object('q', 40, 'com', 'Campagne'))));
  x := fiche_pnlp('ESPC', current_date);
  select e into l from jsonb_array_elements(x -> 'lignes') e where e ->> 'k' = k;
  assert (l ->> 'q')::int = 40 and (l ->> 'qcalc')::int = 32 and (l ->> 'corrigee')::boolean and l ->> 'commentaire' = 'Campagne', 'quantité corrigée gardée : ' || l::text;
  assert (x -> 'entete' ->> 'tdr_realises', x -> 'entete' ->> 'ge_realisees', x -> 'entete' ->> 'commentaire', left(x -> 'entete' ->> 'maj_par', 3)) = ('30', '5', 'Rupture de MILDA au village', 'AWA'), 'en-tête gardé : ' || (x -> 'entete')::text;
  perform pg_temp.refus(format('select enregistrer_fiche(%L::jsonb)', jsonb_build_object('fiche', 'ESPC', 'mois', current_date, 'tdr_realises', 3, 'tdr_positifs', 4)), 'positifs');
  perform pg_temp.refus('select fiche_pnlp(''XYZ'', current_date)', 'Fiche inconnue');
end $$;
select pg_temp.qui('gerant');
do $$ declare n int; begin
  assert exists (select 1 from journal where action = 'saisie_asc' and details ->> 'texte' like 'ASC AYA KOUASSI · % ' || extract(year from current_date) || ' · 1 produit(s) saisi(s) · TDR 12 (4 positifs)'), 'saisie ASC notée';
  assert exists (select 1 from journal where action = 'fiche_pnlp' and details ->> 'texte' like 'Fiche ESPC · % ' || extract(year from current_date) || ' · 1 quantité(s) corrigée(s) · TDR 30 (8 positifs) · GE 5 (1 positives)'), 'fiche notée';
  assert exists (select 1 from journal where action = 'asc_cree' and details ->> 'texte' = 'ASC AYA KOUASSI · Ahouakro · 0701'), 'ASC créé noté';
  assert exists (select 1 from journal where action = 'fiche_ligne_liee' and details ->> 'texte' like 'Fiche · « MILDA Dual AI BALLE/50 » → ZZ MILDA (PNLP)'), 'ligne reliée notée';
  -- Code du district dans la Base, noté au journal
  update produits set code = '51200' where id = pg_temp.v('milda');
  assert exists (select 1 from journal where action = 'produit_modifie' and details ->> 'texte' = 'ZZ MILDA · code 51200'), 'code noté';
  assert (select e ->> 'code' from jsonb_array_elements(fiche_pnlp('ESPC', current_date) -> 'lignes') e where e ->> 'produit' = 'ZZ MILDA') = '51200', 'code affiché sur la fiche';
  -- Créer les produits qui manquent : seulement les lignes demandées, puis rien en double
  n := creer_produits_fiche(array[(select id from fiches_lignes where cle = 'GIEMSA')]);
  assert n = 1 and (select p.designation || '|' || p.presentation from fiches_lignes f join produits p on p.id = f.produit_id where f.cle = 'GIEMSA') = 'GIEMSA SOLUTION FL/500ML|Flacon', 'produit GIEMSA créé et relié';
  assert exists (select 1 from produits_programmes pp join fiches_lignes f on f.produit_id = pp.produit_id where f.cle = 'GIEMSA' and pp.programme_id = pg_temp.v('pnlp')), 'produit créé au PNLP';
  assert creer_produits_fiche(array[(select id from fiches_lignes where cle = 'GIEMSA')]) = 0, 'déjà relié : rien de créé';
  -- Désactiver un ASC : il sort des fiches consolidées et ne reçoit plus rien
  perform enregistrer_asc(jsonb_build_object('id', pg_temp.v('asc2'), 'nom', 'BAMBA ALI', 'actif', false));
  assert (fiche_pnlp('ASC', current_date) ->> 'nombre_asc')::int = 1, 'ASC désactivé : plus compté';
  perform pg_temp.refus(format('select remettre_asc(%L::jsonb)', jsonb_build_object('asc_id', pg_temp.v('asc2'), 'lignes', jsonb_build_array(jsonb_build_object('produit_id', pg_temp.v('milda'), 'programme_id', pg_temp.v('pnlp'), 'quantite', 1)))), 'ASC actif');
  assert exists (select 1 from journal where action = 'asc_modifie' and details ->> 'texte' = 'ASC BAMBA ALI · désactivé'), 'ASC désactivé noté';
  -- Personne n'écrit dans ces tables sans passer par les fonctions
  perform pg_temp.refus('insert into agents_asc (nom) values (''X'')', 'row-level security');
  perform pg_temp.refus('insert into fiches_mois (fiche, mois) values (''ESPC'', date_trunc(''month'', now()))', 'row-level security');
end $$;
select pg_temp.qui('intrus');
do $$ begin
  perform pg_temp.refus('select fiche_pnlp(''ESPC'', current_date)', 'non autorisée');
  assert (select count(*) from agents_asc) = 0, 'un compte inactif ne voit pas les ASC';
end $$;

-- ---------- 14. Mot de passe temporaire ----------
select pg_temp.qui('awa');
select mot_de_passe_personnel_defini();
do $$ begin
  assert (select not doit_changer_mdp from profiles where identifiant = 'awa'), 'mot de passe personnel enregistré';
end $$;

reset role;

-- ---------- 15. Hygiène de sécurité (comme les conseils Supabase) ----------
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
  assert not has_function_privilege('authenticated', 'public.exiger(text)', 'execute'), 'exiger : interne';
  assert not has_function_privilege('authenticated', 'public.journaliser(text, jsonb)', 'execute'), 'journaliser : interne (pas de faux journal)';
  assert has_function_privilege('authenticated', 'public.est_membre()', 'execute'), 'est_membre : nécessaire aux règles RLS';
end $$;

\echo 'Scénario base de données : OK'
