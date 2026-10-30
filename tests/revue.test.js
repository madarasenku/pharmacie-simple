// Revue « communication visuelle + pharmacien » : barre d'onglets entière sur un portable,
// chiffres lisibles, lots périmés jamais cachés, rapport district calculé sur le stock utilisable.
const { ouvrir, aller, lancerTest } = require('./helpers');

lancerTest('REVUE — la barre d’onglets tient sur un portable (1366 et 1280 px)', async (r) => {
  for (const largeur of [1366, 1280, 1440]) {
    const app = await ouvrir({ role: 'gerant' });
    try {
      await app.page.setViewportSize({ width: largeur, height: 900 });
      await app.page.waitForTimeout(150);
      const d = await app.page.$eval('nav.menu', (n) => [n.scrollWidth, n.clientWidth]);
      r.ok(`${largeur} px : les 12 onglets visibles sans défiler`, d[0] <= d[1], JSON.stringify(d));
      const dernier = await app.page.$eval('nav.menu a[data-page="erreurs"]', (a) => a.getBoundingClientRect().right);
      r.ok(`${largeur} px : l’onglet « Erreurs » entièrement visible`, dernier <= largeur, String(dernier));
    } finally { await app.fermer(); }
  }
});

lancerTest('REVUE — chiffres dans la police de l’application, deux chiffres clés par ligne sur téléphone', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page } = app;
    await aller(page, 'journee');
    const police = await page.$eval('.kpi .v', (v) => getComputedStyle(v).fontFamily);
    r.ok('chiffres clés : police Plus Jakarta Sans (plus de police « machine à écrire »)', /Plus Jakarta Sans/.test(police), police);
    const tableau = await page.$eval('td.num', (v) => getComputedStyle(v).fontFamily);
    r.ok('tableaux : même police, chiffres alignés', /Plus Jakarta Sans/.test(tableau), tableau);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const cols = await page.$eval('.grid-kpi', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    r.check('téléphone : 2 chiffres clés par ligne', cols, 2);
    r.check('aucune erreur JavaScript', app.erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('REVUE — un lot périmé en rayon n’est jamais caché derrière « Rupture »', async (r) => {
  // AMOXICILLINE : 3 unités dans un lot périmé, rien d'utilisable
  const app = await ouvrir({ role: 'gerant', page: '#/stock' });
  try {
    const { page } = app;
    const ligne = await page.$$eval('tbody tr.clic', (trs) => trs.map((t) => t.textContent)).then((l) => l.find((x) => x.includes('AMOXICILLINE')));
    r.ok('Mon stock : « Périmé à retirer » (et la rupture rappelée)', /Périmé à retirer/.test(ligne) && /rupture/.test(ligne), ligne);
    r.check('filtre « Périmés » : 1 produit', await page.$eval('[data-filtre="perime"] .num', (n) => n.textContent), '1');
    r.check('filtre « Rupture » le compte aussi', await page.$eval('[data-filtre="rupture"] .num', (n) => n.textContent), '1');
    await page.click('[data-filtre="perime"]');
    r.check('« Périmés » montre ce produit', await page.$$eval('tbody tr.clic', (trs) => trs.map((t) => t.cells[0].textContent.trim())), ['AMOXICILLINE 500 MG GEL']);

    await aller(page, 'comptoir');
    const tuile = await page.$eval('[data-ajout="3"]', (t) => t.textContent.replace(/\s+/g, ' '));
    r.ok('comptoir : la tuile dit « Périmé · à retirer », pas seulement « Rupture »', tuile.includes('Périmé · à retirer'), tuile);
    r.ok('comptoir : impossible de le vendre', await page.$eval('[data-ajout="3"]', (t) => t.disabled));
    r.check('aucune erreur JavaScript', app.erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('REVUE — rapport district : lots périmés en rayon signalés avant l’impression', async (r) => {
  const app = await ouvrir({ role: 'gerant', page: '#/rapport' });
  try {
    const { page } = app;
    const alerte = await page.$eval('.alert-err', (a) => a.textContent.replace(/\s+/g, ' ')).catch(() => '');
    r.ok('alerte : le lot périmé est nommé avec sa quantité et son lot', alerte.includes('1 lot(s) périmé(s) encore en rayon') && alerte.includes('AMOXICILLINE 500 MG GEL (3, lot AM9'), alerte);
    r.ok('alerte : explique quoi faire (Mon stock, « Périmé jeté »)', alerte.includes('Périmé jeté') && !!(await page.$('.alert-err a[href="#/stock"]')));
    // Mois passé : pas d'alerte (on ne connaît que les lots d'aujourd'hui)
    await page.fill('#mois', '2025-01');
    await page.dispatchEvent('#mois', 'change');
    await page.waitForFunction(() => document.querySelector('#mois').value === '2025-01' && !document.querySelector('.alert-err'));
    r.ok('mois passé : pas d’alerte sur les lots d’aujourd’hui', true);
    r.check('aucune erreur JavaScript', app.erreurs, []);
  } finally { await app.fermer(); }
});
