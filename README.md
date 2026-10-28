# Pharmacie Simple

Application web de gestion d'une pharmacie de centre de santé, pensée pour un seul gestionnaire :
vente au comptoir, distributions gratuites des programmes, stock par lot, caisse, crédits clients
et rapports (dont le formulaire « Rapports produits commandes recouvrables » du district).

- **Site** : HTML, CSS et JavaScript, sans installation ni compilation.
- **Base de données** : Supabase (PostgreSQL), avec règles de sécurité (RLS) sur toutes les tables.

## Les écrans

| Onglet | Rôle |
|---|---|
| Comptoir | Vendre (stock Vente) ou distribuer gratuitement (stock d'un programme). Scan du code-barres, lot qui périme en premier, patient facultatif (nom, âge, tranche d'âge, sexe), suggestion de la Gratuité, paiement espèces / Mobile Money / crédit, reçu ou ticket imprimable. |
| Entrée de stock | Réception d'un achat ou d'une dotation de programme : lot, péremption, prix. Un code-barres inconnu permet de créer le produit. |
| Mon stock | Stock par origine (Vente, PNLP, GRAT, PF…), alertes, lots, corrections et historique de chaque produit. |
| Ma journée | Ventes du jour, annulation (avec motif), réimpression des reçus, ouverture et fermeture de caisse. |
| Crédits | Qui doit combien, historique, remboursements, relance WhatsApp. |
| Programmes | Compte rendu mensuel de chaque programme et bénéficiaires par tranche d'âge et sexe. |
| Point général | Ventes, bénéfice, programmes et stock sur une période. |
| Rapport district | Formulaire « commandes recouvrables » rempli automatiquement (quantité commandée = 2 × CMM − SD), imprimable en A4 paysage. |
| Base | Programmes et produits : prix, minimum, code-barres, rattachement à un ou plusieurs programmes. |
| Réglages | Infos de la pharmacie, droits du vendeur, utilisateurs, journal des actions sensibles, sauvegarde. |

## Comptes et droits

- Chaque utilisateur crée son compte sur l'écran de connexion (« Créer un compte »).
- **Le premier compte créé devient gérant.** Les suivants sont vendeurs.
- Le gérant a tous les droits. Ceux du vendeur se règlent dans **Réglages** : vendre, entrée de stock, crédit, programmes, corriger le stock, annuler une vente, changer les prix, voir les rapports, modifier la Base.

## Mise en ligne (GitHub Pages)

1. Sur GitHub, ouvrez le dépôt, puis **Settings → Pages**.
2. Choisissez **Deploy from a branch**, la branche `main` et le dossier `/ (root)`, puis enregistrez.
3. Le site sera disponible à l'adresse `https://<votre-compte>.github.io/<nom-du-depot>/`.

## Réglages Supabase à faire une fois

Dans le tableau de bord Supabase du projet, ouvrez **Authentication → URL Configuration** :

- **Site URL** : l'adresse du site (par exemple `https://<votre-compte>.github.io/<nom-du-depot>/`).
- **Redirect URLs** : ajoutez la même adresse.

Sans cela, les liens de confirmation d'e-mail et de mot de passe oublié renvoient vers une mauvaise adresse.

La connexion au projet est dans `js/config.js` (adresse du projet et clé publique). La clé publique peut être visible : les données sont protégées par les règles RLS et les fonctions de la base.

## Base de données

Les fichiers SQL sont dans `supabase/migrations/` et ont déjà été appliqués au projet :

- `001_schema.sql` : tables, sécurité RLS, vues de stock et fonctions métier (vente avec sortie du lot qui périme en premier, entrée, correction, annulation, caisse, crédits, rapport mensuel) ;
- `002_donnees_initiales.sql` : programmes (Vente, PNLP, Gratuité, PF), droits par défaut du vendeur, et la liste des produits recouvrables tirée des fiches du district ;
- `003_securite.sql` : corrections demandées par l'audit de sécurité Supabase.

Les prix de départ viennent des fiches papier : vérifiez-les et complétez-les dans l'onglet **Base**. Ceux qui manquent sont surlignés en jaune.

## Tester en local

Servez le dossier avec n'importe quel serveur web statique, par exemple :

```
python3 -m http.server 8000
```

puis ouvrez `http://localhost:8000`.
