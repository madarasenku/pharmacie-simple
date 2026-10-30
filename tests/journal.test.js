// Journal de toutes les actions (Réglages, gérant) : phrases lisibles, filtres par sorte d'action, personne et jour,
// anciennes lignes mises en forme avec les vrais noms, connexions et déconnexions notées.
const { ouvrir, aller, lancerTest, UTILISATEURS } = require('./helpers');

const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const lectures = (etat) => etat.appels.filter((a) => a[0] === 'lecture' && a[1] === 'journal').map((a) => decodeURIComponent(a[2]));
const lignes = (page) => page.$$eval('.table-box.defile tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.trim())));

function donnees(db) {
  const v = UTILISATEURS.vendeur;
  db.journal.push(
    { id: 2, user_id: v.id, action: 'vente', details: { texte: 'V-2026-00012 · REC · PARACETAMOL 500 MG CP × 2 · 50 F en espèces' }, created_at: ilYA(10), profiles: { nom: v.nom } },
    { id: 3, user_id: v.id, action: 'entree', details: { texte: 'SRO SACHET · REC · +20 · lot S1 · périme 06/2027' }, created_at: ilYA(20), profiles: { nom: v.nom } },
    { id: 4, user_id: v.id, action: 'connexion', details: { texte: 'Connexion' }, created_at: ilYA(60 * 26), profiles: { nom: v.nom } }
  );
  // ligne ancienne, sans phrase : produit et lot cités par leur numéro
  db.journal[0].details = { lot: 1, produit: 1, avant: 44, apres: 42, motif: 'Casse' };
}

lancerTest('JOURNAL — toutes les actions, lisibles et filtrables', async (r) => {
  const app = await ouvrir({ role: 'gerant', donnees });
  try {
    const { page, etat, erreurs } = app;
    await aller(page, 'reglages');
    r.ok('titre « Journal de toutes les actions »', (await page.$eval('#contenu', (c) => c.textContent)).includes('Journal de toutes les actions'));
    r.check('filtres par sorte d’action', await page.$$eval('[data-j]', (b) => b.map((x) => x.textContent.trim())),
      ['Tout', 'Ventes', 'Stock', 'Caisse et crédits', 'Base', 'Commandes', 'Comptes et connexions', 'Réglages']);
    const tout = await lignes(page);
    r.check('4 actions, la plus récente en haut', tout.map((l) => l[2]), ['Vente', 'Entrée de stock', 'Correction stock', 'Connexion']);
    r.check('vente : la phrase écrite par la base', tout[0][3], 'V-2026-00012 · REC · PARACETAMOL 500 MG CP × 2 · 50 F en espèces');
    r.check('ancienne correction : avec le vrai nom du produit et du lot', tout[2][3], 'PARACETAMOL 500 MG CP · lot P1 · 44 → 42 · Casse');
    r.check('qui a fait l’action', tout[0][1], 'AWA VENDEUSE');

    await page.click('[data-j="ventes"]');
    await page.waitForFunction(() => document.querySelectorAll('.table-box.defile tbody tr').length === 1);
    r.ok('« Ventes » : ventes, distributions et annulations demandées', lectures(etat).pop().includes('action=in.(vente,distribution,annulation)'));
    r.check('« Ventes » : seulement la vente', (await lignes(page)).map((l) => l[2]), ['Vente']);

    await page.click('[data-j=""]');
    await page.waitForFunction(() => document.querySelectorAll('.table-box.defile tbody tr').length === 4);
    await page.selectOption('#j-qui', UTILISATEURS.vendeur.id);
    await page.waitForFunction(() => document.querySelectorAll('.table-box.defile tbody tr').length === 3);
    r.ok('filtre « Qui » : seulement les actions d’AWA', lectures(etat).pop().includes('user_id=eq.' + UTILISATEURS.vendeur.id));

    const hier = new Date(Date.now() - 26 * 3600000).toISOString().slice(0, 10);
    await page.fill('#j-jour', hier);
    await page.dispatchEvent('#j-jour', 'change');
    await page.waitForFunction(() => document.querySelectorAll('.table-box.defile tbody tr').length === 1);
    r.check('filtre « Jour » : la connexion d’hier', (await lignes(page)).map((l) => l[2]), ['Connexion']);
    r.ok('« Effacer les filtres » proposé', !!(await page.$('#j-effacer')));
    r.ok('export Excel du journal', !!(await page.$('#csv-journal')));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('JOURNAL — connexion et déconnexion notées', async (r) => {
  const app = await ouvrir({ role: null });
  try {
    const { page, etat, erreurs } = app;
    await page.fill('#identifiant', 'awa');
    await page.fill('#mdp', 'Awa12345');
    await page.click('button[type=submit]');
    await page.waitForSelector('#contenu[data-pret]');
    for (let i = 0; i < 40 && !etat.appels.some((a) => a[1] === 'journal_connexion'); i++) await page.waitForTimeout(50);
    r.check('connexion notée', etat.appels.filter((a) => a[1] === 'journal_connexion').map((a) => a[2].p_evenement), ['connexion']);
    await page.click('#deconnexion');
    await page.waitForSelector('form.login');
    r.check('déconnexion notée avant de sortir', etat.appels.filter((a) => a[1] === 'journal_connexion').map((a) => a[2].p_evenement), ['connexion', 'deconnexion']);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});
