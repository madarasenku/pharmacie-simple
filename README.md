# Pharmacie Simple

Application web de gestion d'une pharmacie de centre de santé, pensée pour un petit nombre de personnes :
vente au comptoir, distributions gratuites des programmes, stock par lot, inventaire, caisse, crédits clients,
commandes au district et rapports (dont le formulaire « Rapports produits commandes recouvrables »).

- **Site** : HTML, CSS et JavaScript, sans installation ni compilation. Il s'installe comme une application
  (PWA) et **le comptoir continue de marcher sans internet**.
- **Base de données** : Supabase (PostgreSQL), avec règles de sécurité (RLS) sur toutes les tables ; toutes les
  écritures métier passent par des fonctions contrôlées côté serveur.
- **Tests automatiques** à chaque envoi sur GitHub (voir plus bas).

Adresse du site : https://madarasenku.github.io/pharmacie-simple/

## Les écrans

| Onglet | Rôle |
|---|---|
| Comptoir | Vendre (stock Vente, ou programme recouvrable comme PHPSP à son propre prix) ou distribuer gratuitement (stock d'un programme). Recherche par nom ou scan, lot qui périme en premier, patient facultatif (nom, âge, tranche d'âge, sexe), suggestion de la Gratuité, paiement espèces / Mobile Money / crédit, reçu ou ticket imprimable. **Sans internet**, la vente est gardée sur l'appareil et envoyée au retour du réseau. |
| Entrée de stock | Réception d'un achat ou d'une dotation : lot, péremption, prix. Une livraison peut être rattachée à une **commande au district** (le reste à recevoir se calcule tout seul). Alerte si la péremption est proche. |
| Mon stock | Stock par origine : boutons Tout / REC / PNLP / GRAT / PF… pour n'afficher qu'une origine (le choix est retenu). Alertes (rupture, bas, périmé, jamais en stock), lots, corrections, historique. Consommation mensuelle (CMM) et **MSD** (mois de stock disponible = stock ÷ CMM, en rouge sous 1 mois). Le gérant et le responsable voient en plus le **prix** et la **valeur** du stock ; les agents jamais. |
| Inventaire | Comptage des étagères, origine par origine : les écarts deviennent des corrections, les produits trouvés sans stock enregistré deviennent le **stock de départ**. Chaque produit montre son lot, sa péremption, sa **CMM** et son **MSD** (caché en comptage à l'aveugle). Brouillon gardé sur l'appareil, comptage à l'aveugle, feuille de comptage et procès-verbal imprimables. |
| Ma journée | Ventes du jour, annulation (avec motif), réimpression, ouverture et fermeture de caisse, **ventes faites hors ligne** (en attente ou refusées). |
| Crédits | Qui doit combien, historique, remboursements (encaissés dans la caisse ouverte), relance WhatsApp. |
| Programmes | Compte rendu mensuel de chaque programme et bénéficiaires par tranche d'âge et sexe. |
| Point général | **« Point PR.REC »** (produits recouvrables de la pharmacie) et **« Point PHPSP »** (un par programme recouvrable, argent à reverser), présentés de la même façon : chiffre d'affaires, **bénéfice estimé**, achats, répartition espèces / Mobile Money / crédit, pertes, bénéfice net ; bénéfice d'aujourd'hui, des 7 jours, du mois et de l'année ; jour par jour (ou mois par mois) ; par produit (prix, vendu, montant, bénéfice) ; stock au début, entrées, sorties, pertes, reste et leur valeur. Le Point PR.REC montre aussi ce que les programmes gratuits ont donné (unités et valeur). Les points ne se mélangent jamais. N'importe quel mois peut être choisi ; impression et export Excel. Réservé à ceux qui ont le droit « Rapports » (gérant, responsable). |
| Rapport district | Formulaire « commandes recouvrables » rempli automatiquement (2 × CMM − SD), quantités corrigeables (corrections partagées entre tous les postes), **enregistrement de la commande envoyée** et suivi de sa livraison. |
| Base | Programmes et produits : prix, minimum, code-barres, rattachement à un ou plusieurs programmes (cases juste après le nom ; l'en-tête et le nom restent visibles en faisant défiler), **prix propre à chaque programme** (« Prix PHPSP » pour un recouvrable, « Valeur PNLP » pour un programme gratuit : sert à valoriser son stock ; vide = prix de vente normal). Suppression d'un ou plusieurs éléments cochés : effacés s'ils n'ont jamais servi, masqués (inactifs) s'ils ont un historique, refusés s'il reste du stock. |
| Réglages | Infos de la pharmacie, droits par rôle, utilisateurs, sauvegarde complète et **journal de toutes les actions** : chaque vente, distribution, entrée, correction, inventaire, modification de la Base (produits, programmes, origines cochées, prix, clients), caisse, crédit, commande, réglage, droit, compte, sauvegarde, connexion et déconnexion, avec qui, quand et une phrase lisible. Filtres par sorte d'action, personne et jour ; export Excel. Rien ne s'efface. |
| Erreurs (gérant) | Journal des erreurs : ce qui est incohérent dans les données (produit à vendre sans prix, vente à 0 F, lot périmé encore en stock, écart de caisse, crédit au-delà du plafond, sauvegarde ancienne…) **avec le nom du produit** et un bouton « Corriger » qui ouvre la bonne page, puis les erreurs apparues à l'écran des agents (message, page, qui, quand), à marquer « vues ». Une pastille rouge sur l'onglet compte ce qui reste à faire. |

## Règles de pharmacie appliquées

- **Le lot qui périme en premier sort en premier** ; un lot périmé n'est **jamais** servi (le serveur l'écarte).
- Un lot **déjà périmé ne peut pas entrer** en stock ; une péremption à moins de 90 jours demande une confirmation.
- Un lot périmé encore en rayon est **toujours signalé en rouge** (« Périmé à retirer ») dans Mon stock, au Comptoir,
  dans le Journal des erreurs et dans le Rapport district, jusqu'à ce qu'il soit retiré (correction, motif « Périmé jeté »).
- Rapport district : quantité à commander = 2 × CMM − stock **utilisable** ; la CMM du mois en cours couvre les 3 derniers
  mois jusqu'à aujourd'hui. Les colonnes du formulaire officiel (A + B − C − D = SD) ne changent pas.

## Programmes recouvrables (PHPSP)

Un programme **recouvrable** (type choisi dans **Base → Modifier le programme**) fournit des médicaments qui sont **vendus**
et non donnés : il faut une caisse ouverte, on choisit espèces, Mobile Money ou crédit, et un reçu est imprimé. Chaque produit
peut avoir un **prix PHPSP** différent de son prix de vente normal (colonne « Prix PHPSP » de la Base ; vide = prix normal).
Son argent est dans le tiroir mais toujours montré **à part** (Ma journée, fermeture de caisse) et il a son **propre point**
dans le Point général et son compte rendu dans Programmes (avec le montant encaissé).

## Comptes et droits

- On se connecte avec un **identifiant** et un **mot de passe**. Pas d'inscription libre : **le gérant crée les comptes**
  dans **Réglages → Utilisateurs** et peut redonner un mot de passe.
- Le mot de passe donné par le gérant est **provisoire** : la personne choisit le sien à sa première connexion.
  Règle : au moins 8 caractères, avec au moins une lettre et un chiffre.
- Les noms des agents sont toujours enregistrés en MAJUSCULES.
- Le premier compte (créé avec une adresse e-mail) est le gérant ; il peut taper son adresse e-mail dans « Identifiant ».
- Trois rôles : **Gérant** (tous les droits, Réglages compris), **Responsable** (large par défaut) et **Vendeur**
  (limité par défaut). Les droits se cochent dans **Réglages → Droits par rôle**.
- Un compte désactivé est déconnecté dans la minute, même s'il est déjà ouvert.
- Une fois la caisse fermée, **seul le gérant** peut annuler une vente de cette caisse.

Les comptes créés par le gérant n'ont pas d'adresse e-mail réelle (`identifiant@pharmacie.local`). La création passe par
la fonction serveur `supabase/functions/utilisateurs`, qui vérifie que l'appel vient d'un gérant actif.

## Base de données

Les fichiers SQL sont dans `supabase/migrations/`, à appliquer dans l'ordre :

| Fichier | Contenu |
|---|---|
| `001_schema.sql` | Tables, RLS, vues de stock, fonctions métier (vente par lot qui périme en premier, entrée, correction, annulation, caisse, crédits, rapport). |
| `002_donnees_initiales.sql` | Programmes (Vente, PNLP, Gratuité, PF), droits par défaut, produits recouvrables des fiches du district. |
| `003_securite.sql` | Corrections de l'audit de sécurité Supabase. |
| `004_identifiants_et_responsable.sql` | Connexion par identifiant, rôle responsable, droits par rôle. |
| `005_inventaire_commandes_hors_ligne.sql` | Inventaire, commandes au district, ventes hors ligne sans doublon, verrou après fermeture de caisse, mot de passe provisoire, journal des prix, index de performance. |
| `006_suppression_produits_programmes.sql` | Suppression de produits et de programmes (un ou plusieurs) sans jamais effacer d'historique. |
| `007_programmes_recouvrables_phpsp.sql` | Programmes « recouvrables » (PHPSP) : vendus, avec un prix propre par origine et leur argent montré à part dans la caisse ; noms des agents en majuscules. |
| `008_journal_erreurs_anomalies.sql` | Journal des erreurs (`erreurs`, `signaler_erreur`, `marquer_erreurs_vues`) et contrôle des anomalies (`anomalies()`), réservés au gérant. |
| `009_benefices_stock_valeurs.sql` | Bénéfices par jour (`benefices`) et stock valorisé par programme (`stock_valeurs`), pour le gérant et le responsable (droit « rapports »). |
| `010_benefices_par_programme.sql` | Bénéfices d'un programme vendu au choix (`benefices(debut, fin, programme)` : Vente ou recouvrable comme PHPSP). |
| `011_revue_pharmacien.sql` | Lot déjà périmé refusé à l'entrée par le serveur ; rapport district : CMM du mois en cours sur les 3 derniers mois jusqu'à aujourd'hui, quantité à commander calculée sur le stock utilisable (sans les lots périmés encore en rayon). |
| `012_vocabulaire_rec.sql` | L'origine « Vente » s'appelle **REC** (produits recouvrables), comme sur les fiches du district ; anomalies nommées par sigle. |
| `013_journal_toutes_actions.sql` | Journal de toutes les actions, par déclencheurs (aucune fonction métier réécrite) ; `journal_connexion` pour les connexions. |

Sur la base de production, la 005 a été appliquée en deux temps (le 28/10/2026) : la première moitié depuis l'éditeur
SQL, puis la fin avec `supabase/production/005_suite.sql` (même contenu, relançable sans risque). Pour une base neuve,
appliquer simplement les fichiers de `supabase/migrations/` dans l'ordre.

Le site connaît la version de base qu'il attend (`VERSION_BASE` dans `js/version.js`) : si la base est en retard,
le gérant voit un bandeau rouge.

Les prix de départ viennent des fiches papier : vérifiez-les et complétez-les dans l'onglet **Base** (les prix manquants
sont surlignés en jaune, et les produits à vendre sans prix sont nommés en haut de la liste et dans l'onglet **Erreurs**).

## Mise en ligne

1. Le site est publié par **GitHub Pages** depuis la branche `main` (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).
2. **À chaque mise en ligne**, changer le numéro de version au même endroit dans les trois fichiers :
   `js/version.js` (`APP_VERSION`), `sw.js` (`APP_VERSION` et `CACHE`) et les `?v=` de `index.html`.
   Le test `tests/deploiement.test.js` refuse un envoi où ils ne concordent pas.
3. Une nouvelle version s'installe toute seule ; un bandeau propose de recharger (jamais de rechargement automatique :
   un panier en cours serait perdu).

### Réglages Supabase à faire une fois

Dans **Authentication → URL Configuration** : **Site URL** et **Redirect URLs** = `https://madarasenku.github.io/pharmacie-simple/`.
Sans cela, les liens de mot de passe oublié (gérant) renvoient vers une mauvaise adresse.

La connexion au projet est dans `js/config.js` (adresse du projet et clé **publique**). La clé publique peut être
visible : les données sont protégées par la RLS et les fonctions de la base. La clé secrète (`service_role`) ne
doit **jamais** apparaître dans le site (un test le vérifie).

## Tests automatiques

Ils tournent sur GitHub à chaque envoi et chaque nuit (`.github/workflows/tests.yml`), en deux parties :

- **Site** : Chromium ouvre le vrai site avec la vraie bibliothèque Supabase ; une fausse base en mémoire répond
  aux requêtes (`tests/helpers.js`). Aucune donnée réelle n'est touchée.
- **Base de données** : les migrations sont rejouées sur un PostgreSQL vide, puis un scénario complet vérifie les
  règles métier (`tests/sql/scenario.sql`).

En local :

```
npm install --no-save playwright && npx playwright install chromium
node tests/run.js                      # site
PGHOST=... PGUSER=postgres bash tests/sql/run.sh   # base (PostgreSQL 15 ou plus)
```

Pour regarder le site en local : `python3 -m http.server 8000`, puis `http://localhost:8000`.

Le fichier `CONTEXTE_POUR_IA.md` explique le fonctionnement interne (pour un développeur ou une IA qui reprend le projet).
