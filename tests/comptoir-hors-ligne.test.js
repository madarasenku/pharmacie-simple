// Comptoir : vente en ligne, puis vente SANS internet (file de l'appareil), renvoi
// automatique au retour du réseau sans doublon, et vente refusée à régler dans « Ma journée ».
const { ouvrir, aller, toast, lancerTest } = require('./helpers');

const appelsVente = (etat) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === 'enregistrer_vente').map((a) => a[2].p);
const file = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ph_file_ventes') || '[]'));

async function vendre(page, produitId, quantite = 1) {
  await page.click(`[data-ajout="${produitId}"]`);
  if (quantite !== 1) {
    await page.fill(`[data-qte="${produitId}"]`, String(quantite));
    await page.press(`[data-qte="${produitId}"]`, 'Tab');
  }
  await page.click('#valider');
  await page.waitForSelector('.modal');
}
const fermerModale = (page) => page.click('.modal [data-fermer]');

lancerTest('COMPTOIR — vente en ligne', async (r) => {
  const app = await ouvrir({ role: 'vendeur' });
  try {
    const { page, etat, erreurs } = app;
    await vendre(page, 1, 3);
    const v = appelsVente(etat);
    r.check('une seule demande au serveur', v.length, 1);
    r.ok('ref_client = identifiant unique (uuid)', /^[0-9a-f-]{36}$/.test(v[0].ref_client), v[0].ref_client);
    r.check('lignes envoyées', v[0].lignes, [{ produit_id: 1, quantite: 3 }]);
    r.check('pas marquée hors ligne', v[0].hors_ligne, undefined);
    const alerte = await page.$eval('.modal .alert', (a) => a.textContent);
    r.ok('ticket avec le numéro du serveur', /V-\d{4}-\d{5}/.test(alerte), alerte);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('COMPTOIR — vente sans internet puis renvoi automatique', async (r) => {
  const app = await ouvrir({ role: 'vendeur' });
  try {
    const { page, etat, context, db } = app;
    const avant = db.ventes.length;
    // Coupure : le navigateur passe hors ligne et le serveur ne répond plus
    etat.reseauCoupe = true;
    await context.setOffline(true);
    await vendre(page, 1, 2);
    const titre = await page.$eval('.modal h2', (h) => h.textContent);
    r.check('fenêtre « vente gardée hors ligne »', titre, 'Vente gardée hors ligne');
    r.ok('ticket marqué provisoire', (await page.$eval('.modal', (m) => m.textContent)).includes('PROVISOIRE'));
    await fermerModale(page);
    let f = await file(page);
    r.check('une vente dans la file de l’appareil', f.length, 1);
    r.check('marquée hors ligne avec son heure', [f[0].charge.hors_ligne, typeof f[0].charge.date_locale], [true, 'string']);
    r.ok('bandeau hors ligne affiché', await page.$eval('#bandeaux', (b) => /Hors ligne/.test(b.textContent)));
    const stockAffiche = await page.$eval('[data-ajout="1"]', (t) => t.textContent);
    r.ok('stock affiché diminué (42 → 40)', /\b40\b/.test(stockAffiche), stockAffiche);

    // Retour du réseau : la vente part toute seule, avec le MÊME identifiant
    etat.reseauCoupe = false;
    await context.setOffline(false);
    await toast(page, 'vente(s) hors ligne enregistrée(s)');
    const envoyees = appelsVente(etat);
    r.check('envoyée une fois', envoyees.length, 1);
    r.check('même ref_client que dans la file', envoyees[0].ref_client, f[0].ref);
    r.check('enregistrée sur le serveur', db.ventes.length, avant + 1);
    f = await file(page);
    r.check('file vidée', f.length, 0);

    // Renvoi en double (coupure au mauvais moment) : le serveur ne l'enregistre pas deux fois
    await page.evaluate((x) => {
      localStorage.setItem('ph_file_ventes', JSON.stringify([{ ref: x.ref_client, charge: { ...x, hors_ligne: true, date_locale: new Date().toISOString() }, resume: { numero: 'HL-X', total: 50 }, utilisateur: '33333333-3333-4333-8333-333333333333', etat: 'attente', cree_le: new Date().toISOString() }]));
    }, envoyees[0]);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ph_file_ventes') || '[]').length === 0);
    r.check('rejouée : toujours une seule vente sur le serveur', db.ventes.length, avant + 1);
  } finally { await app.fermer(); }
});

lancerTest('COMPTOIR — vente hors ligne refusée par le serveur', async (r) => {
  const app = await ouvrir({ role: 'vendeur', rpc: { enregistrer_vente: () => { throw new Error('Stock insuffisant pour PARACETAMOL 500 MG CP (2 manquant(s)).'); } } });
  try {
    const { page, etat, context } = app;
    etat.reseauCoupe = true;
    await context.setOffline(true);
    await vendre(page, 1);
    await fermerModale(page);
    etat.reseauCoupe = false;
    await context.setOffline(false);
    await page.waitForFunction(() => /refusée/.test(document.querySelector('#bandeaux')?.textContent || ''));
    r.ok('bandeau rouge « vente refusée »', true);
    await aller(page, 'journee');
    const texte = await page.$eval('#contenu', (c) => c.textContent);
    r.ok('Ma journée montre la vente refusée et le motif', texte.includes('Refusée') && texte.includes('Stock insuffisant'), texte.slice(0, 300));
    await page.click('[data-hl-abandon]');
    await page.click('.modal [data-oui]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ph_file_ventes') || '[]').length === 0);
    r.ok('« Abandonner » retire la vente de l’appareil', true);
  } finally { await app.fermer(); }
});
