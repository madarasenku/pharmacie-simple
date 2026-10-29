// Réglages (gérant) : création de compte avec la règle de mot de passe, sauvegarde complète
// qui note sa date (rappel hebdomadaire), désactivation d'un compte confirmée.
const { ouvrir, aller, toast, lancerTest } = require('./helpers');

lancerTest('RÉGLAGES — comptes et sauvegarde', async (r) => {
  const app = await ouvrir({ role: 'gerant', donnees: (db) => { db.parametres = db.parametres.filter((p) => p.cle !== 'derniere_sauvegarde'); } });
  try {
    const { page, etat, db, erreurs } = app;
    r.ok('rappel de sauvegarde affiché (jamais faite)', (await page.$eval('#bandeaux', (b) => b.textContent)).includes('Aucune sauvegarde'));
    await aller(page, 'reglages');

    await page.click('#nouvel-utilisateur');
    await page.fill('.modal #u-nom', 'Yao Koffi');
    r.check('nom mis en majuscules à la saisie', await page.$eval('.modal #u-nom', (i) => i.value), 'YAO KOFFI');
    await page.fill('.modal #u-id', 'Yao Koffi');
    r.check('identifiant nettoyé à la saisie', await page.$eval('.modal #u-id', (i) => i.value), 'yao.koffi');
    await page.fill('.modal #u-mdp', 'yao');
    await page.click('.modal #u-ok');
    await toast(page, '8 caractères');
    r.check('mot de passe trop faible : rien d’envoyé', etat.appels.filter((a) => a[0] === 'fonction').length, 0);
    await page.fill('.modal #u-mdp', 'Bassam2026');
    await page.selectOption('.modal #u-role', 'responsable');
    await page.click('.modal #u-ok');
    await toast(page, 'Compte créé');
    r.check('compte demandé au serveur', etat.appels.find((a) => a[0] === 'fonction')[2],
      { action: 'creer', nom: 'YAO KOFFI', identifiant: 'yao.koffi', mot_de_passe: 'Bassam2026', role: 'responsable' });

    // Désactivation : confirmation demandée, puis envoyée
    await page.click('[data-actif="33333333-3333-4333-8333-333333333333"]');
    await page.waitForSelector('.modal [data-oui]');
    await page.click('.modal [data-oui]');
    await toast(page, 'Compte désactivé');
    r.check('compte désactivé', db.profiles.find((p) => p.identifiant === 'awa').actif, false);

    const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#sauvegarde')]);
    const fichier = JSON.parse(require('fs').readFileSync(await telechargement.path(), 'utf8'));
    r.ok('sauvegarde : toutes les tables, y compris commandes et inventaire',
      ['produits', 'lots', 'ventes', 'mouvements', 'commandes', 'commandes_lignes', 'rapports_corrections', 'journal'].every((t) => Array.isArray(fichier[t])));
    await toast(page, 'Sauvegarde téléchargée');
    r.ok('date de la sauvegarde notée sur le serveur', db.parametres.some((p) => p.cle === 'derniere_sauvegarde' && p.valeur.date));
    await page.waitForFunction(() => !document.querySelector('#bandeaux').textContent.includes('Aucune sauvegarde'));
    r.ok('le rappel disparaît', true);
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('RÉGLAGES — base de données pas à jour', async (r) => {
  const app = await ouvrir({ role: 'gerant', donnees: (db) => { db.parametres = db.parametres.filter((p) => p.cle !== 'version_base'); } });
  try {
    r.ok('bandeau rouge pour le gérant', (await app.page.$eval('#bandeaux', (b) => b.textContent)).includes('pas à jour'));
  } finally { await app.fermer(); }
});
