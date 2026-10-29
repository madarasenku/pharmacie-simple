// Base : supprimer un ou plusieurs produits / programmes (effacés, masqués ou refusés selon
// leur historique). Mon stock : choix de l'origine affichée, comme dans l'Inventaire.
const { ouvrir, aller, lancerTest } = require('./helpers');

lancerTest('BASE — supprimer plusieurs produits', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      db.produits.push({ id: 50, designation: 'ZZ DOUBLON', code_barres: null, prix_achat: 0, prix_vente: 0, stock_min: 0, actif: true });
      db.produits_programmes.push({ produit_id: 50, programme_id: 1 });
    }
  });
  try {
    const { page, etat, db, erreurs } = app;
    await aller(page, 'base');
    r.ok('bouton « Supprimer » caché sans sélection', await page.$eval('#suppr-prod', (b) => b.classList.contains('hidden')));
    await page.check('[data-choix-prod="50"]');
    await page.check('[data-choix-prod="1"]');
    r.check('bouton avec le nombre choisi', await page.$eval('#suppr-prod', (b) => b.textContent.trim()), 'Supprimer la sélection (2)');
    await page.click('#suppr-prod');
    const texte = await page.$eval('.modal', (m) => m.textContent);
    r.ok('la confirmation liste les produits et explique la règle', texte.includes('ZZ DOUBLON') && texte.includes('PARACETAMOL') && texte.includes('historique'));
    await page.click('.modal #ok');
    await page.waitForSelector('.modal h2:text("Suppression terminée")');
    r.check('demande envoyée au serveur', etat.appels.find((a) => a[1] === 'supprimer_produits')[2], { p_ids: [50, 1] });
    const bilan = await page.$eval('.modal', (m) => m.textContent);
    r.ok('bilan : effacé / non supprimé (encore du stock)', bilan.includes('Effacés (1)') && bilan.includes('ZZ DOUBLON') && bilan.includes('encore du stock (1)'), bilan);
    await page.click('.modal [data-fermer]');
    r.ok('le produit effacé a disparu de la liste', !(await page.$('[data-choix-prod="50"]')));
    r.ok('le produit en stock est toujours là', await page.$('[data-choix-prod="1"]'));
    r.check('sélection vidée', await page.$eval('#suppr-prod', (b) => b.classList.contains('hidden')), true);
    r.check('côté serveur', db.produits.some((p) => p.id === 50), false);

    // « Tout choisir » ne prend que les produits affichés (après une recherche)
    await page.fill('#rech', 'SRO');
    await page.waitForFunction(() => document.querySelectorAll('[data-choix-prod]').length === 1);
    await page.check('#tout-choisir');
    r.check('« tout choisir » = les produits affichés seulement', await page.$eval('#suppr-prod', (b) => b.textContent.trim()), 'Supprimer la sélection (1)');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('BASE — supprimer des programmes', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page, etat } = app;
    await aller(page, 'base');
    r.ok('pas de case pour l’origine Vente', !(await page.$('[data-choix-prog="1"]')));
    await page.check('[data-choix-prog="4"]');
    await page.check('[data-choix-prog="2"]');
    await page.click('#suppr-prog');
    r.ok('la confirmation précise que les produits restent', (await page.$eval('.modal', (m) => m.textContent)).includes('ne sont pas supprimés'));
    await page.click('.modal #ok');
    await page.waitForSelector('.modal h2:text("Suppression terminée")');
    r.check('demande envoyée', etat.appels.find((a) => a[1] === 'supprimer_programmes')[2], { p_ids: [4, 2] });
    const bilan = await page.$eval('.modal', (m) => m.textContent);
    r.ok('PF effacé, PNLP refusé (stock)', bilan.includes('Planification familiale') && bilan.includes('encore du stock (1)') && bilan.includes('Paludisme'), bilan);
    await page.click('.modal [data-fermer]');
    r.ok('PF a disparu de la Base', !(await page.$('[data-choix-prog="4"]')));
  } finally { await app.fermer(); }
});

lancerTest('STOCK — choisir l’origine affichée', async (r) => {
  const app = await ouvrir({ role: 'vendeur' });
  try {
    const { page, erreurs } = app;
    await aller(page, 'stock');
    const boutons = await page.$$eval('[data-vue]', (bs) => bs.map((b) => b.querySelector('strong').textContent));
    r.check('boutons Tout + chaque origine', boutons, ['Tout', 'Vente', 'PNLP', 'GRAT', 'PF', 'PHPSP']);
    r.check('Tout : 4 produits, une colonne par origine', [await page.$$eval('[data-produit]', (t) => t.length), await page.$$eval('thead th', (t) => t.length)], [4, 10]);

    await page.click('[data-vue="2"]');
    const lignes = await page.$$eval('[data-produit]', (t) => t.map((x) => x.cells[0].textContent));
    r.check('PNLP : seulement les produits du PNLP', lignes, ['ACT ENFANT 1-5 ANS']);
    r.check('PNLP : une seule colonne de stock', await page.$$eval('thead th', (t) => t.map((x) => x.textContent)), ['Produit', 'Stock PNLP', 'Conso / mois', 'Péremption', 'État']);
    r.check('PNLP : quantité du PNLP seulement (43)', await page.$eval('[data-produit] td:nth-child(2)', (t) => t.textContent.trim()), '43');
    r.ok('PNLP : pas de liste « À commander (vente) »', !(await page.$eval('#contenu', (c) => c.textContent.includes('À commander (vente)'))));

    await page.click('[data-vue="4"]');
    r.ok('PF sans produit : message clair', (await page.$eval('#contenu', (c) => c.textContent)).includes('Aucun produit rattaché à PF'));

    await page.click('[data-vue="1"]');
    await page.reload();
    await page.waitForSelector('#contenu[data-pret]');
    await aller(page, 'stock');
    r.ok('le choix est gardé après rechargement (Vente)', await page.$eval('[data-vue="1"]', (b) => b.classList.contains('on')));
    r.check('Vente : 4 produits', await page.$$eval('[data-produit]', (t) => t.length), 4);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});
