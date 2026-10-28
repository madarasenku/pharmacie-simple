// Site installé (service worker) : sans aucun réseau, un RECHARGEMENT de la page rouvre
// le comptoir depuis l'appareil, avec le dernier stock connu, et une vente part en file.
const { ouvrir, lancerTest } = require('./helpers');

lancerTest('PWA — rechargement complet sans internet', async (r) => {
  // « localhost » : le service worker n'est autorisé qu'en https ou sur localhost
  const app = await ouvrir({ role: 'vendeur', hote: 'localhost' });
  try {
    const { page, context, etat, erreurs } = app;
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 });
    r.ok('service worker actif', true);
    const caches = await page.evaluate(async () => (await caches.keys()));
    r.ok('cache du site créé', caches.some((c) => /^pharmacie-simple-v\d+$/.test(c)), caches.join(', '));

    etat.reseauCoupe = true;
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#contenu[data-pret="comptoir"]', { timeout: 20000 });
    r.ok('le comptoir se rouvre sans internet', true);
    r.ok('bandeau hors ligne', (await page.$eval('#bandeaux', (b) => b.textContent)).includes('Hors ligne'));
    const menu = await page.$$eval('nav.menu a', (as) => as.map((a) => a.dataset.page));
    r.check('hors ligne : seulement Comptoir et Ma journée', menu, ['comptoir', 'journee']);
    r.ok('produits affichés depuis l’appareil', await page.$('[data-ajout="1"]'));

    await page.click('[data-ajout="1"]');
    await page.click('#valider');
    await page.waitForSelector('.modal');
    r.check('vente gardée sur l’appareil', await page.evaluate(() => JSON.parse(localStorage.getItem('ph_file_ventes') || '[]').length), 1);
    await page.click('.modal [data-fermer]');

    // Le réseau revient pendant qu'un panier est en cours : le panier n'est pas effacé
    await page.click('[data-ajout="1"]');
    etat.reseauCoupe = false;
    await context.setOffline(false);
    await page.waitForFunction(() => document.querySelectorAll('nav.menu a').length > 2, null, { timeout: 15000 });
    r.ok('retour en ligne : menu complet', true);
    r.ok('le panier en cours est conservé', await page.$('[data-qte="1"]'));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ph_file_ventes') || '[]').length === 0, null, { timeout: 15000 });
    r.ok('la vente hors ligne est partie', true);
    r.ok('bouton « Mon mot de passe » revenu', await page.$('#mon-mdp'));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});
