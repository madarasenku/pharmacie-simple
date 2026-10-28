// Rapport district : correction de quantité partagée (serveur), enregistrement de la
// commande envoyée, suivi (reste à recevoir), réception à l'Entrée de stock.
const { ouvrir, aller, toast, lancerTest, dansJours } = require('./helpers');

lancerTest('RAPPORT — correction, commande envoyée, annulation', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    avantChargement: () => localStorage.setItem('rapport-district-2026-01', JSON.stringify({ 3: 7 }))
  });
  try {
    const { page, etat, db, erreurs } = app;
    await aller(page, 'rapport');
    const anciennes = etat.appels.filter((a) => a[0] === 'rpc' && a[1] === 'corriger_quantite_rapport').map((a) => a[2]);
    r.check('anciennes corrections du navigateur reprises sur le serveur', anciennes, [{ p_programme: 1, p_mois: '2026-01-01', p_produit: 3, p_quantite: 7 }]);
    r.check('puis effacées du navigateur', await page.evaluate(() => localStorage.getItem('rapport-district-2026-01')), null);

    await page.fill('[data-q="1"]', '60');
    await page.press('[data-q="1"]', 'Tab');
    await page.waitForFunction(() => document.querySelector('[data-q="1"]')?.title.includes('48'));
    const derniere = etat.appels.filter((a) => a[1] === 'corriger_quantite_rapport').pop()[2];
    r.check('correction envoyée au serveur', [derniere.p_produit, derniere.p_quantite], [1, 60]);
    r.ok('case corrigée en jaune, calcul rappelé', (await page.$eval('[data-q="1"]', (i) => i.getAttribute('style') + i.title)).includes('FFF0CC'));
    r.check('total recalculé', await page.$eval('#total', (t) => t.textContent.replace(/\s/g, '')), '600');

    await page.click('#envoyer');
    await page.fill('.modal #note', 'WhatsApp');
    await page.click('.modal #ok');
    await toast(page, 'enregistrée');
    const cmd = etat.appels.find((a) => a[1] === 'enregistrer_commande')[2].p;
    r.check('commande : seulement les produits à commander, quantité corrigée', cmd.lignes, [{ produit_id: 1, quantite: 60, prix_unitaire: 10 }]);
    r.check('commande : mois du rapport', cmd.mois.slice(8), '01');
    r.ok('commande listée « Envoyée »', (await page.$eval('#contenu', (c) => c.textContent)).includes('Envoyée'));

    // Deuxième commande le même mois : on demande confirmation
    await page.click('#envoyer');
    r.ok('avertissement « déjà une commande ce mois »', (await page.$eval('.modal', (m) => m.textContent)).includes('existe déjà'));
    await page.click('.modal [data-non]');

    await page.click('[data-commande]');
    await page.click('.modal #annuler');
    await page.click('.modal [data-oui]');
    await toast(page, 'Commande annulée');
    r.check('commande annulée côté serveur', db.commandes[0].statut, 'annulee');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('ENTRÉE — réception d’une commande', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      db.commandes.push({ id: 1, numero: 'CMD-2026-10-001', programme_id: 1, mois: '2026-10-01', statut: 'partielle', total: 600, created_at: new Date().toISOString(),
        commandes_lignes: [{ produit_id: 1, quantite: 60, prix_unitaire: 10, recu: 20, produits: { designation: 'PARACETAMOL 500 MG CP' } }] });
    }
  });
  try {
    const { page, etat } = app;
    await aller(page, 'entree');
    await page.fill('#code', '6000000000028');
    await page.press('#code', 'Enter');
    await page.waitForSelector('#commande');
    const option = await page.$eval('#commande', (s) => s.options[s.selectedIndex].textContent);
    r.ok('commande ouverte proposée d’office avec le reste (40)', option.includes('CMD-2026-10-001') && option.includes('reste 40'), option);
    await page.fill('#qte', '40');
    await page.fill('#per', dansJours(30));
    await page.click('#ajouter');
    await page.waitForSelector('.modal');
    r.ok('péremption proche : confirmation demandée', (await page.$eval('.modal', (m) => m.textContent)).includes('périme dans'));
    await page.click('.modal [data-oui]');
    await toast(page, 'ajouté(s) au stock');
    const envoi = etat.appels.find((a) => a[1] === 'enregistrer_entree')[2].p;
    r.check('entrée rattachée à la commande', [envoi.commande_id, envoi.quantite], [1, 40]);

    // Date passée : refusée sans rien envoyer
    await page.fill('#code', '6000000000028');
    await page.press('#code', 'Enter');
    await page.fill('#qte', '1');
    await page.fill('#per', dansJours(-1));
    await page.click('#ajouter');
    await toast(page, 'déjà passée');
    r.check('lot déjà périmé : rien d’envoyé', etat.appels.filter((a) => a[1] === 'enregistrer_entree').length, 1);
  } finally { await app.fermer(); }
});
