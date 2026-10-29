// Petites fonctions partagées par toutes les pages.

export const ROLES = { gerant: 'Gérant', responsable: 'Responsable', vendeur: 'Vendeur' };
// Les comptes créés par le gérant n'ont pas d'e-mail : l'identifiant devient « identifiant@pharmacie.local ».
export const DOMAINE_IDENTIFIANTS = 'pharmacie.local';

export const TRANCHES = ['< 1 an', '1 – 4 ans', '5 – 14 ans', '15 – 49 ans', '50 ans et +'];

const ENTITES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENTITES[c]);

export const fmt = (n) => {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('fr-FR').replace(/[  ]/g, ' ');
};
export const fmtF = (n) => fmt(n) + ' F';
// Une date seule (« 2027-01-31 ») est lue telle quelle : passée par new Date(), elle serait
// prise pour minuit UTC et pourrait reculer d'un jour selon le fuseau de l'appareil.
const DATE_SEULE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const fmtDate = (d) => {
  if (!d) return '—';
  const m = DATE_SEULE.exec(d);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : new Date(d).toLocaleDateString('fr-FR');
};
export const fmtHeure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const fmtDateHeure = (d) => fmtDate(d) + ' ' + fmtHeure(d);
export const fmtPeremption = (d) => {
  if (!d) return '—';
  const m = DATE_SEULE.exec(d);
  if (m) return m[2] + '/' + m[1];
  const x = new Date(d);
  return String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
};

export const isoJour = (d = new Date()) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
export const isoMois = (d = new Date()) => isoJour(d).slice(0, 7);
export const debutJour = (iso) => new Date(iso + 'T00:00:00');
export const nomMois = (iso) => {
  const s = new Date(iso + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const joursAvant = (date) => (date ? Math.floor((debutJour(String(date).slice(0, 10)) - debutJour(isoJour())) / 86400000) : null);

export function trancheAge(age, unite) {
  const n = parseFloat(String(age ?? '').replace(',', '.'));
  if (isNaN(n)) return null;
  const ans = unite === 'mois' ? n / 12 : n;
  if (ans < 1) return TRANCHES[0];
  if (ans < 5) return TRANCHES[1];
  if (ans < 15) return TRANCHES[2];
  if (ans < 50) return TRANCHES[3];
  return TRANCHES[4];
}

export const entier = (v) => {
  const n = parseInt(String(v ?? '').replace(/\s/g, ''), 10);
  return isNaN(n) ? null : n;
};
export const nombre = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

// Origines : la Vente et les programmes « recouvrables » (PHPSP…) sont payants ; les autres programmes sont gratuits
export const estPayant = (g) => !!g && (g.est_vente || !!g.recouvrable);
export const nomOrigine = (g) => (!g ? '?' : g.est_vente ? 'Vente' : g.sigle);
export const typeOrigine = (g) => (!g ? '' : g.est_vente ? 'Payant' : g.recouvrable ? 'Recouvrable · payant' : 'Gratuit');
// Prix d'un produit pour une origine : prix propre à l'origine (ex. PHPSP), sinon son prix de vente
export const prixDe = (p, origineId) => Number(p?.origines?.[origineId]?.prix ?? p?.prix_vente ?? 0);

// Mots de passe : même règle que labo
export const MDP_REGLE = 'Au moins 8 caractères, avec au moins une lettre et un chiffre.';
export const mdpValide = (m) => String(m).length >= 8 && /[A-Za-z]/.test(m) && /\d/.test(m);

// Appels Supabase : renvoient les données ou lèvent une erreur lisible
export async function q(promesse) {
  const { data, error } = await promesse;
  if (error) throw error;
  return data;
}
export async function rpc(sb, fn, args) {
  return q(sb.rpc(fn, args));
}

// Lecture par pages : Supabase ne renvoie jamais plus de 1000 lignes par requête.
// Sans cela, un mois chargé serait tronqué sans le moindre message.
export async function tout(fabrique, taille = 1000) {
  const lignes = [];
  for (let debut = 0; ; debut += taille) {
    const page = await q(fabrique().range(debut, debut + taille - 1));
    lignes.push(...page);
    if (page.length < taille) return lignes;
  }
}

// Modification qui doit toucher au moins une ligne. Un refus des règles de sécurité (RLS)
// ne renvoie PAS d'erreur, seulement zéro ligne : sans ce contrôle, l'écran afficherait
// « enregistré » alors que rien n'a changé (leçon de labo v13.270).
export async function qMaj(promesseAvecSelect) {
  const data = await q(promesseAvecSelect);
  if (!data || (Array.isArray(data) && !data.length)) {
    throw new Error('Le serveur a refusé la modification (droits insuffisants ou élément introuvable).');
  }
  return data;
}

export const estErreurReseau = (e) =>
  !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(e?.message || String(e));

export const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

// Stockage local de l'appareil (préfixe ph_). Peut être indisponible (navigation privée) : jamais bloquant.
export const local = {
  lire(cle, defaut = null) {
    try { const v = localStorage.getItem('ph_' + cle); return v === null ? defaut : JSON.parse(v); } catch (_) { return defaut; }
  },
  ecrire(cle, valeur) {
    try { localStorage.setItem('ph_' + cle, JSON.stringify(valeur)); return true; } catch (_) { return false; }
  },
  effacer(cle) {
    try { localStorage.removeItem('ph_' + cle); } catch (_) { /* rien */ }
  }
};

export function messageErreur(e) {
  const m = e?.message || String(e);
  if (estErreurReseau(e)) return 'Pas de connexion internet. Réessayez.';
  if (/JWT|session/i.test(m)) return 'Session expirée : reconnectez-vous.';
  if (/duplicate key.*code_barres/i.test(m)) return 'Ce code-barres est déjà utilisé par un autre produit.';
  if (/row-level security|42501|non autorisée/i.test(m)) return 'Vous n’avez pas le droit de faire cette action.';
  return m;
}

export function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast alert-' + (type === 'err' ? 'err' : type === 'warn' ? 'warn' : 'ok');
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 7000 : 3500);
}
// Journal des erreurs du gérant : app.js branche ici l'envoi au serveur (pas d'import circulaire)
let rapporteur = null;
export const definirRapporteur = (fn) => { rapporteur = fn; };
export function rapporter(e, details = {}) {
  if (!rapporteur || estErreurReseau(e)) return; // une coupure d'internet n'est pas une erreur à corriger
  try { rapporteur(e, details); } catch (_) { /* le journal ne doit jamais casser l'écran */ }
}

export const erreur = (e) => {
  // Bug de programmation → console.error (les tests automatiques le détectent) ; refus du serveur ou réseau → simple avertissement
  if (e instanceof TypeError && !estErreurReseau(e) || e instanceof ReferenceError || e instanceof SyntaxError) console.error(e);
  else console.warn(e);
  toast(messageErreur(e), 'err');
  rapporter(e);
};

// Fenêtre modale. contenu = HTML ; renvoie { el, fermer }. auFermer : appelé une fois, quelle que soit la façon de fermer.
export function modal(titre, contenu, { large = false, auFermer = null } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal ${large ? 'large' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
      <div class="modal-head"><h2>${esc(titre)}</h2><button type="button" class="btn btn-sm" data-fermer>Fermer</button></div>
      <div class="modal-body stack">${contenu}</div>
    </div>`;
  const fermer = () => {
    overlay.remove();
    document.removeEventListener('keydown', surTouche);
    if (auFermer) { const f = auFermer; auFermer = null; f(); }
  };
  const surTouche = (e) => { if (e.key === 'Escape') fermer(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-fermer]')) fermer();
  });
  document.addEventListener('keydown', surTouche);
  document.body.appendChild(overlay);
  const premier = overlay.querySelector('.modal-body input, .modal-body select, .modal-body button');
  if (premier) premier.focus();
  return { el: overlay.querySelector('.modal-body'), fermer };
}

export function confirmer(titre, texte, libelle = 'Confirmer') {
  return new Promise((resolve) => {
    // Fermer avec la croix, Échap ou un clic à côté vaut « non »
    const m = modal(titre, `<p style="margin:0">${esc(texte)}</p>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-non>Annuler</button><button class="btn btn-p" data-oui>${esc(libelle)}</button></div>`,
    { auFermer: () => resolve(false) });
    m.el.querySelector('[data-non]').onclick = () => m.fermer();
    m.el.querySelector('[data-oui]').onclick = () => { resolve(true); m.fermer(); };
  });
}

// Impression : on place le HTML dans #print-root puis on lance l'impression du navigateur.
export function imprimer(html, { paysage = false } = {}) {
  const root = document.getElementById('print-root');
  root.innerHTML = (paysage ? '<style>@page { size: A4 landscape; margin: 8mm; }</style>' : '') + html;
  document.body.classList.add('printing');
  const fin = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', fin);
  };
  window.addEventListener('afterprint', fin);
  setTimeout(() => window.print(), 50);
}

export function telecharger(nom, contenu, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([contenu], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

// CSV lisible par Excel (point-virgule, BOM UTF-8)
export function csv(lignes) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + lignes.map((l) => l.map(cell).join(';')).join('\r\n');
}

// Charge le catalogue complet : produits, origines rattachées et stock par origine.
// Une copie est gardée sur l'appareil : hors ligne, le comptoir continue avec la dernière version connue.
export async function chargerCatalogue(sb, { secours = false } = {}) {
  let produits, liens, stock, cmm;
  try {
    [produits, liens, stock, cmm] = await Promise.all([
      tout(() => sb.from('produits').select('*').order('designation').order('id')),
      tout(() => sb.from('produits_programmes').select('produit_id, programme_id, prix_vente').order('produit_id').order('programme_id')),
      tout(() => sb.from('v_stock').select('*').order('produit_id').order('programme_id')),
      tout(() => sb.from('v_cmm').select('*').order('produit_id').order('programme_id'))
    ]);
  } catch (e) {
    const copie = local.lire('catalogue');
    if (secours && copie && estErreurReseau(e)) return Object.assign(copie.produits, { horsLigne: true, date: copie.date });
    throw e;
  }
  const parId = new Map();
  for (const p of produits) parId.set(p.id, { ...p, origines: {} });
  for (const l of liens) {
    const p = parId.get(l.produit_id);
    if (p) p.origines[l.programme_id] = { quantite: 0, perimee: 0, prochaine: null, cmm: 0, aEuDuStock: false, prix: l.prix_vente === null || l.prix_vente === undefined ? null : Number(l.prix_vente) };
  }
  for (const s of stock) {
    const o = parId.get(s.produit_id)?.origines[s.programme_id];
    if (o) {
      Object.assign(o, { quantite: s.quantite, perimee: s.quantite_perimee, prochaine: s.prochaine_peremption });
      // « Rupture » n'a de sens que pour un produit qui a déjà été en stock
      o.aEuDuStock = s.nb_lots !== undefined ? s.nb_lots > 0 : (s.quantite > 0 || s.quantite_perimee > 0);
    }
  }
  for (const c of cmm) {
    const o = parId.get(c.produit_id)?.origines[c.programme_id];
    if (o) {
      o.cmm = Number(c.cmm) || 0;
      if (o.cmm > 0) o.aEuDuStock = true;
    }
  }
  const liste = [...parId.values()];
  local.ecrire('catalogue', { date: new Date().toISOString(), produits: liste });
  return liste;
}

export const normaliser = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const correspond = (produit, recherche) => {
  const r = normaliser(recherche).trim();
  if (!r) return true;
  return normaliser(produit.designation).includes(r) || (produit.code_barres && produit.code_barres.includes(r));
};
