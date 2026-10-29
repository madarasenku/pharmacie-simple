// ════════════════════════════════════════════════════════════════════
//  Socle commun des tests Pharmacie Simple (même principe que labo).
//
//  On sert le dépôt en local, on lance Chromium avec la VRAIE bibliothèque
//  Supabase (vendor/), et on intercepte les requêtes HTTP vers Supabase :
//  une petite base en mémoire répond comme PostgREST (filtres, tri, pages
//  de 1000 lignes au plus, objet unique, insert/update/delete) et comme
//  l'authentification. AUCUN test ne touche la base de production.
//
//  Les règles métier du serveur (FEFO, caisse, inventaire…) sont testées à
//  part, sur un vrai PostgreSQL : tests/sql/run.sh.
// ════════════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain'
};
const SUPABASE = 'https://albdclznvthbaxewzdiu.supabase.co';
const CLE_SESSION = 'sb-albdclznvthbaxewzdiu-auth-token';
const MAX_LIGNES = 1000; // réglage « Max rows » de l'API Supabase : une requête ne renvoie jamais plus

// ── Serveur statique du dépôt ─────────────────────────────────────────
function serve() {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('introuvable');
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ── Dates RELATIVES à aujourd'hui (jamais de date en dur : la suite doit rester verte demain) ──
const AUJ = new Date();
const isoJour = (d) => d.toISOString().slice(0, 10);
const dansJours = (n) => { const d = new Date(AUJ); d.setDate(d.getDate() + n); return isoJour(d); };
const ilYA = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

// ── Jeu de données ───────────────────────────────────────────────────
const UTILISATEURS = {
  // Noms en MAJUSCULES, comme la base les enregistre (déclencheur profiles_nom_majuscule)
  gerant: { id: '11111111-1111-4111-8111-111111111111', nom: 'GÉRANTE TEST', identifiant: 'gerant', role: 'gerant' },
  responsable: { id: '22222222-2222-4222-8222-222222222222', nom: 'KONÉ RESPONSABLE', identifiant: 'kone', role: 'responsable' },
  vendeur: { id: '33333333-3333-4333-8333-333333333333', nom: 'AWA VENDEUSE', identifiant: 'awa', role: 'vendeur' }
};

function donneesDeBase() {
  const programmes = [
    { id: 1, code: 'VENTE', nom: 'Vente (produits recouvrables)', sigle: 'VENTE', est_vente: true, frequence: 'mensuel', categories: [], actif: true, ordre: 0 },
    { id: 2, code: 'PNLP', nom: 'Paludisme', sigle: 'PNLP', est_vente: false, frequence: 'mensuel', categories: ['Enfant < 5 ans', 'Femme enceinte', 'Autre'], actif: true, ordre: 10 },
    { id: 3, code: 'GRAT', nom: 'Gratuité ciblée', sigle: 'GRAT', est_vente: false, frequence: 'mensuel', categories: ['Enfant < 5 ans', 'Femme enceinte'], actif: true, ordre: 20 },
    { id: 4, code: 'PF', nom: 'Planification familiale', sigle: 'PF', est_vente: false, frequence: 'mensuel', categories: [], actif: true, ordre: 30 },
    // Programme recouvrable : médicaments vendus, avec leur propre prix et leur propre point
    { id: 5, code: 'PHPSP', nom: 'PHPSP', sigle: 'PHPSP', est_vente: false, recouvrable: true, frequence: 'mensuel', categories: [], actif: true, ordre: 40 }
  ];
  const produits = [
    { id: 1, designation: 'PARACETAMOL 500 MG CP', code_barres: '6000000000028', presentation: 'Plaquette', prix_achat: 10, prix_vente: 25, stock_min: 20, actif: true },
    { id: 2, designation: 'ACT ENFANT 1-5 ANS', code_barres: '6000000000073', presentation: 'Plaquette', prix_achat: 0, prix_vente: 700, stock_min: 5, actif: true },
    { id: 3, designation: 'AMOXICILLINE 500 MG GEL', code_barres: null, presentation: null, prix_achat: 60, prix_vente: 100, stock_min: 0, actif: true },
    { id: 4, designation: 'SRO SACHET', code_barres: null, presentation: 'Sachet', prix_achat: 50, prix_vente: 100, stock_min: 10, actif: true }
  ];
  const lots = [
    { id: 1, produit_id: 1, programme_id: 1, numero: 'P1', peremption: dansJours(400), quantite: 42 },
    { id: 2, produit_id: 2, programme_id: 2, numero: 'A7', peremption: dansJours(200), quantite: 43 },
    { id: 3, produit_id: 2, programme_id: 3, numero: 'G2', peremption: null, quantite: 12 },
    { id: 4, produit_id: 3, programme_id: 1, numero: 'AM9', peremption: dansJours(-5), quantite: 3 },
    { id: 5, produit_id: 2, programme_id: 1, numero: 'V1', peremption: dansJours(60), quantite: 10 },
    { id: 6, produit_id: 1, programme_id: 5, numero: 'PH1', peremption: dansJours(300), quantite: 20 }
  ];
  const liens = [[1, 1], [2, 1], [2, 2], [2, 3], [3, 1], [4, 1], [1, 5]].map(([produit_id, programme_id]) => ({ produit_id, programme_id, prix_vente: null }));
  liens.find((l) => l.produit_id === 1 && l.programme_id === 5).prix_vente = 15; // prix PHPSP du paracétamol (Vente : 25)
  const profiles = Object.values(UTILISATEURS).map((u, i) => ({
    ...u, email: u.identifiant + '@pharmacie.local', actif: true, doit_changer_mdp: false, created_at: ilYA(10000 - i)
  }));
  return {
    profiles,
    parametres: [
      { cle: 'droits_vendeur', valeur: { vendre: true, entree: false, credit: true, programmes: true, corriger: false, annuler: false, prix: false, rapports: false, base: false } },
      { cle: 'droits_responsable', valeur: { vendre: true, entree: true, credit: true, programmes: true, corriger: true, annuler: true, prix: false, rapports: true, base: false } },
      { cle: 'pharmacie', valeur: { nom: 'Pharmacie Test', region: 'SUD COMOÉ', district: 'GRAND-BASSAM', etablissement: 'CSR TEST' } },
      { cle: 'derniere_sauvegarde', valeur: { date: new Date().toISOString(), par: 'Gérante Test' } },
      { cle: 'version_base', valeur: { version: 8 } }
    ],
    programmes, produits, lots, produits_programmes: liens,
    clients: [{ id: 1, nom: 'TRAORE Adama', telephone: '0700000001', plafond: 10000 }],
    caisses: [{ id: 1, ouverte_par: UTILISATEURS.gerant.id, ouverte_le: ilYA(120), fond: 10000, fermee_le: null }],
    ventes: [{
      id: 1, numero: 'V-2026-00001', programme_id: 1, caisse_id: 1, mode_paiement: 'especes', total: 50, montant_recu: 100, annulee: false, saisie_hors_ligne: false,
      created_at: ilYA(60), patient_nom: null, patient_sexe: 'NP', client_id: null, clients: null,
      ventes_lignes: [{ quantite: 2, prix_unitaire: 25, cout_unitaire: 10, produit_id: 1, produits: { designation: 'PARACETAMOL 500 MG CP', prix_vente: 25 } }]
    }],
    mouvements: [{ id: 1, produit_id: 1, programme_id: 1, lot_id: 1, type: 'entree', quantite: 44, prix_unitaire: 10, fournisseur: 'DPCI', created_at: ilYA(90),
      commande_id: null, produits: { designation: 'PARACETAMOL 500 MG CP' }, lots: { numero: 'P1', peremption: dansJours(400) }, profiles: { nom: 'Gérante Test' } }],
    v_cmm: [{ produit_id: 1, programme_id: 1, cmm: 45 }],
    v_dettes: [{ client_id: 1, nom: 'TRAORE Adama', telephone: '0700000001', plafond: 10000, du: 3700, premier_credit: ilYA(60 * 24 * 40) }],
    credits_paiements: [],
    ventes_lignes: [], commandes: [], commandes_lignes: [], rapports_corrections: [],
    // Journal des erreurs (lecture gérant ; « profiles » = la jointure profiles!erreurs_user_id_fkey(nom))
    erreurs: [],
    journal: [{ id: 1, user_id: UTILISATEURS.gerant.id, action: 'correction', details: { lot: 1, motif: 'Casse' }, created_at: ilYA(30), profiles: { nom: 'Gérante Test' } }]
  };
}

// Vue v_stock calculée depuis les lots (comme le serveur)
function vStock(db) {
  const auj = isoJour(new Date());
  return db.produits_programmes.map(({ produit_id, programme_id }) => {
    const ls = db.lots.filter((l) => l.produit_id === produit_id && l.programme_id === programme_id);
    const ok = ls.filter((l) => !l.peremption || l.peremption >= auj);
    return {
      produit_id, programme_id,
      quantite: ok.reduce((s, l) => s + l.quantite, 0),
      quantite_perimee: ls.filter((l) => l.peremption && l.peremption < auj).reduce((s, l) => s + l.quantite, 0),
      prochaine_peremption: ok.filter((l) => l.quantite > 0 && l.peremption).map((l) => l.peremption).sort()[0] || null,
      nb_lots: ls.length
    };
  });
}

// Réponses par défaut des fonctions serveur (RPC). FORME = celle du vrai serveur :
//   enregistrer_vente → jsonb OBJET { id, numero, total, deja? }   rapport_mensuel → TABLE (tableau)
//   enregistrer_entree → int        valider_inventaire → jsonb { corrections, lots_ajoutes }
function rpcParDefaut(db, etat) {
  return {
    caisse_ouverte: () => db.caisses.find((c) => !c.fermee_le)?.id ?? null,
    resume_caisse: () => ({ fond: 10000, especes: 50, momo: 0, credit: 0, remboursements: 0, recouvrables: [] }),
    enregistrer_vente: (a) => {
      const p = a.p;
      const deja = db.ventes.find((v) => v.ref_client && v.ref_client === p.ref_client);
      if (deja) return { id: deja.id, numero: deja.numero, total: deja.total, deja: true };
      const id = Math.max(0, ...db.ventes.map((v) => v.id)) + 1;
      const prog = db.programmes.find((x) => x.id === p.programme_id);
      const payant = prog.est_vente || prog.recouvrable;
      const lignes = p.lignes.map((l) => {
        const pr = db.produits.find((x) => x.id === l.produit_id);
        const lien = db.produits_programmes.find((x) => x.produit_id === pr.id && x.programme_id === prog.id);
        const prix = lien?.prix_vente ?? pr.prix_vente;
        return { quantite: l.quantite, prix_unitaire: payant ? prix : 0, cout_unitaire: pr.prix_achat, produit_id: pr.id, produits: { designation: pr.designation, prix_vente: pr.prix_vente } };
      });
      const total = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
      const numero = (prog.est_vente ? 'V' : prog.sigle) + '-' + AUJ.getFullYear() + '-' + String(id).padStart(5, '0');
      db.ventes.push({ id, numero, programme_id: p.programme_id, caisse_id: 1, mode_paiement: payant ? (p.mode || 'especes') : 'gratuit', total, annulee: false,
        ref_client: p.ref_client, saisie_hors_ligne: !!p.hors_ligne, created_at: p.hors_ligne ? p.date_locale : new Date().toISOString(), patient_sexe: 'NP', clients: null, ventes_lignes: lignes });
      return { id, numero, total };
    },
    annuler_vente: () => null,
    ouvrir_caisse: () => { db.caisses.push({ id: 9, ouverte_le: new Date().toISOString(), fond: 0, fermee_le: null }); return 9; },
    fermer_caisse: () => { const c = db.caisses.find((x) => !x.fermee_le); if (c) c.fermee_le = new Date().toISOString(); return { ecart: 0, attendu: 10050 }; },
    enregistrer_entree: () => 1,
    corriger_stock: () => null,
    rembourser_credit: () => null,
    mot_de_passe_personnel_defini: () => { const p = db.profiles.find((x) => x.id === etat.utilisateur?.id); if (p) p.doit_changer_mdp = false; return null; },
    rapport_mensuel: () => [
      { produit_id: 1, designation: 'PARACETAMOL 500 MG CP', stock_initial: 0, recu: 44, dispense: 2, perimes: 0, stock_disponible: 42, jours_rupture: 0, cmm: 45,
        quantite_calculee: 48, quantite_commandee: 48, corrigee: false, prix_unitaire: 10, montant: 480 },
      { produit_id: 3, designation: 'AMOXICILLINE 500 MG GEL', stock_initial: 3, recu: 0, dispense: 0, perimes: 0, stock_disponible: 3, jours_rupture: 0, cmm: 0,
        quantite_calculee: 0, quantite_commandee: 0, corrigee: false, prix_unitaire: 60, montant: 0 }
    ],
    stats_beneficiaires: () => [{ tranche: '1 – 4 ans', sexe: 'F', nombre: 3 }],
    corriger_quantite_rapport: () => null,
    enregistrer_commande: (a) => {
      const id = db.commandes.length + 1;
      const numero = 'CMD-' + a.p.mois.slice(0, 7) + '-' + String(id).padStart(3, '0');
      const total = a.p.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
      db.commandes.push({ id, numero, programme_id: a.p.programme_id, mois: a.p.mois, statut: 'envoyee', total, note: a.p.note || null, created_at: new Date().toISOString(),
        commandes_lignes: a.p.lignes.map((l) => ({ ...l, recu: 0, produits: { designation: db.produits.find((p) => p.id === l.produit_id)?.designation } })) });
      return { id, numero, total };
    },
    annuler_commande: (a) => { const c = db.commandes.find((x) => x.id === a.p_commande); c.statut = 'annulee'; return null; },
    clore_commande: (a) => { const c = db.commandes.find((x) => x.id === a.p_commande); c.statut = 'soldee'; return null; },
    // Même règle que le serveur : jamais utilisé → effacé ; historique → masqué ; encore du stock → refusé
    supprimer_produits: (a) => {
      const r = { supprimes: [], desactives: [], refuses: [] };
      for (const id of a.p_ids) {
        const p = db.produits.find((x) => x.id === id);
        if (!p) continue;
        const ls = db.lots.filter((l) => l.produit_id === id);
        if (ls.some((l) => l.quantite > 0)) r.refuses.push(p.designation);
        else if (ls.length || db.mouvements.some((m) => m.produit_id === id)) { p.actif = false; r.desactives.push(p.designation); }
        else {
          db.produits = db.produits.filter((x) => x.id !== id);
          db.produits_programmes = db.produits_programmes.filter((x) => x.produit_id !== id);
          r.supprimes.push(p.designation);
        }
      }
      return r;
    },
    supprimer_programmes: (a) => {
      const r = { supprimes: [], desactives: [], refuses: [] };
      for (const id of a.p_ids) {
        const g = db.programmes.find((x) => x.id === id);
        if (!g) continue;
        const ls = db.lots.filter((l) => l.programme_id === id);
        if (g.est_vente || ls.some((l) => l.quantite > 0)) r.refuses.push(g.nom);
        else if (ls.length) { g.actif = false; r.desactives.push(g.nom); }
        else {
          db.programmes = db.programmes.filter((x) => x.id !== id);
          db.produits_programmes = db.produits_programmes.filter((x) => x.programme_id !== id);
          r.supprimes.push(g.nom);
        }
      }
      return r;
    },
    // Comme anomalies() côté serveur, pour les deux contrôles que la fausse base sait calculer
    anomalies: () => {
      if (etat.utilisateur?.role !== 'gerant') throw new Error('Action non autorisée (gérant).');
      const auj = isoJour(new Date());
      const prog = (id) => db.programmes.find((g) => g.id === id);
      const nomOrigine = (g) => (g.est_vente ? 'Vente' : g.sigle);
      const prix = db.produits_programmes.filter((l) => {
        const p = db.produits.find((x) => x.id === l.produit_id), g = prog(l.programme_id);
        return p?.actif && g?.actif && (g.est_vente || g.recouvrable) && !Number(l.prix_vente ?? p.prix_vente);
      }).map((l) => ({ code: 'prix_manquant', gravite: 'haute', titre: 'Produit à vendre sans prix de vente',
        detail: db.produits.find((x) => x.id === l.produit_id).designation + ' — ' + nomOrigine(prog(l.programme_id)), page: 'base', cle: 'prix:' + l.produit_id + ':' + l.programme_id }));
      const perimes = db.lots.filter((l) => l.quantite > 0 && l.peremption && l.peremption < auj).map((l) => ({
        code: 'perime_en_stock', gravite: 'haute', titre: 'Lot périmé encore en stock',
        detail: db.produits.find((x) => x.id === l.produit_id).designation + ' — ' + l.quantite + ' unité(s), lot ' + l.numero, page: 'inventaire', cle: 'perime:' + l.id }));
      return [...prix, ...perimes];
    },
    signaler_erreur: (a) => {
      const u = etat.utilisateur;
      db.erreurs.push({ id: db.erreurs.length + 1, created_at: new Date().toISOString(), user_id: u?.id, profiles: u ? { nom: u.nom } : null,
        page: a.p.page, message: a.p.message, details: a.p.details || {}, version: a.p.version, appareil: a.p.appareil, vu: false });
      return null;
    },
    marquer_erreurs_vues: (a) => {
      const cibles = db.erreurs.filter((x) => !x.vu && (!a.p_ids || !a.p_ids.length || a.p_ids.includes(x.id)));
      cibles.forEach((x) => { x.vu = true; x.vu_par = etat.utilisateur.id; });
      return cibles.length;
    },
    valider_inventaire: (a) => ({ corrections: a.p.comptes.filter((c) => c.reel !== c.attendu).length, lots_ajoutes: a.p.nouveaux.filter((n) => n.quantite > 0).length })
  };
}

// ── Mini PostgREST ───────────────────────────────────────────────────
function valeurFiltre(brut) {
  if (brut === 'null') return null;
  if (brut === 'true') return true;
  if (brut === 'false') return false;
  return brut.replace(/^"(.*)"$/, '$1');
}
const egal = (a, b) => (a === null || a === undefined ? b === null : String(a) === String(b));
const comparer = (a, b) => {
  if (a === null || a === undefined) return null;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
function testeFiltre(ligne, col, expr) {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf('.');
  const op = expr.slice(0, i);
  const v = expr.slice(i + 1);
  const x = ligne[col];
  let r;
  if (op === 'eq') r = egal(x, valeurFiltre(v));
  else if (op === 'neq') r = !egal(x, valeurFiltre(v));
  else if (op === 'is') r = v === 'null' ? x === null || x === undefined : egal(x, valeurFiltre(v));
  else if (op === 'in') r = v.replace(/^\(|\)$/g, '').split(',').map(valeurFiltre).some((y) => egal(x, y));
  else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    const c = comparer(x, valeurFiltre(v));
    r = c !== null && (op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0);
  } else throw new Error('Filtre non géré par le faux serveur : ' + col + '=' + expr);
  return neg ? !r : r;
}
const RESERVES = new Set(['select', 'order', 'offset', 'limit', 'on_conflict', 'columns']);
function filtrer(lignes, params) {
  let res = lignes;
  for (const [k, v] of params) if (!RESERVES.has(k)) res = res.filter((l) => testeFiltre(l, k, v));
  return res;
}
function trier(lignes, order) {
  if (!order) return lignes;
  const cles = order.split(',').map((o) => { const [col, sens = 'asc', nuls] = o.split('.'); return { col, desc: sens === 'desc', nulsPremiers: nuls === 'nullsfirst' }; });
  return lignes.slice().sort((a, b) => {
    for (const k of cles) {
      const va = a[k.col], vb = b[k.col];
      if (va == null && vb == null) continue;
      if (va == null) return k.nulsPremiers ? -1 : 1;
      if (vb == null) return k.nulsPremiers ? 1 : -1;
      const c = comparer(va, vb);
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}
const CLES = { parametres: ['cle'], produits_programmes: ['produit_id', 'programme_id'], rapports_corrections: ['programme_id', 'mois', 'produit_id'] };

function fauxJwt(u) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 * 24 }) + '.signature';
}
const sessionPour = (u) => ({
  access_token: fauxJwt(u), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  refresh_token: 'rt-' + u.id, user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.identifiant + '@pharmacie.local', app_metadata: {}, user_metadata: { nom: u.nom } }
});

/**
 * Ouvre l'application dans Chromium avec une fausse base.
 * @param {object} o { role ('gerant'|'responsable'|'vendeur'|null = déconnecté), donnees(db), rpc: { nom: (args, db) => réponse | throw }, page: '#/comptoir' }
 */
async function ouvrir(o = {}) {
  const srv = await serve();
  const port = srv.address().port;
  const db = donneesDeBase();
  if (o.donnees) o.donnees(db);
  const etat = { utilisateur: o.role === null ? null : UTILISATEURS[o.role || 'gerant'], reseauCoupe: false, refuserEcritures: new Set(), appels: [], motsDePasse: { awa: 'Awa12345', kone: 'Kone1234', gerant: 'Gerant12' } };
  const rpcs = { ...rpcParDefaut(db, etat), ...(o.rpc || {}) };

  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1280, height: 900 } });
  if (etat.utilisateur) {
    await context.addInitScript(([cle, s]) => { if (!localStorage.getItem(cle)) localStorage.setItem(cle, JSON.stringify(s)); }, [CLE_SESSION, sessionPour(etat.utilisateur)]);
  }
  if (o.avantChargement) await context.addInitScript(o.avantChargement);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch|ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(m.text())) erreurs.push('console: ' + m.text()); });

  const json = (route, status, corps, entetes = {}) => route.fulfill({
    status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...entetes },
    body: corps === undefined ? '' : JSON.stringify(corps)
  });

  await context.route(SUPABASE + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (etat.reseauCoupe) return route.abort('internetdisconnected');
    const url = new URL(req.url());
    const corps = req.postData() ? JSON.parse(req.postData()) : null;
    const chemin = url.pathname;

    // Authentification
    if (chemin === '/auth/v1/token') {
      const email = corps.email || '';
      const u = Object.values(UTILISATEURS).find((x) => x.identifiant + '@pharmacie.local' === email);
      etat.appels.push(['connexion', email]);
      if (!u || etat.motsDePasse[u.identifiant] !== corps.password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      etat.utilisateur = u;
      return json(route, 200, sessionPour(u));
    }
    if (chemin === '/auth/v1/user') {
      if (req.method() === 'PUT') { etat.appels.push(['nouveau_mdp', corps.password]); if (etat.utilisateur) etat.motsDePasse[etat.utilisateur.identifiant] = corps.password; }
      return json(route, 200, sessionPour(etat.utilisateur).user);
    }
    if (chemin === '/auth/v1/logout') { etat.utilisateur = null; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }

    // Fonction serveur « utilisateurs »
    if (chemin.startsWith('/functions/v1/')) {
      etat.appels.push(['fonction', chemin.split('/').pop(), corps]);
      return json(route, 200, { id: 'nouvel-id' });
    }

    // RPC
    if (chemin.startsWith('/rest/v1/rpc/')) {
      const fn = chemin.split('/').pop();
      etat.appels.push(['rpc', fn, corps]);
      const h = rpcs[fn];
      if (!h) return json(route, 404, { code: 'PGRST202', message: 'Fonction inconnue du faux serveur : ' + fn });
      try { return json(route, 200, await h(corps || {}, db, etat)); } catch (e) { return json(route, 400, { code: 'P0001', message: e.message, details: null, hint: null }); }
    }

    // Tables
    if (chemin.startsWith('/rest/v1/')) {
      const table = chemin.split('/').pop();
      const params = [...url.searchParams.entries()];
      const p = Object.fromEntries(params);
      const objetUnique = (req.headers().accept || '').includes('vnd.pgrst.object');
      const methode = req.method();
      if (table === 'v_stock') db.v_stock = vStock(db);
      if (!(table in db)) return json(route, 404, { code: '42P01', message: 'Table inconnue du faux serveur : ' + table });
      const renvoyer = (lignes, status = 200) => {
        if (objetUnique) {
          if (lignes.length !== 1) return json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `Results contain ${lignes.length} rows` });
          return json(route, status, lignes[0]);
        }
        return json(route, status, lignes);
      };
      const representation = /return=representation/.test(req.headers().prefer || '');
      if (methode === 'GET' || methode === 'HEAD') {
        etat.appels.push(['lecture', table, url.search]);
        const debut = Number(p.offset || 0);
        const n = Math.min(Number(p.limit || MAX_LIGNES), MAX_LIGNES);
        return renvoyer(trier(filtrer(db[table], params), p.order).slice(debut, debut + n));
      }
      if (etat.refuserEcritures.has(table)) {
        // Comme la RLS : un refus de modification ne renvoie AUCUNE erreur, seulement zéro ligne
        etat.appels.push(['refus', table, methode]);
        if (methode === 'POST') return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
        return representation ? renvoyer([]) : route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      if (methode === 'POST') {
        const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ ...l }));
        const cles = CLES[table] || ['id'];
        const fusion = /merge-duplicates/.test(req.headers().prefer || '');
        const sorties = [];
        for (const l of lignes) {
          const existe = fusion && db[table].find((x) => cles.every((k) => egal(x[k], l[k])));
          if (existe) Object.assign(existe, l), sorties.push(existe);
          else {
            if (cles[0] === 'id' && l.id === undefined) l.id = Math.max(0, ...db[table].map((x) => Number(x.id) || 0)) + 1;
            if (l.created_at === undefined) l.created_at = new Date().toISOString();
            db[table].push(l);
            sorties.push(l);
          }
        }
        etat.appels.push(['ajout', table, corps]);
        return representation ? renvoyer(sorties, 201) : route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
      }
      if (methode === 'PATCH') {
        const cibles = filtrer(db[table], params);
        cibles.forEach((l) => Object.assign(l, corps));
        etat.appels.push(['modif', table, corps, url.search]);
        return representation ? renvoyer(cibles) : route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      if (methode === 'DELETE') {
        const cibles = filtrer(db[table], params);
        db[table] = db[table].filter((l) => !cibles.includes(l));
        etat.appels.push(['suppr', table, url.search]);
        return representation ? renvoyer(cibles) : route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
    }
    return json(route, 404, { message: 'Requête non prévue par le faux serveur : ' + req.method() + ' ' + chemin });
  });

  await page.goto(`http://${o.hote || '127.0.0.1'}:${port}/${o.page || ''}`);
  if (o.attendre !== false) {
    // (le « .login » de index.html n'est qu'un écran d'attente : on attend le vrai formulaire)
    await page.waitForSelector(etat.utilisateur ? '#contenu[data-pret], form.login' : 'form.login', { timeout: 15000 });
  }
  const fermer = async () => { await browser.close(); srv.close(); };
  return { page, context, db, etat, erreurs, fermer, port };
}

// Va sur une page de l'application et attend son titre
async function aller(page, id) {
  await page.evaluate((x) => { location.hash = '#/' + x; }, id);
  await page.waitForSelector(`#contenu[data-pret="${id}"]`, { timeout: 15000 });
}

// Attend un message (toast) contenant ce texte
const toast = (page, texte) => page.waitForFunction((t) => [...document.querySelectorAll('.toast')].some((x) => x.textContent.includes(t)), texte, { timeout: 10000 });

// ── Rapport de test ──────────────────────────────────────────────────
function createReporter(titre) {
  let ok = 0;
  const ko = [];
  console.log('\n▶ ' + titre);
  return {
    check(nom, obtenu, attendu) {
      const reussi = JSON.stringify(obtenu) === JSON.stringify(attendu);
      if (reussi) { ok++; console.log('  ✓ ' + nom); } else { ko.push(nom); console.log('  ✗ ' + nom + '\n      obtenu : ' + JSON.stringify(obtenu) + '\n      attendu : ' + JSON.stringify(attendu)); }
    },
    ok(nom, condition, detail) { this.check(nom + (detail && !condition ? ' — ' + detail : ''), !!condition, true); },
    fin() {
      console.log(`  ${ok} réussi(s), ${ko.length} échec(s)`);
      if (ko.length) process.exitCode = 1;
      return ko.length === 0;
    }
  };
}

// Exécute les tests d'un fichier L'UN APRÈS L'AUTRE (jamais en parallèle), même en cas d'exception
let fileDeTests = Promise.resolve();
function lancerTest(titre, fn) {
  fileDeTests = fileDeTests.then(async () => {
    const r = createReporter(titre);
    try {
      await fn(r);
    } catch (e) {
      r.check('exception inattendue : ' + (e && e.stack || e), false, true);
    }
    r.fin();
  });
  return fileDeTests;
}

module.exports = { ouvrir, aller, toast, lancerTest, createReporter, UTILISATEURS, CLE_SESSION, dansJours, isoJour, ROOT, uuid: () => crypto.randomUUID() };
