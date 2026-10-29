// « Bénéfices et stock » (Point général) : un seul écran, avec en haut le choix du programme.
// Vente et PHPSP : bénéfices (jour, mois, année), puis stock valorisé ; programme gratuit : ce qui a été donné, puis stock.
// Prix par programme dans la Base ; colonnes Prix et Valeur dans Mon stock (jamais pour un simple agent).
const { ouvrir, aller, lancerTest } = require('./helpers');

const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const chiffres = (t) => String(t).replace(/\s/g, '');
const appels = (etat, fn) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === fn).map((a) => a[2]);
// « titre → valeur » de chaque carte du n-ième bloc de chiffres
const cartes = (page, n = 0) => page.$$eval('.grid-kpi', (blocs, i) => [...blocs[i].querySelectorAll('.kpi')].map((k) => [k.querySelector('.t').textContent.trim(), k.querySelector('.v').textContent.replace(/\s/g, '')]), n);
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
  // 2 AMOXICILLINE périmées jetées (prix d'achat 60 F) : 120 F de pertes
  db.mouvements.push(mvt(90, 3, 1, 'perime', -2, 5));
  // ACT ENFANT au PNLP, valeur d'une unité 500 F : 50 avant le mois, +10, −7 donnés, −2 périmés
  db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente = 500;
  db.mouvements.push(mvt(91, 2, 2, 'entree', 50, 40 * 24 * 60), mvt(92, 2, 2, 'entree', 10, 20), mvt(93, 2, 2, 'distribution', -7, 15), mvt(94, 2, 2, 'perime', -2, 10));
}

async function ouvrirEcran(role) {
  const app = await ouvrir({ role, page: '#/point', donnees });
  await app.page.click('[data-vue="resultats"]');
  await app.page.waitForFunction(() => document.querySelector('#contenu h1')?.textContent.trim() === 'Bénéfices et stock');
  return app;
}
const choisir = async (page, id, titre) => {
  await page.click(`.origines [data-filtre="${id}"]`);
  await page.waitForFunction((t) => document.querySelector('#contenu').textContent.includes(t), titre);
};

lancerTest('BÉNÉFICES ET STOCK — un seul écran, le filtre « Tout » d’abord', async (r) => {
  const app = await ouvrirEcran('gerant');
  try {
    const { page, erreurs } = app;
    r.check('un seul bouton pour les deux (plus de vues séparées)', await page.$$eval('[data-vue]', (b) => b.map((x) => x.dataset.vue)), ['vente', '5', 'resultats']);
    r.check('filtre en haut : Tout, Vente et chaque programme', await page.$$eval('.origines [data-filtre]', (b) => b.map((x) => x.querySelector('strong').textContent)), ['Tout', 'Vente', 'PNLP', 'GRAT', 'PF', 'PHPSP']);
    r.check('« Tout » : bénéfice de chaque programme vendu, et valeurs du stock', await cartes(page, 0), [
      // reste : PNLP 51 × 500 + Vente 44 × 25 (paracétamol) − 2 × 100 (amoxicilline jetée sans entrée enregistrée)
      ['Bénéfice Vente', '310'], ['Bénéfice PHPSP', '50'], ['Valeur sortie', '3500'], ['Valeur du stock restant', '26400']
    ]);
    const recap = await page.$$eval('tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.trim().replace(/\s+/g, ' '))));
    r.check('récapitulatif : une ligne par programme et le total du stock', recap.length, 6);
    r.ok('PNLP : pas de bénéfice, mais sa valeur restante (51 × 500)', recap[1][0].includes('PNLP') && recap[1][3] === '—' && chiffres(recap[1][8]) === '25500', JSON.stringify(recap[1]));
    // Un clic sur une ligne choisit le programme
    await page.click('tbody tr[data-filtre="2"]');
    await page.waitForFunction(() => document.querySelector('.origines [data-filtre="2"]').classList.contains('on-v'));
    r.ok('clic sur la ligne PNLP : filtre PNLP', true);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('BÉNÉFICES ET STOCK — Vente : bénéfices puis stock', async (r) => {
  const app = await ouvrirEcran('gerant');
  try {
    const { page, etat, erreurs } = app;
    await choisir(page, 1, 'Bénéfices Vente en un coup');
    r.check('en un coup d’œil : aujourd’hui, 7 jours, mois, année', (await cartes(page, 0)).map(([t]) => t), ["Aujourd'hui", '7 derniers jours', 'Ce mois', 'Cette année']);
    r.check('bénéfice d’aujourd’hui = 310 F (450 de ventes − 140 de coût)', (await cartes(page, 0))[0][1], '310');
    r.check('chiffres de la période (Ce mois)', await cartes(page, 1), [
      ['Ventes', '450'], ["Coût d'achat", '140'], ['Bénéfice', '310'], ['Pertes', '120'], ['Bénéfice net', '190'], ['Vendu à crédit', '300']
    ]);
    r.ok('les pertes sont retranchées : 190 F net', chiffres(await page.$eval('.grid-kpi .kpi', (k) => k.textContent)).includes('120depertes=190net'));
    const jours = await lignesDe(page, 'jours');
    r.ok('jour par jour : une ligne aujourd’hui et le total', jours.length === 2 && jours[0][1] === '450' && jours[0][3] === '310' && jours[1][0] === 'TOTAL', JSON.stringify(jours));
    const produits = await lignesDe(page, 'produits');
    r.check('produits classés par bénéfice', produits.map((x) => [x[0], x[4]]), [['AMOXICILLINE500MGGEL', '180'], ['SROSACHET', '100'], ['PARACETAMOL500MGCP', '30']]);
    r.ok('SRO SACHET : prix d’achat manquant signalé, avec lien vers la Base', produits[1][6].includes('Prixd’achatmanquant') && !!(await page.$('a[href="#/base?rech=SRO%20SACHET"]')));
    r.check('stock de la Vente sous les bénéfices', await page.$eval('[data-bloc="stock"] h2', (h) => h.textContent), 'Vente (produits recouvrables) : stock et valeurs');
    r.check('bénéfices demandés pour la Vente seulement', appels(etat, 'benefices').map((a) => a.p_programme), [1, 5, 1, 1]);

    // Un mois précis : tout l'écran suit
    await page.fill('#mois-choisi', '2025-01');
    await page.waitForFunction(() => document.querySelector('#contenu').textContent.includes('Janvier 2025'));
    r.ok('janvier 2025 demandé pour les bénéfices et le stock', appels(etat, 'benefices').some((a) => a.p_debut === '2025-01-01' && a.p_fin === '2025-02-01' && a.p_programme === 1)
      && appels(etat, 'stock_valeurs').some((a) => a.p_debut === '2025-01-01'));
    r.ok('mois sans vente : message clair', (await page.$eval('#contenu', (c) => c.textContent)).includes('Aucune vente sur cette période.'));
    await page.click('[data-p="annee"]');
    await page.waitForFunction(() => document.querySelector('[data-p="annee"]').classList.contains('on'));
    r.ok('« Cette année » : depuis le 1er janvier', appels(etat, 'benefices').pop().p_debut === new Date().getFullYear() + '-01-01');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('BÉNÉFICES ET STOCK — PHPSP à part, programme gratuit sans bénéfice', async (r) => {
  const app = await ouvrirEcran('gerant');
  try {
    const { page, erreurs } = app;
    await choisir(page, 5, 'Bénéfices PHPSP en un coup');
    r.check('PHPSP : son propre bénéfice (150 − 100)', (await cartes(page, 0))[0][1], '50');
    r.ok('PHPSP : rappel que les recettes sont à reverser', (await page.$eval('#contenu', (c) => c.textContent)).includes('à reverser'));
    r.check('PHPSP : seul son produit', (await lignesDe(page, 'produits')).map((x) => x[0]), ['PARACETAMOL500MGCP']);

    await choisir(page, 2, 'programme gratuit');
    r.ok('PNLP : aucun bloc de bénéfices', !(await page.$('[data-bloc="jours"]')) && !(await page.$('[data-bloc="produits"]')));
    r.check('PNLP : valeur donnée, reçue, restante', await cartes(page, 0), [['Valeur donnée', '3500'], ['Valeur reçue', '5000'], ['Valeur du stock restant', '25500']]);
    r.check('colonnes du stock d’un programme gratuit', await page.$$eval('[data-bloc="stock"] thead th', (ths) => ths.map((t) => t.textContent.trim())),
      ['Produit', 'Valeur PNLP', 'Début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Reste', 'Valeur sortie', 'Valeur restante']);
    const act = await lignesDe(page, 'stock');
    r.check('ACT ENFANT : 500, début 50, entrées 10, sorties 7, pertes 2, reste 51, valeurs 3 500 et 25 500', act[0].slice(1), ['500', '50', '10', '7', '2', '51', '3500', '25500']);
    r.check('total du programme', act[act.length - 1].slice(-2), ['3500', '25500']);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('BÉNÉFICES ET STOCK — le responsable les voit, un agent jamais', async (r) => {
  const resp = await ouvrirEcran('responsable');
  try {
    r.check('responsable : écran affiché, bénéfice de la Vente', (await cartes(resp.page, 0))[0], ['Bénéfice Vente', '310']);
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
