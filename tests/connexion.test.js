// Connexion par identifiant + mot de passe, bouton « Afficher », mot de passe provisoire
// à remplacer à la première connexion (règle : 8 caractères, une lettre, un chiffre).
const { ouvrir, lancerTest } = require('./helpers');

lancerTest('CONNEXION — identifiant, erreurs, œil', async (r) => {
  const app = await ouvrir({ role: null });
  try {
    const { page, etat, erreurs } = app;
    r.ok('écran de connexion affiché', await page.$('form.login #identifiant'));
    await page.click('[data-oeil="mdp"]');
    r.check('« Afficher » montre le mot de passe', await page.$eval('#mdp', (i) => i.type), 'text');
    await page.click('[data-oeil="mdp"]');
    r.check('« Masquer » le cache à nouveau', await page.$eval('#mdp', (i) => i.type), 'password');

    await page.fill('#identifiant', 'Awa ');
    await page.fill('#mdp', 'mauvais1');
    await page.click('button[type=submit]');
    await page.waitForSelector('form.login .alert');
    r.check('message clair si le mot de passe est faux', await page.$eval('form.login .alert', (a) => a.textContent.trim()), 'Identifiant ou mot de passe incorrect.');
    r.check('l’identifiant devient l’adresse interne', etat.appels.find((a) => a[0] === 'connexion')[1], 'awa@pharmacie.local');

    await page.fill('#identifiant', 'awa');
    await page.fill('#mdp', 'Awa12345');
    await page.click('button[type=submit]');
    await page.waitForSelector('#contenu[data-pret]');
    r.ok('connectée : le comptoir s’ouvre, nom en majuscules', (await page.$eval('.user-box', (u) => u.textContent)).includes('AWA VENDEUSE'));
    r.check('identifiant retenu pour la prochaine fois', await page.evaluate(() => localStorage.getItem('ph_dernier_identifiant')), '"awa"');
    r.check('aucune erreur JavaScript', erreurs, []);
  } finally { await app.fermer(); }
});

lancerTest('CONNEXION — mot de passe provisoire à remplacer', async (r) => {
  const app = await ouvrir({ role: 'vendeur', donnees: (db) => { db.profiles.find((p) => p.identifiant === 'awa').doit_changer_mdp = true; } });
  try {
    const { page, etat, db } = app;
    r.ok('écran « choisir votre mot de passe » imposé', await page.$('form.login #n1'));
    r.ok('le menu n’est pas accessible', !(await page.$('nav.menu')));
    const essayer = async (a, b) => {
      await page.fill('#n1', a);
      await page.fill('#n2', b);
      await page.click('button[type=submit]');
      return page.$eval('#err', (z) => z.textContent);
    };
    r.ok('trop court : refusé', /8 caractères/.test(await essayer('abc1', 'abc1')));
    r.ok('sans chiffre : refusé', /chiffre/.test(await essayer('abcdefgh', 'abcdefgh')));
    r.ok('confirmation différente : refusée', /différents/.test(await essayer('Pharma2026', 'Pharma2027')));
    r.check('aucun envoi tant que la règle n’est pas respectée', etat.appels.filter((a) => a[0] === 'nouveau_mdp').length, 0);
    await page.fill('#n1', 'Pharma2026');
    await page.fill('#n2', 'Pharma2026');
    await page.click('button[type=submit]');
    await page.waitForSelector('#contenu[data-pret]');
    r.check('nouveau mot de passe envoyé', etat.appels.filter((a) => a[0] === 'nouveau_mdp').map((a) => a[1]), ['Pharma2026']);
    r.ok('serveur prévenu (mot_de_passe_personnel_defini)', etat.appels.some((a) => a[0] === 'rpc' && a[1] === 'mot_de_passe_personnel_defini'));
    r.check('le drapeau est levé', db.profiles.find((p) => p.identifiant === 'awa').doit_changer_mdp, false);
  } finally { await app.fermer(); }
});

lancerTest('CONNEXION — compte désactivé', async (r) => {
  const app = await ouvrir({ role: 'vendeur', donnees: (db) => { db.profiles.find((p) => p.identifiant === 'awa').actif = false; } });
  try {
    const { page } = app;
    const msg = await page.$eval('form.login .alert', (a) => a.textContent);
    r.ok('message « compte désactivé »', /désactivé/.test(msg), msg);
  } finally { await app.fermer(); }
});
