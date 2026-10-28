// Inventaire : comptage, brouillon gardé sur l'appareil, envoi au serveur avec la quantité
// « attendue » (protection contre une vente pendant le comptage), stock de départ.
const { ouvrir, aller, toast, lancerTest } = require('./helpers');

lancerTest('INVENTAIRE — comptage, brouillon, validation', async (r) => {
  const app = await ouvrir({ role: 'responsable' });
  try {
    const { page, etat, erreurs } = app;
    await aller(page, 'inventaire');
    // Origine Vente : lots 1 (PARACETAMOL, 42), 4 (AMOXICILLINE périmé, 3), 5 (ACT, 10) ; SRO jamais en stock
    const lignes = await page.$$eval('[data-compte]', (is) => is.map((i) => Number(i.dataset.compte)));
    r.check('un champ par lot en stock', lignes.sort(), [1, 4, 5]);
    r.ok('lot périmé signalé', (await page.$eval('#contenu', (c) => c.textContent)).includes('Périmé'));
    r.ok('produit sans stock : bouton « J’en ai trouvé »', await page.$('[data-ajout="4"]'));

    // Ordre de la feuille (alphabétique) : ACT (lot 5), AMOXICILLINE (lot 4), PARACETAMOL (lot 1)
    await page.fill('[data-compte="5"]', '10');
    await page.press('[data-compte="5"]', 'Enter');
    r.check('Entrée passe à la ligne suivante', await page.evaluate(() => document.activeElement?.dataset?.compte), '4');
    await page.fill('[data-compte="4"]', '0');
    await page.press('[data-compte="4"]', 'Enter');
    await page.fill('[data-compte="1"]', '40');
    await page.press('[data-compte="1"]', 'Tab');
    r.check('écart affiché', await page.$eval('[data-ecart="1"]', (e) => e.textContent.trim()), '−2'.replace('−', '-'));
    await page.click('[data-ajout="4"]');
    const cle = await page.evaluate(() => document.activeElement.dataset.nv);
    await page.fill(`#nq-${cle}`, '15');
    await page.press(`#nq-${cle}`, 'Tab');
    await page.fill(`#nn-${cle}`, 'SRO-1');
    await page.press(`#nn-${cle}`, 'Tab');

    // Le brouillon survit à un rechargement de la page
    await page.reload();
    await page.waitForSelector('#contenu[data-pret]');
    await aller(page, 'inventaire');
    r.check('brouillon retrouvé après rechargement', await page.$eval('[data-compte="1"]', (i) => i.value), '40');
    const bilan = (await page.$eval('.col-side', (c) => c.textContent)).replace(/\s+/g, ' ');
    r.ok('bilan : 3 lots comptés sur 3, 2 écarts, manquants 200 F, départ 750 F', bilan.includes('3 / 3') && /écart\s?2/.test(bilan) && bilan.includes('200 F') && bilan.includes('750 F'), bilan);

    await page.click('#valider');
    await page.click('.modal #ok');
    await page.waitForSelector('.modal #pv');
    const envoi = etat.appels.find((a) => a[0] === 'rpc' && a[1] === 'valider_inventaire')[2].p;
    r.check('comptes envoyés avec la quantité attendue', envoi.comptes.sort((a, b) => a.lot_id - b.lot_id), [{ lot_id: 1, reel: 40, attendu: 42 }, { lot_id: 4, reel: 0, attendu: 3 }, { lot_id: 5, reel: 10, attendu: 10 }]);
    r.check('stock de départ envoyé', envoi.nouveaux, [{ produit_id: 4, programme_id: 1, quantite: 15, numero: 'SRO-1', peremption: null }]);
    r.ok('procès-verbal proposé', await page.$('.modal #pv'));
    r.check('brouillon effacé après validation', await page.evaluate(() => localStorage.getItem('ph_inventaire_1')), null);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('INVENTAIRE — une vente passe pendant le comptage', async (r) => {
  let premier = true;
  const app = await ouvrir({
    role: 'gerant',
    rpc: {
      valider_inventaire: (a, db) => {
        if (premier) {
          premier = false;
          db.lots.find((l) => l.id === 1).quantite = 41; // vendu entre-temps
          throw new Error('Le stock a bougé pendant l\'inventaire pour : PARACETAMOL 500 MG CP (lot P1). Vérifiez ces lignes puis validez à nouveau.');
        }
        return { corrections: 1, lots_ajoutes: 0 };
      }
    }
  });
  try {
    const { page, etat } = app;
    await aller(page, 'inventaire');
    await page.fill('[data-compte="1"]', '40');
    await page.press('[data-compte="1"]', 'Tab');
    await page.click('#valider');
    await page.click('.modal #ok');
    await toast(page, 'a bougé');
    await page.waitForSelector('tr.sel [data-compte="1"]');
    r.ok('la ligne concernée est surlignée « recomptez »', (await page.$eval('tr.sel', (t) => t.textContent)).includes('recomptez'));
    r.check('le comptage saisi est conservé', await page.$eval('[data-compte="1"]', (i) => i.value), '40');
    await page.click('#valider');
    await page.click('.modal #ok');
    await page.waitForSelector('.modal #pv');
    const envois = etat.appels.filter((a) => a[0] === 'rpc' && a[1] === 'valider_inventaire').map((a) => a[2].p.comptes[0]);
    r.check('second envoi : nouvelle quantité attendue', envois[1], { lot_id: 1, reel: 40, attendu: 41 });
  } finally { await app.fermer(); }
});
