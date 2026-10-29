# Pharmacie Simple — dossier de passation (contexte pour une IA ou un développeur)

> À lire EN ENTIER avant de modifier le code. Il complète le README (qui s'adresse à l'utilisatrice).
> Version applicative : **1.4.0** · cache du service worker : **pharmacie-simple-v5** · base attendue : **7**

## 1. Vue d'ensemble

- Pharmacie d'un centre de santé (district sanitaire de Grand-Bassam, région Sud-Comoé, Côte d'Ivoire). Interface **en français**,
  pensée pour des personnes peu habituées à l'informatique : gros boutons, messages clairs, jamais de jargon.
- **Site statique** (GitHub Pages, dépôt `madarasenku/pharmacie-simple`, branche `main`), **sans étape de compilation** :
  modules ES natifs (`<script type="module">`), routage par `#/page`.
- **Supabase** (projet `albdclznvthbaxewzdiu`) : PostgreSQL + Supabase Auth + une fonction Edge (`utilisateurs`).
- Même philosophie que l'application sœur **labosaisie** (laboratoire) : bibliothèques servies par le site, PWA
  « réseau d'abord », tests Playwright dans `tests/`, contrôles qui échouent bruyamment plutôt qu'en silence.

## 2. Fichiers

| Chemin | Rôle |
|---|---|
| `index.html` | Coquille : CSP, `noindex`, chargement de `vendor/supabase-2.39.7.umd.js` puis `js/app.js` (avec `?v=`). |
| `js/app.js` | Connexion, mot de passe imposé, cadre (menu, bandeaux), navigation, mode hors ligne, synchronisation, service worker. Pose `#contenu[data-pret="<page>"]` quand une page est affichée (utilisé par les tests). |
| `js/util.js` | Outils partagés : formatage, `q`/`rpc`/`tout`/`qMaj`, stockage local `ph_*`, catalogue, fenêtres, impression. |
| `js/hors-ligne.js` | File des ventes faites sans internet (`localStorage.ph_file_ventes`) et leur envoi. |
| `js/version.js` | `APP_VERSION` (site) et `VERSION_BASE` (dernière migration attendue). |
| `js/config.js` | URL et clé **publique** Supabase. |
| `js/pages/*.js` | Une page = un module exportant `render(el, ctx)`. |
| `sw.js` | Service worker (voir §6). |
| `supabase/migrations/00N_*.sql` | Schéma et fonctions, appliqués dans l'ordre. |
| `supabase/functions/utilisateurs/index.ts` | Création de compte et nouveau mot de passe (réservé au gérant actif). |
| `tests/` | Suite Playwright (`node tests/run.js`) et scénario SQL (`tests/sql/run.sh`). |

## 3. Sécurité (le plus important)

1. **Supabase Auth.** L'identifiant `awa` devient l'adresse `awa@pharmacie.local` (`versEmail` dans `app.js`).
   Le premier compte créé devient gérant ; les autres sont créés par la fonction Edge `utilisateurs` (clé service_role
   côté serveur uniquement) avec `app_metadata.cree_par_gerant = true` et le rôle. Toute inscription libre crée un
   profil **inactif** (déclencheur `creer_profil`).
2. **RLS sur toutes les tables.** Lecture : membres actifs (`est_membre()`). Écriture directe : seulement quelques
   tables de la Base (produits, programmes, liens, clients, parametres) selon les droits. **Toutes les écritures
   métier** (vente, entrée, correction, inventaire, caisse, crédit, commande) passent par des fonctions
   `SECURITY DEFINER` qui commencent par `exiger('<droit>')`.
3. **Droits** : `gerant` a tout ; `responsable` et `vendeur` lisent leurs droits dans `parametres.droits_<role>`
   (clés : vendre, entree, credit, programmes, corriger, annuler, prix, rapports, base). Côté site : `ctx.peut(droit)` ;
   `ctx.peut('gerant')` n'est vrai que pour le gérant. **L'écran n'est jamais la protection** : le serveur revérifie.
4. **Une écriture refusée par la RLS ne renvoie pas d'erreur, seulement zéro ligne.** Toute modification directe
   d'une table passe donc par `qMaj(requete.select(...))`, qui lève « Le serveur a refusé la modification » si rien
   n'a changé (leçon de labo).
5. **Pages de 1000 lignes au plus** (réglage Supabase) : toute lecture qui peut dépasser passe par `tout()`, avec un
   tri stable (`order(...).order('id')`).
6. Journal (`journal`, lecture gérant seul) : corrections, inventaires, annulations, prix (déclencheur
   `produits_journal_prix`), caisse, remboursements, commandes, comptes.
7. Mot de passe : 8 caractères, une lettre, un chiffre (`MDP_REGLE` / `mdpValide`, même règle dans la fonction Edge).
   Mot de passe donné par le gérant = provisoire (`profiles.doit_changer_mdp`), écran imposé à la connexion.
8. Caisse fermée : `annuler_vente` refuse à tout autre que le gérant. Verrous de ligne entre vente, fermeture de caisse
   et remboursement (`for share` / `for update`) pour qu'aucune vente ne « passe entre » le calcul de fermeture.

## 4. Modèle de données (résumé)

- `programmes` : origines du stock. **Vente** = celle qui a `est_vente = true`. Les programmes `recouvrable = true` (PHPSP) sont
  **payants** comme la Vente (caisse, modes de paiement, reçu) mais comptés à part ; les autres (PNLP, GRAT, PF…) sont gratuits.
  Côté site : `estPayant(g)` ; prix d'une ligne : `prixDe(p, origine)` = `produits_programmes.prix_vente` sinon `produits.prix_vente`
  (même règle côté serveur dans `enregistrer_vente`). Le point « normal » ne compte que la Vente.
- `profiles.nom` : toujours en majuscules (déclencheur `profiles_nom_majuscule`).
- `produits` ↔ `produits_programmes` (un produit peut être dans plusieurs origines) ; on ne peut pas détacher une
  origine qui a encore du stock (déclencheur `produits_programmes_detachement`).
- `lots` (produit, origine, numéro, péremption, quantité) : **le stock est la somme des lots**. Sortie FEFO : le lot
  non périmé qui périme en premier part d'abord (`enregistrer_vente`).
- `mouvements` : historique signé (`entree`, `vente`, `distribution`, `correction`, `perime`, `annulation`).
  **Toute variation de lot DOIT créer un mouvement**, sinon le rapport district devient faux.
- `ventes` / `ventes_lignes` (une ligne par lot touché), `caisses`, `clients`, `credits_paiements`, vue `v_dettes`.
- `commandes` / `commandes_lignes` (`quantite`, `recu`) : statut `envoyee` → `partielle` → `soldee` (ou `annulee`) ;
  `enregistrer_entree(commande_id)` impute le reçu ; `clore_commande` abandonne le reliquat.
- `rapports_corrections` : quantités commandées corrigées à la main (partagées entre postes).
- Vues `v_stock` (quantité utilisable, périmée, prochaine péremption, `nb_lots`) et `v_cmm` (conso moyenne 3 mois).
- `parametres` : `pharmacie`, `droits_responsable`, `droits_vendeur`, `derniere_sauvegarde`, `version_base`.

### Rapport mensuel (`rapport_mensuel`)
A (stock initial) + B (entrées + corrections positives) − C (ventes/distributions − annulations) − D (périmés +
corrections négatives) = SD, **toujours** (vérifié par `tests/sql/scenario.sql` pour chaque produit et chaque origine).
Quantité à commander = `max(0, ceil(2 × CMM − SD))`, remplaçable par `rapports_corrections`. Jours de rupture : seulement
pour un produit qui a déjà eu du stock.

### Inventaire (`valider_inventaire`)
Le site envoie, pour chaque lot compté, `reel` et `attendu` (quantité affichée sur la feuille). Si un lot a bougé
entre-temps (vente, entrée), **rien n'est écrit** et l'erreur cite les lignes : le site recharge, surligne, garde les
comptes, et la personne valide à nouveau. Lot déjà périmé qui baisse → mouvement `perime`. Produit trouvé sans lot →
mouvement `entree` « Stock de départ / inventaire ».

## 5. Ventes hors ligne

- Chaque vente porte un `ref_client` (uuid) fixé une fois. Le serveur (`ventes.ref_client unique`) renvoie la vente
  existante avec `deja: true` au lieu d'en créer une seconde, même en cas d'envoi simultané (exception `unique_violation`).
- Sans réseau : `mettreEnFile` (charge + résumé + utilisateur), ticket « PROVISOIRE », stock local diminué.
  `synchroniser()` rejoue la file **avec le compte de la personne qui a vendu** ; refus passager (caisse fermée, session)
  → attend ; autre refus (stock épuisé…) → état `erreur`, à régler dans **Ma journée** (Réessayer / Abandonner).
- Date d'une vente hors ligne : heure de l'appareil, bornée par le serveur entre maintenant − 3 jours et maintenant.
- Démarrage sans réseau : `ouvrirHorsLigne` avec le contexte copié (`ph_contexte`), menu réduit à Comptoir et Ma journée.

## 6. Service worker (`sw.js`)

Réseau d'abord, cache en secours ; requêtes Supabase et écritures jamais interceptées. Fichiers avec `?v=` : servis
seulement s'ils correspondent exactement (jamais un module d'une autre version). Le pré-cache contient **tous** les
modules (le test de déploiement le vérifie). Pas de rechargement automatique : bandeau « Recharger ».

**À chaque mise en ligne** : `APP_VERSION` dans `js/version.js` et `sw.js`, `CACHE` dans `sw.js`, `?v=` dans `index.html`.

## 7. Tests

- `node tests/run.js` : chaque `tests/*.test.js` dans son processus. `tests/helpers.js` sert le dépôt, lance Chromium,
  et intercepte `https://albdclznvthbaxewzdiu.supabase.co/**` avec un mini-PostgREST en mémoire (filtres `eq/in/is/gt…`,
  `order`, `offset/limit` plafonnés à 1000, objet unique, insert/update/delete, `merge-duplicates`) et une fausse
  authentification. `etat.reseauCoupe` simule une coupure ; `etat.refuserEcritures` simule un refus RLS (zéro ligne).
  **Les réponses RPC du faux serveur doivent avoir la même forme que le vrai** (objet jsonb, tableau pour une TABLE…).
- `bash tests/sql/run.sh` (PostgreSQL ≥ 15) : `tests/sql/supabase_local.sql` imite le minimum de Supabase (rôles, `auth.uid()`
  lu dans `request.jwt.claim.sub`, droits par défaut), puis migrations, puis `scenario.sql` (ASSERT à chaque étape).
- Les erreurs « métier » sont journalisées en `console.warn` ; seules les vraies erreurs de programmation vont en
  `console.error`, que les tests interdisent.

## 8. Pièges connus

- Ne jamais appeler Supabase directement dans `onAuthStateChange` (blocage) : différer avec `setTimeout(0)`.
- Les dates « jour seul » (`peremption`) sont des chaînes `AAAA-MM-JJ` : utiliser `fmtPeremption` / `joursAvant`,
  jamais `new Date('AAAA-MM-JJ')` comparé à `new Date()` (décalage de fuseau).
- `confirmer()` renvoie `false` si la fenêtre est fermée par la croix, Échap ou un clic à côté.
- Côte d'Ivoire = UTC+0 toute l'année : les bornes de jour du site et du serveur coïncident.
