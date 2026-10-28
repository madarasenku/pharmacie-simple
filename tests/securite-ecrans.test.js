// Verrous visibles à l'écran : caisse fermée (annulation réservée au gérant), modification
// refusée par le serveur (RLS = zéro ligne, sans erreur) signalée, rôle changé à chaud.
const { ouvrir, aller, toast, lancerTest } = require('./helpers');

const caisseFermee = (db) => {
  db.caisses[0].fermee_le = new Date().toISOString();
  db.caisses[0].ecart = 0; db.caisses[0].especes_attendues = 10050; db.caisses[0].especes_comptees = 10050;
};

lancerTest('JOURNÉE — caisse fermée : seul le gérant annule', async (r) => {
  for (const [role, attendu] of [['responsable', false], ['gerant', true]]) {
    const app = await ouvrir({ role, donnees: caisseFermee });
    try {
      const { page } = app;
      await aller(page, 'journee');
      const peutAnnuler = !!(await page.$('[data-annuler="1"]'));
      r.check(`${role} : bouton Annuler sur une vente de caisse fermée`, peutAnnuler, attendu);
      if (!attendu) r.ok(`${role} : mention « Caisse fermée »`, (await page.$eval('#contenu', (c) => c.textContent)).includes('Caisse fermée'));
    } finally { await app.fermer(); }
  }
  const app = await ouvrir({ role: 'responsable' });
  try {
    await aller(app.page, 'journee');
    r.ok('responsable : Annuler disponible tant que la caisse est ouverte', await app.page.$('[data-annuler="1"]'));
  } finally { await app.fermer(); }
});

lancerTest('BASE — modification refusée par le serveur', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page, etat, erreurs } = app;
    await aller(page, 'base');
    etat.refuserEcritures.add('produits');
    const champ = await page.$('[data-champ="prix_vente"][data-id="1"]');
    await champ.fill('30');
    await champ.press('Tab');
    await toast(page, 'Le serveur a refusé la modification');
    r.ok('message « refusé » au lieu d’un faux « enregistré »', true);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('LISTES LONGUES — plus de 1000 produits', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      for (let i = 0; i < 1300; i++) {
        const id = 1000 + i;
        db.produits.push({ id, designation: 'PRODUIT ' + String(i).padStart(4, '0'), code_barres: null, prix_achat: 1, prix_vente: 2, stock_min: 0, actif: true });
        db.produits_programmes.push({ produit_id: id, programme_id: 1 });
        db.lots.push({ id: 5000 + i, produit_id: id, programme_id: 1, numero: '', peremption: null, quantite: 1 });
      }
    }
  });
  try {
    const { page, etat } = app;
    await aller(page, 'stock');
    const lignes = await page.$$eval('[data-produit]', (t) => t.length);
    r.check('les 1304 produits sont affichés (lus en plusieurs pages de 1000)', lignes, 1304);
    const pagesLues = etat.appels.filter((a) => a[0] === 'lecture' && a[1] === 'produits' && /offset=1000/.test(a[2])).length;
    r.ok('deuxième page demandée au serveur', pagesLues >= 1);
  } finally { await app.fermer(); }
});
