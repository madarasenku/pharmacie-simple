// Cohérence de la mise en ligne (sans navigateur) : versions, pré-cache hors ligne,
// sécurité de index.html, clé publique, version de la base.
const fs = require('fs');
const path = require('path');
const { createReporter, ROOT } = require('./helpers');

const r = createReporter('DÉPLOIEMENT — versions, pré-cache, sécurité');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const index = lire('index.html');
const sw = lire('sw.js');
const version = lire('js/version.js');

const vApp = version.match(/APP_VERSION = '([^']+)'/)[1];
const vSw = sw.match(/APP_VERSION = '([^']+)'/)[1];
const vIndex = [...index.matchAll(/\?v=([\w.]+)/g)].map((m) => m[1]);
r.check('sw.js et js/version.js ont la même version', vSw, vApp);
r.ok('index.html : tous les « ?v= » = ' + vApp, vIndex.length >= 3 && vIndex.every((v) => v === vApp), vIndex.join(', '));
r.ok('nom du cache au bon format', /const CACHE = 'pharmacie-simple-v\d+'/.test(sw));

// Pré-cache : chaque fichier existe, et chaque module de l'application y figure (sinon le comptoir hors ligne casse)
const precache = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/(?:v\()?'\.\/([^']*)'/g)].map((m) => m[1]);
const manquants = precache.filter((f) => f && !fs.existsSync(path.join(ROOT, f)));
r.check('fichiers du pré-cache présents sur le disque', manquants, []);
const modules = ['js/' + fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).join(',js/'), 'js/pages/' + fs.readdirSync(path.join(ROOT, 'js/pages')).join(',js/pages/')].join(',').split(',');
r.check('tous les modules de l’application sont pré-cachés', modules.filter((m) => !precache.includes(m)), []);

// index.html : rien de chargé depuis un autre site (le site marche sans CDN, comme labo)
const externes = [...index.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
r.check('aucune ressource externe dans index.html', externes, []);
const config = lire('js/config.js');
const url = config.match(/SUPABASE_URL = '([^']+)'/)[1];
const csp = (index.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
r.ok('CSP présente', csp.includes("default-src 'self'"));
r.ok('CSP : le site ne parle qu’à sa base Supabase', csp.includes('connect-src') && csp.includes(url), csp);
r.ok('CSP : aucun script venu d’ailleurs', /script-src 'self'(;|$)/.test(csp), csp);
r.ok('page non indexée par les moteurs de recherche', /<meta name="robots" content="noindex/.test(index));

// La clé du site doit être la clé PUBLIQUE (jamais la clé secrète « service_role »)
const cle = config.match(/SUPABASE_KEY = '([^']+)'/)[1];
const charge = cle.split('.').length === 3 ? JSON.parse(Buffer.from(cle.split('.')[1], 'base64url').toString()) : {};
r.ok('clé publique (publishable / anon)', (cle.startsWith('sb_publishable_') || charge.role === 'anon') && !cle.startsWith('sb_secret_') && charge.role !== 'service_role');

// Version de la base attendue = dernière migration
const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const derniere = Number(migrations[migrations.length - 1].slice(0, 3));
r.check('VERSION_BASE = numéro de la dernière migration', Number(version.match(/VERSION_BASE = (\d+)/)[1]), derniere);
r.ok('la dernière migration enregistre version_base', lire('supabase/migrations/' + migrations[migrations.length - 1]).includes(`'version_base', '{"version": ${derniere}}'`));

// Fichiers du site présents
for (const f of ['vendor/supabase-2.39.7.umd.js', 'vendor/fonts/plus-jakarta-sans-latin-var.woff2', 'manifest.webmanifest', 'icon.svg', 'robots.txt']) {
  r.ok('présent : ' + f, fs.existsSync(path.join(ROOT, f)));
}
r.fin();
