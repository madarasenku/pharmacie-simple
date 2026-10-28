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
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const fmtHeure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const fmtDateHeure = (d) => fmtDate(d) + ' ' + fmtHeure(d);
export const fmtPeremption = (d) => {
  if (!d) return '—';
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
export const joursAvant = (date) => (date ? Math.floor((new Date(date) - new Date()) / 86400000) : null);

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

// Appels Supabase : renvoient les données ou lèvent une erreur lisible
export async function q(promesse) {
  const { data, error } = await promesse;
  if (error) throw error;
  return data;
}
export async function rpc(sb, fn, args) {
  return q(sb.rpc(fn, args));
}

export function messageErreur(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion internet. Réessayez.';
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
export const erreur = (e) => {
  console.error(e);
  toast(messageErreur(e), 'err');
};

// Fenêtre modale. contenu = HTML ; renvoie { el, fermer }.
export function modal(titre, contenu, { large = false } = {}) {
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
    const m = modal(titre, `<p style="margin:0">${esc(texte)}</p>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-non>Annuler</button><button class="btn btn-p" data-oui>${esc(libelle)}</button></div>`);
    m.el.querySelector('[data-non]').onclick = () => { m.fermer(); resolve(false); };
    m.el.querySelector('[data-oui]').onclick = () => { m.fermer(); resolve(true); };
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
export async function chargerCatalogue(sb) {
  const [produits, liens, stock, cmm] = await Promise.all([
    q(sb.from('produits').select('*').order('designation')),
    q(sb.from('produits_programmes').select('produit_id, programme_id')),
    q(sb.from('v_stock').select('*')),
    q(sb.from('v_cmm').select('*'))
  ]);
  const parId = new Map();
  for (const p of produits) parId.set(p.id, { ...p, origines: {} });
  for (const l of liens) {
    const p = parId.get(l.produit_id);
    if (p) p.origines[l.programme_id] = { quantite: 0, perimee: 0, prochaine: null, cmm: 0 };
  }
  for (const s of stock) {
    const o = parId.get(s.produit_id)?.origines[s.programme_id];
    if (o) Object.assign(o, { quantite: s.quantite, perimee: s.quantite_perimee, prochaine: s.prochaine_peremption });
  }
  for (const c of cmm) {
    const o = parId.get(c.produit_id)?.origines[c.programme_id];
    if (o) o.cmm = Number(c.cmm) || 0;
  }
  return [...parId.values()];
}

export const normaliser = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const correspond = (produit, recherche) => {
  const r = normaliser(recherche).trim();
  if (!r) return true;
  return normaliser(produit.designation).includes(r) || (produit.code_barres && produit.code_barres.includes(r));
};
