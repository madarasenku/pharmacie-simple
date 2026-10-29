// Journal des erreurs (gérant) : les anomalies des données nomment le produit et mènent à la page
// où les corriger ; les erreurs affichées aux agents arrivent dans le journal et se marquent « vues ».
const { ouvrir, aller, toast, lancerTest, UTILISATEURS } = require('./helpers');

const appels = (etat, fn) => etat.appels.filter((a) => a[0] === 'rpc' && a[1] === fn).map((a) => a[2]);
const pastille = (page) => page.$eval('nav.menu a[data-page="erreurs"] .pastille', (p) => (p.classList.contains('hidden') ? '' : p.textContent));

lancerTest('ERREURS — produit vendu sans prix : son nom, et la Base filtrée dessus', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      db.produits.find((p) => p.id === 4).prix_vente = 0; // SRO SACHET, coché Vente, sans prix
      db.erreurs.push({ id: 1, created_at: new Date().toISOString(), user_id: UTILISATEURS.vendeur.id, profiles: { nom: 'AWA VENDEUSE' },
        page: 'comptoir', message: 'Stock insuffisant pour SRO SACHET (2 manquant(s)).', details: {}, version: '1.7.0', appareil: 'Test', vu: false });
    }
  });
  try {
    const { page, etat, erreurs } = app;
    // Pastille : 1 prix manquant + 1 lot périmé (AMOXICILLINE) + 1 erreur pas encore vue
    await page.waitForFunction(() => !document.querySelector('nav.menu a[data-page="erreurs"] .pastille').classList.contains('hidden'));
    r.check('pastille rouge sur l’onglet Erreurs', await pastille(page), '3');

    await aller(page, 'erreurs');
    const texte = await page.$eval('#contenu', (c) => c.textContent.replace(/\s+/g, ' '));
    r.ok('anomalie « Produit à vendre sans prix de vente » avec le nom du produit', texte.includes('Produit à vendre sans prix de vente') && texte.includes('SRO SACHET — Vente'), texte.slice(0, 400));
    r.ok('lot périmé nommé aussi', texte.includes('Lot périmé encore en stock') && texte.includes('AMOXICILLINE 500 MG GEL'));
    r.ok('erreur de l’agent : message, nom et page', texte.includes('Stock insuffisant pour SRO SACHET') && texte.includes('AWA VENDEUSE') && texte.includes('comptoir'));
    r.ok('compteur « À corriger vite » = 2', /À corriger vite\s*2/.test(texte), texte.slice(0, 300));
    const lien = await page.$eval('.anomalie a[href^="#/base"]', (a) => [a.getAttribute('href'), a.textContent.trim()]);
    r.check('bouton « Corriger » vers la Base filtrée sur le produit', lien, ['#/base?rech=SRO%20SACHET', 'Corriger · Base']);

    await page.click('.anomalie a[href^="#/base"]');
    await page.waitForSelector('#contenu[data-pret="base"]');
    r.check('la Base s’ouvre avec le nom dans la recherche', await page.$eval('#rech', (i) => i.value), 'SRO SACHET');
    const lignes = await page.$$eval('[data-prod]', (b) => b.map((x) => x.closest('tr').textContent));
    r.ok('seul ce produit est affiché', lignes.length === 1 && lignes[0].includes('SRO SACHET'), JSON.stringify(lignes));
    const alerte = await page.$eval('#contenu', (c) => c.textContent.replace(/\s+/g, ' '));
    r.ok('la Base nomme le produit sans prix', alerte.includes('1 produit à vendre n’a pas de prix de vente : SRO SACHET'), alerte.slice(0, 500));

    // Depuis la Base normale, le bouton « Afficher seulement ceux-là » garde seulement les produits sans prix
    await aller(page, 'base');
    r.check('Base sans filtre : tous les produits', (await page.$$('[data-prod]')).length, 4);
    await page.click('#sans-prix');
    const seuls = await page.$$eval('[data-prod]', (b) => b.map((x) => x.closest('tr').textContent));
    r.ok('« Afficher seulement ceux-là » : SRO SACHET seul', seuls.length === 1 && seuls[0].includes('SRO SACHET'), JSON.stringify(seuls));

    // Erreur réglée : « Vue »
    await aller(page, 'erreurs');
    await page.click('[data-vu="1"]');
    await toast(page, 'Erreur marquée comme vue');
    r.check('marquer_erreurs_vues envoyé pour cette erreur', appels(etat, 'marquer_erreurs_vues').pop(), { p_ids: [1] });
    r.ok('l’erreur vue disparaît de la liste', (await page.$$('[data-vu]')).length === 0);
    await page.waitForFunction(() => document.querySelector('nav.menu a[data-page="erreurs"] .pastille').textContent === '2');
    r.ok('pastille mise à jour (2 anomalies restantes)', true);
    await page.check('#voir-vues');
    await page.waitForFunction(() => document.querySelector('#contenu').textContent.includes('Stock insuffisant pour SRO SACHET'));
    r.ok('« Afficher aussi les erreurs déjà vues » la remontre', true);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('ERREURS — rien à corriger, « Tout marquer comme vu »', async (r) => {
  const app = await ouvrir({
    role: 'gerant',
    donnees: (db) => {
      db.lots = db.lots.filter((l) => l.id !== 4); // plus de lot périmé
      for (const i of [1, 2]) db.erreurs.push({ id: i, created_at: new Date().toISOString(), user_id: UTILISATEURS.vendeur.id, profiles: { nom: 'AWA VENDEUSE' }, page: 'journee', message: 'Erreur ' + i, details: {}, vu: false });
    }
  });
  try {
    const { page, etat, erreurs } = app;
    await aller(page, 'erreurs');
    r.ok('« Rien à corriger » quand les données sont cohérentes', await page.$eval('#contenu', (c) => c.textContent.includes('Rien à corriger')));
    await page.click('#tout-vu');
    await toast(page, '2 erreurs marquées comme vues');
    r.check('marquer_erreurs_vues envoyé pour toutes', appels(etat, 'marquer_erreurs_vues').pop(), { p_ids: null });
    r.ok('liste vide ensuite', await page.$eval('#contenu', (c) => c.textContent.includes('Aucune nouvelle erreur')));
    r.check('pastille cachée', await pastille(page), '');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('ERREURS — une erreur affichée à un agent part dans le journal du gérant', async (r) => {
  const app = await ouvrir({ role: 'vendeur', rpc: { enregistrer_vente: () => { throw new Error('Stock insuffisant pour PARACETAMOL 500 MG CP (2 manquant(s)).'); } } });
  try {
    const { page, etat, db, erreurs } = app;
    r.ok('pas d’onglet Erreurs pour un vendeur', !(await page.$('nav.menu a[data-page="erreurs"]')));
    r.check('le vendeur ne demande jamais les anomalies', appels(etat, 'anomalies').length, 0);
    await page.click('[data-ajout="1"]');
    await page.click('#valider');
    await toast(page, 'Stock insuffisant');
    for (let i = 0; i < 50 && !db.erreurs.length; i++) await page.waitForTimeout(50);
    const e = db.erreurs[0] || {};
    r.check('erreur enregistrée : page, message, qui', [e.page, e.message, e.user_id], ['comptoir', 'Stock insuffisant pour PARACETAMOL 500 MG CP (2 manquant(s)).', UTILISATEURS.vendeur.id]);
    r.ok('avec la version de l’application et l’appareil', e.version === '1.7.0' && /Chrome/.test(e.appareil || ''), JSON.stringify(e));
    // La même erreur répétée tout de suite n'est envoyée qu'une fois
    await page.click('#valider');
    await page.waitForTimeout(300);
    r.check('même erreur dans la minute : pas de doublon', appels(etat, 'signaler_erreur').length, 1);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('ERREURS — vente hors ligne refusée au retour du réseau : signalée avec les articles', async (r) => {
  const app = await ouvrir({ role: 'vendeur', rpc: { enregistrer_vente: () => { throw new Error('Stock insuffisant pour PARACETAMOL 500 MG CP (2 manquant(s)).'); } } });
  try {
    const { page, etat, context, db } = app;
    etat.reseauCoupe = true;
    await context.setOffline(true);
    await page.click('[data-ajout="1"]');
    await page.click('#valider');
    await page.waitForSelector('.modal');
    await page.click('.modal [data-fermer]');
    etat.reseauCoupe = false;
    await context.setOffline(false);
    await page.waitForFunction(() => /refusée/.test(document.querySelector('#bandeaux')?.textContent || ''));
    for (let i = 0; i < 50 && !db.erreurs.length; i++) await page.waitForTimeout(50);
    const e = db.erreurs[0] || {};
    r.ok('refus signalé avec le motif et les articles', e.message?.includes('Stock insuffisant') && e.details?.quoi === 'vente hors ligne refusée' && /PARACETAMOL/.test(e.details?.articles || ''), JSON.stringify(e));
  } finally { await app.fermer(); }
});
