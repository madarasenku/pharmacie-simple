// Fiches PNLP du district (Programmes → PNLP) : RAPPORT-COMMANDE MENSUEL ESPC, IDE et ASC comme sur le papier,
// quantité allouée corrigée à la main, TDR et gouttes épaisses gardés, rapport de chaque ASC, remises aux ASC,
// lignes reliées aux produits par le gérant. Les calculs eux-mêmes sont testés sur PostgreSQL (tests/sql/scenario.sql).
const { ouvrir, aller, toast, lancerTest } = require('./helpers');

const appels = (etat, fn) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === fn).map((a) => a[2]);
const lettres = (page) => page.$$eval('.tbl.fiche thead .lettre', (s) => s.map((x) => x.textContent.trim()));
const ligne = (page, k) => page.$eval(`tr[data-ligne="${k}"]`, (tr) => ({ classe: tr.className, cellules: [...tr.cells].map((c) => c.textContent.trim()) }));
const moisCourant = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; };
// L'impression est interceptée : on garde ce qui serait imprimé
const sansImpression = () => { window.print = () => { window.__imprime = document.getElementById('print-root').innerHTML; }; };

async function ouvrirFiche(page, vue) {
  await aller(page, 'programmes');
  await page.click(`[data-vue="${vue}"]`);
  await page.waitForSelector('.fiche-pnlp, #asc-ajouter, [data-rq]');
}

lancerTest('FICHES PNLP — ESPC : colonnes du papier, commande urgente, quantité corrigée, TDR gardés', async (r) => {
  const app = await ouvrir({ role: 'gerant', avantChargement: sansImpression });
  try {
    const { page, etat, erreurs } = app;
    await aller(page, 'programmes');
    r.check('onglets des fiches sur le PNLP', await page.$$eval('[data-vue]', (b) => b.map((x) => x.textContent.trim())),
      ['Compte rendu', 'Fiche ESPC', 'Fiche IDE', 'Fiche ASC', 'ASC : remises']);
    await ouvrirFiche(page, 'ESPC');
    r.check('appel fiche_pnlp ESPC du mois', appels(etat, 'fiche_pnlp').pop(), { p_fiche: 'ESPC', p_mois: moisCourant() });
    r.check('lettres et formules de la fiche ESPC', await lettres(page), ['A', 'B', 'C', 'D', 'E=A+B-C+/-D', 'F', 'G', 'H', 'I=(C+G+H)/3', 'J=E/I', 'K=I*Max-E']);
    const entetes = await page.$$eval('.tbl.fiche thead th', (t) => t.map((x) => x.childNodes[0].textContent.trim()));
    r.check('colonnes dans l’ordre du papier', entetes, ['Désignation', 'Code', 'Unité', 'Stock initial', 'Quantité reçue du DS', 'Quantité distribuée aux ASC', 'Quantité dispensée',
      'Pertes et ajustements', 'Stock disponible', 'Nombre de jours de rupture', 'Consom mensuelle M-2', 'Consom mensuelle M-1', 'CMM (consommation mensuelle moyenne)', 'MSD',
      'Quantités allouée par le DS', 'Commentaires']);
    r.ok('niveaux Max 2 · Min 1 · commande urgente 0,5', (await page.$eval('.fiche-pnlp .card-head', (h) => h.textContent)).includes('maximum 2 · minimum 1 · point de commande urgente 0,5'));
    const l2 = await ligne(page, 'l2');
    r.ok('MSD sous 0,5 : ligne en commande urgente', l2.classe.includes('niv-urgent') && l2.cellules[0].includes('Commande urgente'), JSON.stringify(l2));
    r.check('chiffres A à J de la ligne', l2.cellules.slice(3, 14), ['10', '0', '2', '8', '0', '2', '3', '7', '9', '8', '0,3']);
    r.check('quantité allouée pré-remplie avec le calcul', await page.$eval('[data-q="l2"]', (i) => i.value), '14');
    r.ok('fiche marquée URGENT', !!(await page.$('#fiche-urgent')));
    const sro = await ligne(page, 'l3');
    r.ok('produit d’un autre programme compté (SRO de REC)', sro.cellules[0].includes('SRO SACHET · REC') && sro.cellules[7] === '−2', JSON.stringify(sro));
    const vide = await page.$$eval('tr[data-ligne="l1"] td.vide', (t) => t.length);
    r.ok('ligne sans produit : cases vides, à remplir à la main', vide === 12, String(vide));
    r.ok('le gérant peut créer les produits manquants', (await page.$eval('#creer-produits', (b) => b.textContent)).includes('Créer les 2 produit(s) manquant(s)'));

    // Correction de la quantité, commentaires, TDR et gouttes épaisses
    await page.fill('[data-q="l2"]', '20');
    await page.fill('[data-com="l2"]', 'Rupture au village');
    await page.fill('#tdr-r', '30');
    await page.fill('#tdr-p', '8');
    await page.fill('#ge-r', '5');
    await page.fill('#ge-p', '1');
    await page.fill('#commentaire', 'Livraison attendue');
    await page.click('#fiche-enregistrer');
    await toast(page, 'Fiche ESPC enregistrée');
    r.check('enregistrer_fiche : seule la quantité changée est gardée', appels(etat, 'enregistrer_fiche').pop(), { p: {
      fiche: 'ESPC', mois: moisCourant(), tdr_realises: '30', tdr_positifs: '8', ge_realisees: '5', ge_positives: '1', commentaire: 'Livraison attendue',
      lignes: { l2: { q: 20, com: 'Rupture au village' } } } });
    await page.waitForSelector('[data-q="l2"]');
    r.check('après enregistrement : la quantité corrigée reste', await page.$eval('[data-q="l2"]', (i) => i.value), '20');
    r.ok('le calcul reste visible à côté', (await page.$eval('[data-q="l2"]', (i) => i.closest('td').textContent)).includes('calcul : 14'));
    r.check('TDR relus', await page.$eval('#tdr-r', (i) => i.value), '30');

    // Impression : le formulaire du district
    await page.click('#fiche-imprimer');
    await page.waitForFunction(() => window.__imprime);
    const imprime = await page.evaluate(() => window.__imprime.replace(/\s+/g, ' '));
    r.ok('imprimé : titre, en-tête et niveaux', ['RAPPORT-COMMANDE MENSUEL ESPC', 'Région Sanitaire', 'SUD COMOÉ', 'GRAND-BASSAM', 'CSR TEST', 'Niveau de stock Maximum', 'Point de Commande Urgente'].every((t) => imprime.includes(t)), imprime.slice(0, 300));
    r.ok('imprimé : formules et pied du formulaire', ['E=A+B-C+/-D', 'K=I*Max-E', 'Nombre de TDR réalisés', 'Nombre de Goutte Epaisse positive', 'gestionnaire de la pharmacie du centre', 'Responsable du centre'].every((t) => imprime.includes(t)));
    r.ok('imprimé : case « Urgent » cochée', /Urgent <span class="fd-case">X<\/span>/.test(imprime));

    const [fichier] = await Promise.all([page.waitForEvent('download'), page.click('#fiche-csv')]);
    const contenu = require('fs').readFileSync(await fichier.path(), 'utf8');
    r.ok('export Excel : colonnes avec leurs lettres', contenu.includes('Stock disponible (E=A+B-C+/-D)') && contenu.includes('Quantités allouée par le DS (K=I*Max-E)') && contenu.includes(';-2;'), contenu.slice(0, 300));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('FICHES PNLP — IDE et ASC : colonnes propres à chaque fiche, rapport d’un ASC', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page, etat, erreurs } = app;
    await ouvrirFiche(page, 'IDE');
    r.check('lettres et formules de la fiche IDE', await lettres(page), ['A', 'B', 'C', 'D', 'E', 'F=A+B-C-D+/-E', 'G', 'H', 'I', 'J=(D+H+I)/3', 'K=F/J', 'L=Σ QtA ASC']);
    r.check('IDE : les lignes de la fiche IDE seulement', await page.$$eval('tr[data-ligne]', (t) => t.map((x) => x.dataset.ligne)), ['l1', 'l2', 'l4']);
    r.ok('IDE : quantité à allouer aux ASC', (await page.$eval('.tbl.fiche thead', (t) => t.textContent)).includes('Quantités à allouer aux ASC'));

    await page.click('[data-vue="ASC"]');
    await page.waitForSelector('#fiche-asc');
    r.check('lettres et formules de la fiche ASC', await lettres(page), ['A', 'B', 'C', 'D', 'E=A+B-C-D', 'F', 'G', 'H', 'I=(C+G+H)/3', 'J=E/I', 'K=I*Max-E']);
    r.ok('ASC : maximum 1,5 et nombre d’ASC', (await page.$eval('.fiche-pnlp .card-head', (h) => h.textContent)).includes('maximum 1,5 · minimum 1 · point de commande urgente 0,5') &&
      (await page.$eval('.fiche-pnlp .card-head', (h) => h.textContent)).includes('1 ASC'));
    r.ok('ASC : pas de gouttes épaisses', !(await page.$('#ge-r')));

    // Rapport d'AYA : ce qu'elle a dispensé ; le stock disponible se recalcule pendant la frappe
    await page.selectOption('#fiche-asc', '1');
    await page.waitForSelector('[data-c="l2"]');
    r.check('appel pour un seul ASC', appels(etat, 'fiche_pnlp').pop(), { p_fiche: 'ASC', p_mois: moisCourant(), p_asc: 1 });
    r.ok('saisie : stock initial, dispensé, pertes, jours de rupture', !!(await page.$('[data-si="l2"]')) && !!(await page.$('[data-d="l2"]')) && !!(await page.$('[data-f="l2"]')) && !(await page.$('[data-q="l2"]')));
    await page.fill('[data-c="l2"]', '6');
    r.check('E = A + B − C − D recalculé (5 + 2 − 6)', await page.$eval('[data-e="l2"]', (t) => t.textContent), '1');
    r.check('K recalculé : (6 + 4 + 2) / 3 × 1,5 − 1 = 5', await page.$eval('[data-kq="l2"]', (t) => t.textContent), '5');
    await page.fill('#tdr-r', '12');
    await page.fill('#tdr-p', '4');
    await page.click('#fiche-enregistrer');
    await toast(page, 'Rapport de AYA KOUASSI enregistré');
    const envoi = appels(etat, 'saisir_asc').pop().p;
    r.check('saisir_asc : l’ASC, le mois, les TDR', [envoi.asc_id, envoi.mois, envoi.tdr_realises, envoi.tdr_positifs], [1, moisCourant(), '12', '4']);
    r.check('saisir_asc : la ligne saisie', envoi.lignes.l2, { si: '', c: '6', d: '', f: '' });
    r.ok('ligne sans produit : rien à saisir', !envoi.lignes.l1);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('FICHES PNLP — agent de santé : remettre aux ASC, ajouter un ASC, pas de réglage des lignes', async (r) => {
  const app = await ouvrir({ role: 'vendeur' });
  try {
    const { page, etat, db, erreurs } = app;
    await ouvrirFiche(page, 'agents');
    const agents = await page.$$eval('.card:first-child tbody tr', (t) => t.map((x) => x.cells[0].textContent.trim()));
    r.check('liste des ASC (désactivé signalé)', agents, ['AYA KOUASSI', 'BAMBA ALI désactivé']);
    r.check('seuls les ASC actifs reçoivent', await page.$$eval('#remise-asc option', (o) => o.map((x) => x.textContent.trim())), ['— Choisir —', 'AYA KOUASSI · Ahouakro']);
    r.check('produits de la fiche ASC reliés, avec leur stock', await page.$$eval('[data-rq]', (i) => i.map((x) => x.dataset.rq)), ['2', '3']);

    await page.selectOption('#remise-asc', '1');
    await page.fill('[data-rq="2"]', '1000');
    await page.click('#remise-valider');
    await toast(page, 'Stock insuffisant pour ARTESUNATE/AMODIAQUINE 50');
    r.check('trop demandé : rien envoyé', appels(etat, 'remettre_asc').length, 0);
    await page.fill('[data-rq="2"]', '5');
    await page.click('#remise-valider');
    await toast(page, 'Remis à AYA KOUASSI : 5 unité(s)');
    r.check('remettre_asc : l’ASC et le produit de la fiche', appels(etat, 'remettre_asc').pop(), { p: { asc_id: 1, lignes: [{ produit_id: 2, programme_id: 2, quantite: 5 }] } });
    r.check('stock du centre diminué', db.lots.find((l) => l.id === 2).quantite, 38);
    await page.waitForFunction(() => document.body.textContent.includes('1 sortie(s) de stock'));
    r.ok('remise listée dans le mois', (await page.$eval('#vue-fiche', (v) => v.textContent)).includes('ARTESUNATE/AMODIAQUINE 50 / 135 mg'));

    await page.click('#asc-ajouter');
    await page.fill('#asc-nom', 'koné issa');
    await page.fill('#asc-loc', 'Mondoukou');
    await page.click('#asc-ok');
    await toast(page, 'ASC enregistré');
    r.check('enregistrer_asc envoyé', appels(etat, 'enregistrer_asc').pop(), { p: { id: null, nom: 'koné issa', localite: 'Mondoukou', telephone: '', actif: true } });
    await page.waitForFunction(() => document.body.textContent.includes('KONÉ ISSA'));
    r.ok('nouvel ASC dans la liste', true);

    await page.click('[data-vue="ESPC"]');
    await page.waitForSelector('.fiche-pnlp');
    r.ok('agent de santé : ni création de produits ni choix des produits reliés', !(await page.$('#creer-produits')) && !(await page.$('#mode-liens')));
    r.ok('agent de santé : il peut saisir la fiche', !!(await page.$('#fiche-enregistrer')));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('FICHES PNLP — gérant : relier une ligne, créer les produits manquants, code du district dans la Base', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page, etat, db, erreurs } = app;
    await ouvrirFiche(page, 'ESPC');
    await page.check('#mode-liens');
    await page.waitForSelector('[data-lier="1"]');
    const options = await page.$$eval('[data-lier="1"] option', (o) => o.map((x) => x.textContent.trim()));
    r.ok('choix : chaque produit dans chacune de ses origines, PNLP d’abord', options[0] === '— Aucun produit —' && options[1] === 'ACT ENFANT 1-5 ANS — PNLP' && options.includes('SRO SACHET — REC'), JSON.stringify(options));
    await page.selectOption('[data-lier="1"]', '1:1');
    await toast(page, 'Ligne reliée au produit');
    r.check('lier_ligne_fiche envoyé', appels(etat, 'lier_ligne_fiche').pop(), { p_ligne: 1, p_produit: 1, p_programme: 1 });

    await page.click('#creer-produits');
    await toast(page, '1 produit(s) créé(s) dans le PNLP');
    r.check('creer_produits_fiche envoyé', appels(etat, 'creer_produits_fiche').pop(), { p_lignes: null });
    await page.waitForFunction(() => !document.querySelector('#creer-produits'));
    r.ok('plus de ligne sans produit', true);

    // Code du district : saisi dans la Base, affiché sur la fiche
    await aller(page, 'base');
    await page.click('button[data-prod="2"]');
    await page.fill('#p-district', '30016');
    await page.click('#p-ok');
    await toast(page, 'Produit enregistré');
    r.check('code enregistré sur le produit', db.produits.find((p) => p.id === 2).code, '30016');
    // (attendre que la Base ait fini de se redessiner avant de la quitter)
    await page.waitForFunction(() => document.querySelector('button[data-prod="2"]')?.closest('tr').textContent.includes('Plaquette · code 30016'));
    r.ok('code affiché dans la Base, sous le nom', true);
    await ouvrirFiche(page, 'ESPC');
    r.check('code affiché sur la fiche', (await ligne(page, 'l2')).cellules[1], '30016');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});
