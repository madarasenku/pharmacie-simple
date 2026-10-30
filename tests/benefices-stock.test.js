// Point général : « Point PR.REC » et « Point PHPSP » présentés de la même façon, bénéfices compris
// (ventes et bénéfices, bénéfice en un coup d'œil, jour par jour, par produit, stock valorisé) ;
// prix par programme dans la Base ; Prix, Valeur et MSD dans Mon stock ; CMM et MSD à l'inventaire.
const { ouvrir, aller, lancerTest } = require('./helpers');

const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const chiffres = (t) => String(t).replace(/\s/g, '');
const appels = (etat, fn) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === fn).map((a) => a[2]);
// « titre → valeur » de chaque carte du n-ième bloc de chiffres
const cartes = (page, n = 0) => page.$$eval('.grid-kpi', (blocs, i) => [...blocs[i].querySelectorAll('.kpi')].map((k) => [k.querySelector('.t').textContent.trim(), (k.querySelector('.v')?.textContent || '').replace(/\s/g, '')]), n);
const lignesDe = (page, bloc) => page.$$eval(`[data-bloc="${bloc}"] tbody tr`, (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.replace(/\s/g, ''))));
const ligneVente = (id, programme_id, mode, lignes, extra = {}) => ({
  id, numero: 'T-' + id, programme_id, caisse_id: 1, mode_paiement: mode, total: 0, annulee: false, saisie_hors_ligne: false,
  created_at: ilYA(5), patient_nom: null, patient_sexe: 'NP', client_id: null, clients: null, ventes_lignes: lignes, ...extra
});
const ligne = (produit_id, quantite, prix_unitaire, cout_unitaire) => ({ produit_id, quantite, prix_unitaire, cout_unitaire, produits: { designation: '' } });
const mvt = (id, produit_id, programme_id, type, quantite, minutes) => ({ id, produit_id, programme_id, lot_id: null, type, quantite, created_at: ilYA(minutes), produits: {}, lots: null, profiles: { nom: 'GÉRANTE TEST' } });

function donnees(db) {
  // Aujourd'hui, en plus de la vente de base (2 × 25 F, coûtant 10 F pièce : 30 F de bénéfice)
  db.ventes.push(
    ligneVente(2, 1, 'credit', [ligne(3, 3, 100, 40)]),   // 300 F de ventes à crédit, coût 120 F
    ligneVente(3, 1, 'especes', [ligne(4, 1, 100, 0)]),    // prix d'achat inconnu : bénéfice faux à signaler
    ligneVente(4, 2, 'gratuit', [ligne(2, 5, 0, 0)]),      // distribution gratuite : jamais un bénéfice
    ligneVente(5, 5, 'especes', [ligne(1, 10, 15, 10)]),   // PHPSP : 150 F de ventes, 50 F de bénéfice, à part
    ligneVente(6, 1, 'especes', [ligne(1, 9, 25, 10)], { annulee: true }) // annulée : ignorée
  );
  // AMOXICILLINE : 5 reçues avant le mois, 2 périmées jetées ce mois (prix d'achat 60 F) : 120 F de pertes
  db.mouvements.push(mvt(89, 3, 1, 'entree', 5, 40 * 24 * 60), mvt(90, 3, 1, 'perime', -2, 5));
  // ACT ENFANT au PNLP, valeur d'une unité 500 F : 50 avant le mois, +10, −7 donnés, −2 périmés
  db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente = 500;
  db.mouvements.push(mvt(91, 2, 2, 'entree', 50, 40 * 24 * 60), mvt(92, 2, 2, 'entree', 10, 20), mvt(93, 2, 2, 'distribution', -7, 15), mvt(94, 2, 2, 'perime', -2, 10));
}

async function ouvrirPoint(role) {
  const app = await ouvrir({ role, page: '#/point', donnees });
  await app.page.waitForFunction(() => document.querySelector('#contenu h1')?.textContent.trim() === 'Point PR.REC');
  return app;
}
const lignesSans = (l) => l.filter((x) => !String(x[0]).startsWith('TOTAL'));

lancerTest('POINT PR.REC — ventes, bénéfices, produits et stock dans le même point', async (r) => {
  const app = await ouvrirPoint('gerant');
  try {
    const { page, etat, erreurs } = app;
    r.check('un point par programme vendu (plus d’écran « Bénéfices » à part)', await page.$$eval('[data-vue]', (b) => b.map((x) => x.querySelector('strong').textContent.trim())), ['Point PR.REC', 'Point PHPSP']);
    r.check('ventes (argent) et bénéfice ensemble', await cartes(page, 0), [
      ["Chiffre d'affaires", '450'], ['Bénéfice estimé', '310'], ['Achats de médicaments', '440'], ['Répartition', ''], ['Pertes', '120'], ['Bénéfice net', '190']
    ]);
    const repartition = await page.$eval('.grid-kpi .kpi:nth-child(4)', (k) => k.textContent.replace(/\s+/g, ' '));
    r.ok('répartition : espèces 150, crédit 300', /Espèces 150/.test(repartition) && /Crédit 300/.test(repartition), repartition);
    r.check('bénéfice en un coup d’œil : aujourd’hui, 7 jours, mois, année', (await cartes(page, 1)).map(([t]) => t), ["Aujourd'hui", '7 derniers jours', 'Ce mois', 'Cette année']);
    r.check('bénéfice d’aujourd’hui = 310 F', (await cartes(page, 1))[0][1], '310');
    const jours = await lignesDe(page, 'jours');
    r.ok('jour par jour : une ligne aujourd’hui et le total', jours.length === 2 && jours[0][1] === '450' && jours[0][3] === '310' && jours[1][0] === 'TOTAL', JSON.stringify(jours));
    const produits = lignesSans(await lignesDe(page, 'produits'));
    r.check('par produit : prix, vendu, montant, bénéfice, le plus rentable d’abord', produits.map((x) => [x[0], x[1], x[2], x[3], x[5]]),
      [['AMOXICILLINE500MGGEL', '100', '3', '300', '180'], ['SROSACHET', '100', '1', '100', '100'], ['PARACETAMOL500MGCP', '25', '2', '50', '30']]);
    r.ok('SRO SACHET : prix d’achat manquant, lien « Corriger »', produits[1][7].includes('Prixd’achatmanquant') && !!(await page.$('a[href="#/base?rech=SRO%20SACHET"]')));
    r.check('stock REC dans le même point', (await cartes(page, 2))[0], ['Valeur du stock REC', '1400']);
    const stock = lignesSans(await lignesDe(page, 'stock'));
    r.check('stock REC : AMOXICILLINE début 5, pertes 2, reste 3', stock.find((x) => x[0].startsWith('AMOX')).slice(1, 7), ['100', '5', '0', '0', '2', '3']);
    const gratuits = await lignesDe(page, 'gratuits');
    r.check('programmes gratuits : PNLP 1 bénéficiaire, 5 données, 10 reçues, valeurs 3 500 et 25 500', gratuits[0].slice(1, 6), ['1', '5', '10', '3500', '25500']);
    r.check('bénéfices demandés pour REC seulement', [...new Set(appels(etat, 'benefices').map((a) => a.p_programme))], [1]);

    // Un mois précis : tout le point suit
    await page.fill('#mois-choisi', '2025-01');
    await page.waitForFunction(() => document.querySelector('#contenu').textContent.includes('Janvier 2025'));
    r.ok('janvier 2025 demandé pour les bénéfices et le stock', appels(etat, 'benefices').some((a) => a.p_debut === '2025-01-01' && a.p_fin === '2025-02-01')
      && appels(etat, 'stock_valeurs').some((a) => a.p_debut === '2025-01-01'));
    r.ok('mois sans vente : message clair', (await page.$eval('#contenu', (c) => c.textContent)).includes('Aucune vente sur cette période.'));
    await page.click('[data-p="annee"]');
    await page.waitForFunction(() => document.querySelector('[data-p="annee"]').classList.contains('on'));
    r.ok('« Cette année » : depuis le 1er janvier', appels(etat, 'benefices').some((a) => a.p_debut === new Date().getFullYear() + '-01-01'));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('POINT PHPSP — présenté comme le point PR.REC, argent à reverser', async (r) => {
  const app = await ouvrirPoint('gerant');
  try {
    const { page, erreurs } = app;
    await page.click('[data-vue="5"]');
    await page.waitForFunction(() => document.querySelector('#contenu h1')?.textContent.trim() === 'Point PHPSP');
    const c = await cartes(page, 0);
    r.check('mêmes chiffres que le point PR.REC : CA, bénéfice, achats, répartition, pertes, net', c.map(([t]) => t), ["Chiffre d'affaires", 'Bénéfice estimé', 'Achats de médicaments', 'Répartition', 'Pertes', 'Bénéfice net']);
    r.check('PHPSP : 150 F de ventes, 50 F de bénéfice', [c[0][1], c[1][1]], ['150', '50']);
    r.ok('PHPSP : recettes à reverser', (await page.$eval('#contenu', (x) => x.textContent)).includes('à reverser'));
    r.check('PHPSP : bénéfice en un coup d’œil', (await cartes(page, 1))[0], ["Aujourd'hui", '50']);
    const produits = await lignesDe(page, 'produits');
    r.check('PHPSP : son produit au prix PHPSP, puis le total encaissé', produits.map((x) => [x[0], x[1]]), [['PARACETAMOL500MGCP', '15'], ['TOTALENCAISSÉ', '150']]);
    r.ok('PHPSP : pas de tableau des programmes gratuits', !(await page.$('[data-bloc="gratuits"]')));
    r.ok('PHPSP : imprimable', !!(await page.$('#imprimer')));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('POINTS — le responsable les voit, un agent jamais', async (r) => {
  const resp = await ouvrirPoint('responsable');
  try {
    r.check('responsable : bénéfice du point PR.REC', (await cartes(resp.page, 0))[1], ['Bénéfice estimé', '310']);
    r.check('responsable : aucune erreur JavaScript', resp.erreurs, []);
  } finally { await resp.fermer(); }

  const agent = await ouvrir({ role: 'vendeur' });
  try {
    r.ok('agent : pas d’onglet « Point général »', !(await agent.page.$('nav.menu a[data-page="point"]')));
    await agent.page.evaluate(() => { location.hash = '#/point'; });
    await agent.page.waitForFunction(() => location.hash === '#/comptoir');
    r.check('agent : #/point renvoie au comptoir, aucun appel aux bénéfices', appels(agent.etat, 'benefices').length, 0);
  } finally { await agent.fermer(); }
});

lancerTest('INVENTAIRE — CMM et MSD à côté du lot et de la péremption', async (r) => {
  const app = await ouvrir({ role: 'gerant', page: '#/inventaire' });
  try {
    const { page, erreurs } = app;
    const th = await page.$$eval('thead th', (t) => t.map((x) => x.textContent.trim()));
    r.check('colonnes : produit, lot, péremption, CMM, MSD, système…', th.slice(0, 6), ['Produit', 'Lot', 'Péremption', 'CMM', 'MSD', 'Système']);
    const para = await page.$$eval('tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.trim())).find((x) => x[0].startsWith('PARACETAMOL')));
    r.check('PARACETAMOL : CMM 45,0, MSD 0,9 (42 ÷ 45)', [para[3], para[4]], ['45,0', '0,9']);
    r.ok('MSD sous 1 mois en rouge', await page.$$eval('tbody tr', (trs) => trs.find((t) => t.cells[0].textContent.startsWith('PARACETAMOL')).cells[4].style.color.includes('rouge')));
    await page.check('#aveugle');
    const cache = await page.$$eval('tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.trim())).find((x) => x[0].startsWith('PARACETAMOL')));
    r.check('comptage à l’aveugle : CMM gardée, MSD caché', [cache[3], cache[4]], ['45,0', '—']);
    await aller(page, 'stock');
    r.ok('Mon stock : colonne MSD', (await page.$$eval('thead th', (t) => t.map((x) => x.textContent.trim()))).includes('MSD'));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('MON STOCK et BASE — prix, valeur et prix propre à un programme gratuit', async (r) => {
  const prix = (db) => { db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente = 500; };
  const app = await ouvrir({ role: 'gerant', page: '#/stock', donnees: prix });
  try {
    const { page, db, erreurs } = app;
    r.ok('Mon stock : colonne « Valeur (F) » pour le gérant', (await page.$$eval('thead th', (ths) => ths.map((t) => t.textContent.trim()))).includes('Valeur (F)'));
    await page.click('[data-vue="2"]');
    const th = await page.$$eval('thead th', (ths) => ths.map((t) => t.textContent.trim()));
    r.ok('un seul programme : colonnes « Prix PNLP » et « Valeur (F) »', th.includes('Prix PNLP') && th.includes('Valeur (F)'), JSON.stringify(th));
    r.check('ACT ENFANT : 43 en stock × 500 F = 21 500 F', (await page.$eval('tbody tr.clic', (tr) => [tr.cells[2].textContent, tr.cells[3].textContent])).map(chiffres), ['500', '21500']);
    r.ok('total « VALEUR DU STOCK AFFICHÉ »', chiffres(await page.$eval('tbody', (b) => b.textContent)).includes('VALEURDUSTOCKAFFICHÉ21500'));

    await aller(page, 'base');
    r.ok('Base : colonne « Valeur PNLP » pour le programme gratuit', (await page.$eval('#contenu', (c) => c.textContent)).includes('Valeur PNLP'));
    r.check('valeur PNLP pré-remplie', await page.$eval('[data-prix-origine="2:2"]', (i) => i.value), '500');
    await page.fill('[data-prix-origine="2:2"]', '650');
    await page.press('[data-prix-origine="2:2"]', 'Tab');
    await page.waitForFunction(() => document.querySelector('[data-prix-origine="2:2"]').style.background !== '');
    r.check('valeur PNLP enregistrée', db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente, 650);
    r.check('prix de vente normal inchangé', db.produits.find((p) => p.id === 2).prix_vente, 700);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }

  const agent = await ouvrir({ role: 'vendeur', page: '#/stock', donnees: prix });
  try {
    r.ok('agent : Mon stock sans prix ni valeur', !(await agent.page.$$eval('thead th', (ths) => ths.map((t) => t.textContent)).then((l) => l.some((x) => /Valeur|Prix/.test(x)))));
    r.check('agent : aucune erreur JavaScript', agent.erreurs, []);
  } finally { await agent.fermer(); }
});
