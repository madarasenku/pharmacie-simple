// Programme recouvrable PHPSP : vendu au comptoir à son propre prix, payé (caisse), compté dans
// son propre point, jamais mélangé au point normal ; prix PHPSP et type réglables dans la Base.
const { ouvrir, aller, lancerTest } = require('./helpers');

lancerTest('PHPSP — vente au comptoir à son propre prix', async (r) => {
  const app = await ouvrir({ role: 'vendeur' });
  try {
    const { page, etat, erreurs } = app;
    const sous = await page.$eval('[data-origine="5"]', (b) => b.textContent.replace(/\s+/g, ' ').trim());
    r.ok('bouton PHPSP au comptoir, marqué payant', sous.includes('PHPSP') && sous.includes('payant'), sous);
    await page.click('[data-origine="5"]');
    r.ok('bouton PHPSP en bleu', await page.$eval('[data-origine="5"]', (b) => b.classList.contains('on-r')));
    const tuile = await page.$eval('[data-ajout="1"]', (t) => t.textContent);
    r.ok('prix PHPSP affiché (15 F, pas 25 F)', /15\s*F/.test(tuile) && !/25\s*F/.test(tuile), tuile);
    await page.click('[data-ajout="1"]');
    await page.fill('[data-qte="1"]', '3');
    await page.press('[data-qte="1"]', 'Tab');
    r.ok('modes de paiement proposés', await page.$('[data-mode="especes"]'));
    r.check('bouton « Encaisser » au prix PHPSP', (await page.$eval('#valider', (b) => b.textContent)).replace(/\s+/g, ' ').trim(), 'Encaisser 45 F');
    await page.click('#valider');
    await page.waitForSelector('.modal');
    const envoi = etat.appels.find((a) => a[1] === 'enregistrer_vente')[2].p;
    r.check('vente PHPSP payée en espèces', [envoi.programme_id, envoi.mode], [5, 'especes']);
    const ticket = await page.$eval('.modal', (m) => m.textContent);
    r.ok('reçu PHPSP avec le bon total', ticket.includes('PHPSP') && ticket.includes('recouvrables') && /45 F/.test(ticket), ticket.slice(0, 200));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('PHPSP — point séparé du point normal', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      db.ventes.push({ id: 2, numero: 'PHPSP-2026-00002', programme_id: 5, caisse_id: 1, mode_paiement: 'especes', total: 150, annulee: false,
        created_at: new Date().toISOString(), patient_sexe: 'NP', clients: null,
        ventes_lignes: [{ produit_id: 1, quantite: 10, prix_unitaire: 15, cout_unitaire: 10, produits: { designation: 'PARACETAMOL 500 MG CP' } }] });
    }
  });
  try {
    const { page, erreurs } = app;
    await aller(page, 'point');
    const normal = await page.$eval('#contenu', (c) => c.textContent.replace(/\s+/g, ' '));
    r.ok('Point PR.REC : seulement les produits recouvrables (50 F), pas les 150 F de PHPSP', normal.includes('Point PR.REC') && /Chiffre d'affaires\s*50\s*FCFA/.test(normal) && !/Chiffre d'affaires\s*150/.test(normal), normal.slice(0, 300));
    await page.click('[data-vue="5"]');
    await page.waitForSelector('h1:text("Point PHPSP")');
    const point = await page.$eval('#contenu', (c) => c.textContent.replace(/\s+/g, ' '));
    r.ok('point PHPSP : présenté comme le point PR.REC (chiffre d’affaires 150 F, 1 vente, bénéfice 50 F)', /Chiffre d'affaires\s*150\s*FCFA\s*·\s*1 vente/.test(point) && /Bénéfice estimé\s*50\s*FCFA/.test(point), point.slice(0, 400));
    r.ok('point PHPSP : détail par produit', point.includes('PARACETAMOL 500 MG CP') && point.includes('TOTAL ENCAISSÉ'));
    r.ok('point PHPSP imprimable', await page.$('#imprimer'));

    await aller(page, 'journee');
    const jour = await page.$eval('#contenu', (c) => c.textContent.replace(/\s+/g, ' '));
    r.ok('Ma journée : PHPSP compté à part', /Chiffre d'affaires \(REC\)\s*50\s*FCFA/.test(jour) && /Ventes PHPSP\s*150\s*FCFA/.test(jour), jour.slice(0, 400));
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('PHPSP — prix et type dans la Base', async (r) => {
  const app = await ouvrir({ role: 'gerant' });
  try {
    const { page, etat, db } = app;
    await aller(page, 'base');
    r.ok('programme PHPSP marqué « Recouvrable »', (await page.$eval('#contenu', (c) => c.textContent)).includes('Recouvrable (payant)'));
    r.check('colonne « Prix PHPSP » pré-remplie', await page.$eval('[data-prix-origine="1:5"]', (i) => i.value), '15');
    r.ok('pas de case de prix PHPSP pour un produit non rattaché', !(await page.$('[data-prix-origine="2:5"]')));
    await page.fill('[data-prix-origine="1:5"]', '18');
    await page.press('[data-prix-origine="1:5"]', 'Tab');
    await page.waitForFunction(() => document.querySelector('[data-prix-origine="1:5"]').style.background !== '');
    r.check('prix PHPSP enregistré', db.produits_programmes.find((l) => l.produit_id === 1 && l.programme_id === 5).prix_vente, 18);
    r.check('prix de la Vente inchangé', db.produits.find((p) => p.id === 1).prix_vente, 25);

    // nouveau programme recouvrable
    await page.click('#nv-prog');
    await page.fill('.modal #g-nom', 'Programme test');
    await page.fill('.modal #g-sigle', 'PTR');
    await page.selectOption('.modal #g-type', 'recouvrable');
    await page.click('.modal #g-ok');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const ajout = etat.appels.find((a) => a[0] === 'ajout' && a[1] === 'programmes')[2];
    r.check('programme créé recouvrable', [ajout.sigle, ajout.recouvrable], ['PTR', true]);
  } finally { await app.fermer(); }
});
