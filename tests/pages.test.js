// Chaque page du menu s'affiche, pour chaque rôle, sans aucune erreur JavaScript,
// et le menu ne montre que ce que le rôle a le droit de faire.
const { ouvrir, aller, lancerTest } = require('./helpers');

const MENUS = {
  gerant: ['comptoir', 'entree', 'stock', 'inventaire', 'journee', 'credits', 'programmes', 'point', 'rapport', 'base', 'reglages'],
  responsable: ['comptoir', 'entree', 'stock', 'inventaire', 'journee', 'credits', 'programmes', 'point', 'rapport'],
  vendeur: ['comptoir', 'stock', 'journee', 'credits', 'programmes']
};

lancerTest('PAGES — affichage de toutes les pages, pour chaque rôle', async (r) => {
  for (const role of Object.keys(MENUS)) {
    const app = await ouvrir({ role });
    try {
      const { page, erreurs } = app;
      const menu = await page.$$eval('nav.menu a', (as) => as.map((a) => a.dataset.page));
      r.check(`${role} : menu`, menu, MENUS[role]);
      for (const id of menu) {
        await aller(page, id);
        const titre = await page.$eval('#contenu h1', (h) => h.textContent.trim()).catch(() => '');
        const alerte = await page.$eval('#contenu > .alert-err', (a) => a.textContent).catch(() => '');
        r.ok(`${role} : page ${id} affichée (« ${titre} »)`, titre && !alerte, alerte);
      }
      // Une page interdite tapée dans l'adresse renvoie vers la première page autorisée
      if (role === 'vendeur') {
        await page.evaluate(() => { location.hash = '#/reglages'; });
        await page.waitForFunction(() => location.hash === '#/comptoir');
        r.ok('vendeur : #/reglages redirige vers le comptoir', true);
      }
      r.check(`${role} : aucune erreur JavaScript`, erreurs, []);
    } finally { await app.fermer(); }
  }
});
