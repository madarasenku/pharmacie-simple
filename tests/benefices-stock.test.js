// Bénéfices (jour, mois, année) et stock valorisé par programme, pour le gérant et le responsable ;
// prix par programme dans la Base ; colonnes Prix et Valeur dans Mon stock (jamais pour un simple agent).
const { ouvrir, aller, lancerTest } = require('./helpers');

const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const chiffres = (t) => String(t).replace(/\s/g, '');
const appels = (etat, fn) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === fn).map((a) => a[2]);
// « titre → valeur » de chaque carte du premier bloc de chiffres
const cartes = (page, n = 0) => page.$$eval('.grid-kpi', (blocs, i) => [...blocs[i].querySelectorAll('.kpi')].map((k) => [k.querySelector('.t').textContent.trim(), k.querySelector('.v').textContent.replace(/\s/g, '')]), n);
const ligneVente = (id, programme_id, mode, lignes, extra = {}) => ({
  id, numero: 'T-' + id, programme_id, caisse_id: 1, mode_paiement: mode, total: 0, annulee: false, saisie_hors_ligne: false,
  created_at: ilYA(5), patient_nom: null, patient_sexe: 'NP', client_id: null, clients: null, ventes_lignes: lignes, ...extra
});
const ligne = (produit_id, quantite, prix_unitaire, cout_unitaire) => ({ produit_id, quantite, prix_unitaire, cout_unitaire, produits: { designation: '' } });

lancerTest('BÉNÉFICES — aujourd’hui, mois, année, produits et pertes', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    page: '#/point',
    donnees: (db) => {
      // Aujourd'hui, en plus de la vente de base (2 × 25 F, coûtant 10 F pièce : 30 F de bénéfice)
      db.ventes.push(
        ligneVente(2, 1, 'credit', [ligne(3, 3, 100, 40)]),   // 300 F de ventes à crédit, coût 120 F
        ligneVente(3, 1, 'especes', [ligne(4, 1, 100, 0)]),    // prix d'achat inconnu : bénéfice faux à signaler
        ligneVente(4, 2, 'gratuit', [ligne(2, 5, 0, 0)]),      // distribution gratuite : jamais un bénéfice
        ligneVente(5, 5, 'especes', [ligne(1, 10, 15, 10)]),   // PHPSP : à reverser, compté à part
        ligneVente(6, 1, 'especes', [ligne(1, 9, 25, 10)], { annulee: true }) // annulée : ignorée
      );
      // 2 AMOXICILLINE périmées jetées (prix d'achat 60 F) : 120 F de pertes
      db.mouvements.push({ id: 90, produit_id: 3, programme_id: 1, lot_id: 4, type: 'perime', quantite: -2, created_at: ilYA(5), produits: { designation: 'AMOXICILLINE 500 MG GEL' }, lots: null, profiles: { nom: 'GÉRANTE TEST' } });
    }
  });
  try {
    const { page, etat, erreurs } = app;
    r.ok('bouton « Bénéfices » dans le Point général', await page.$('[data-vue="benefices"]'));
    await page.click('[data-vue="benefices"]');
    await page.waitForSelector('#contenu h1');
    await page.waitForFunction(() => document.querySelector('#contenu h1').textContent.trim() === 'Bénéfices');
    r.check('en un coup d’œil : bénéfice d’aujourd’hui, 7 jours, mois, année', (await cartes(page, 0)).map(([t]) => t), ["Aujourd'hui", '7 derniers jours', 'Ce mois', 'Cette année']);
    r.check('bénéfice d’aujourd’hui = 310 F (450 de ventes − 140 de coût)', (await cartes(page, 0))[0][1], '310');
    r.check('chiffres de la période (Ce mois)', await cartes(page, 1), [
      ['Ventes', '450'], ["Coût d'achat", '140'], ['Bénéfice', '310'], ['Pertes', '120'], ['Bénéfice net', '190'], ['Vendu à crédit', '300']
    ]);
    const net = chiffres(await page.$eval('.grid-kpi .kpi', (k) => k.textContent));
    r.ok('les pertes sont retranchées : 190 F net', net.includes('120depertes=190net'), net);

    const jour = await page.evaluate(() => [...[...document.querySelectorAll('section.card')].find((x) => /par/.test(x.querySelector('h2').textContent)).querySelectorAll('tbody tr')].map((t) => t.textContent.replace(/\s/g, '')));
    r.ok('tableau jour par jour : une ligne pour aujourd’hui, avec son total', jour.length === 2 && jour[0].includes('450') && jour[0].includes('310') && jour[1].startsWith('TOTAL'), JSON.stringify(jour));

    const produits = await page.$$eval('section.card:last-of-type tbody tr', (trs) => trs.map((t) => [t.cells[0].textContent.trim(), t.cells[4].textContent.replace(/\s/g, ''), t.cells[6].textContent.trim()]));
    r.check('produits classés par bénéfice', produits.map((x) => [x[0], x[1]]), [['AMOXICILLINE 500 MG GEL', '180'], ['SRO SACHET', '100'], ['PARACETAMOL 500 MG CP', '30']]);
    r.ok('SRO SACHET : prix d’achat manquant signalé', produits[1][2].includes('Prix d’achat manquant'), produits[1][2]);
    r.ok('lien « Corriger » vers la Base filtrée', !!(await page.$('a[href="#/base?rech=SRO%20SACHET"]')));
    r.check('la distribution gratuite et le PHPSP ne sont pas comptés', produits.some((x) => /ACT ENFANT/.test(x[0])), false);

    // Un mois précis
    await page.fill('#mois-choisi', '2025-01');
    await page.waitForFunction(() => document.querySelector('#contenu').textContent.includes('Janvier 2025'));
    r.ok('période demandée au serveur : janvier 2025', appels(etat, 'benefices').some((a) => a.p_debut === '2025-01-01' && a.p_fin === '2025-02-01'), JSON.stringify(appels(etat, 'benefices')));
    r.ok('mois sans vente : message clair', (await page.$eval('#contenu', (c) => c.textContent)).includes('Aucune vente sur cette période.'));

    // Cette année : par mois
    await page.click('[data-p="annee"]');
    await page.waitForFunction(() => document.querySelector('[data-p="annee"]').classList.contains('on'));
    const an = new Date().getFullYear();
    r.check('cette année : du 1er janvier à demain', appels(etat, 'benefices').pop().p_debut, an + '-01-01');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('BÉNÉFICES — le responsable les voit, un agent jamais', async (r) => {
  const resp = await ouvrir({ role: 'responsable', page: '#/point' });
  try {
    await resp.page.click('[data-vue="benefices"]');
    await resp.page.waitForFunction(() => document.querySelector('#contenu h1')?.textContent.trim() === 'Bénéfices');
    r.check('responsable : bénéfice d’aujourd’hui (vente de base : 30 F)', (await cartes(resp.page, 0))[0][1], '30');
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

lancerTest('STOCK ET VALEURS — par programme, avec prix, sorties et reste', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    page: '#/point',
    donnees: (db) => {
      db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente = 500; // valeur d'une unité ACT pour le PNLP
      const m = (id, type, quantite, minutes) => ({ id, produit_id: 2, programme_id: 2, lot_id: 2, type, quantite, created_at: ilYA(minutes), produits: { designation: 'ACT ENFANT 1-5 ANS' }, lots: null, profiles: { nom: 'GÉRANTE TEST' } });
      db.mouvements.push(
        m(91, 'entree', 50, 40 * 24 * 60),     // avant le début du mois
        m(92, 'entree', 10, 20),               // ce mois-ci
        m(93, 'distribution', -7, 15),
        m(94, 'perime', -2, 10)
      );
    }
  });
  try {
    const { page, etat, erreurs } = app;
    await page.click('[data-vue="stock"]');
    await page.waitForFunction(() => document.querySelector('#contenu h1')?.textContent.trim() === 'Stock et valeurs');
    const recap = await page.$$eval('section.card tbody tr', (trs) => trs.map((t) => [t.cells[0].textContent.trim().split(/\s{2,}|\n/)[0], t.cells[t.cells.length - 1].textContent.replace(/\s/g, '')]));
    r.ok('récapitulatif : une ligne par programme et un total', recap.length === 6 && recap[5][0].startsWith('TOTAL'), JSON.stringify(recap));
    r.check('valeur du stock restant, tous programmes (PNLP 51 × 500 + Vente 44 × 25)', (await cartes(page, 0))[0], ['Valeur du stock restant', '26600']);
    r.check('valeur sortie sur la période (7 × 500)', (await cartes(page, 0))[1], ['Valeur sortie', '3500']);

    await page.click('section.card .chip[data-prog="2"]');
    await page.waitForFunction(() => document.querySelector('section.card h2').textContent.includes('Paludisme'));
    const entetes = await page.$$eval('section.card thead th', (ths) => ths.map((t) => t.textContent.trim()));
    r.check('colonnes du programme gratuit', entetes, ['Produit', 'Valeur PNLP', 'Début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Reste', 'Valeur sortie', 'Valeur restante']);
    const act = await page.$$eval('section.card tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.replace(/\s/g, ''))));
    r.check('ACT ENFANT : prix 500, début 50, entrées 10, sorties 7, pertes 2, reste 51, valeurs 3 500 et 25 500',
      act[0].slice(1), ['500', '50', '10', '7', '2', '51', '3500', '25500']);
    r.check('total du programme', act[act.length - 1].slice(-2), ['3500', '25500']);
    r.check('le serveur reçoit le début du mois et demain', appels(etat, 'stock_valeurs').pop().p_debut, new Date().toISOString().slice(0, 8) + '01');

    // Mois passé : le stock de cette époque, rien n'était encore arrivé en janvier 2025
    await page.fill('#mois-choisi', '2025-01');
    await page.waitForFunction(() => document.querySelector('#contenu').textContent.includes('Janvier 2025'));
    r.ok('mois sans mouvement : message clair', (await page.$eval('#contenu', (c) => c.textContent)).includes('Aucun mouvement ni stock pour PNLP'));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('MON STOCK et BASE — prix, valeur et prix propre à un programme gratuit', async (r) => {
  const donnees = (db) => { db.produits_programmes.find((l) => l.produit_id === 2 && l.programme_id === 2).prix_vente = 500; };
  const app = await ouvrir({ role: 'gerant', page: '#/stock', donnees });
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

  const agent = await ouvrir({ role: 'vendeur', page: '#/stock', donnees });
  try {
    r.ok('agent : Mon stock sans prix ni valeur', !(await agent.page.$$eval('thead th', (ths) => ths.map((t) => t.textContent)).then((l) => l.some((x) => /Valeur|Prix/.test(x)))));
    r.check('agent : aucune erreur JavaScript', agent.erreurs, []);
  } finally { await agent.fermer(); }
});
