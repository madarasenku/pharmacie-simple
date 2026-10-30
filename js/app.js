// Point d'entrée : connexion, cadre de l'application, menu, bandeaux et navigation.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { APP_VERSION, VERSION_BASE } from './version.js';
import {
  esc, q, rpc, erreur, toast, messageErreur, modal, local, estErreurReseau,
  ROLES, DOMAINE_IDENTIFIANTS, MDP_REGLE, mdpValide, isoJour, debutJour, definirRapporteur, rapporter
} from './util.js';
import { lireFile, surChangement, synchroniser } from './hors-ligne.js';

import * as comptoir from './pages/comptoir.js';
import * as entree from './pages/entree.js';
import * as stock from './pages/stock.js';
import * as inventaire from './pages/inventaire.js';
import * as journee from './pages/journee.js';
import * as credits from './pages/credits.js';
import * as programmes from './pages/programmes.js';
import * as point from './pages/point.js';
import * as rapport from './pages/rapport.js';
import * as base from './pages/base.js';
import * as reglages from './pages/reglages.js';
import * as erreurs from './pages/erreurs.js';

const app = document.getElementById('app');

// La bibliothèque Supabase est servie par le site (vendor/) : si elle manque, on le dit clairement.
if (!window.supabase?.createClient) {
  app.innerHTML = '<div class="login-wrap"><div class="login"><div class="alert alert-err">Le site n’a pas pu se charger complètement. Rechargez la page.</div></div></div>';
  throw new Error('vendor/supabase manquant');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// Pages du menu : droit nécessaire (null = tout membre, 'gerant' = gérant seul), groupe d'onglets et icône
const PAGES = [
  { id: 'comptoir', titre: 'Comptoir', module: comptoir, droit: ['vendre', 'programmes'], horsLigne: true, groupe: 'vendre', icone: 'comptoir' },
  { id: 'journee', titre: 'Ma journée', module: journee, droit: ['vendre', 'programmes'], groupe: 'vendre', icone: 'journee' },
  { id: 'credits', titre: 'Crédits', module: credits, droit: ['credit'], groupe: 'vendre', icone: 'credits' },
  { id: 'entree', titre: 'Entrée de stock', court: 'Entrées', module: entree, droit: ['entree'], groupe: 'stock', icone: 'entree' },
  { id: 'stock', titre: 'Mon stock', module: stock, droit: null, groupe: 'stock', icone: 'stock' },
  { id: 'inventaire', titre: 'Inventaire', module: inventaire, droit: ['corriger'], groupe: 'stock', icone: 'inventaire' },
  { id: 'programmes', titre: 'Programmes', module: programmes, droit: ['programmes', 'rapports'], groupe: 'suivi', icone: 'programmes' },
  { id: 'point', titre: 'Point général', court: 'Point', module: point, droit: ['rapports'], groupe: 'suivi', icone: 'point' },
  { id: 'rapport', titre: 'Rapport district', court: 'District', module: rapport, droit: ['rapports'], groupe: 'suivi', icone: 'rapport' },
  { id: 'base', titre: 'Base', module: base, droit: ['base'], groupe: 'gestion', icone: 'base' },
  { id: 'reglages', titre: 'Réglages', module: reglages, droit: 'gerant', groupe: 'gestion', icone: 'reglages' },
  { id: 'erreurs', titre: 'Journal des erreurs', court: 'Erreurs', module: erreurs, droit: 'gerant', groupe: 'gestion', icone: 'alerte' }
];

// Icônes des onglets (traits simples, couleur du texte)
const ICONES = {
  comptoir: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.3 11a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8l1.6-7.5H6.2"/>',
  journee: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h3M8 17h6"/>',
  credits: '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10.5h19M6.5 15h4"/>',
  entree: '<path d="M12 3v10.5M7.8 9.4 12 13.6l4.2-4.2"/><path d="M3.5 14.5v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4"/>',
  stock: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 7.5v9l9 4.5 9-4.5v-9M12 12v9"/>',
  inventaire: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3.2H9zM8.8 13.3l2.2 2.2 4.4-4.4"/>',
  programmes: '<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 4 4 7.6 4.3c1.9.2 3.4 1.4 4.4 2.9 1-1.5 2.5-2.7 4.4-2.9C20 4 22.4 7.6 21.2 11.1 19.5 15.9 12 20.5 12 20.5Z"/><path d="M12 9.5v5M9.5 12h5"/>',
  point: '<path d="M3.5 20.5h17M6.5 17v-5M11 17V7M15.5 17v-7.5M20 17V4.5"/>',
  rapport: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 12.5h7M9 16.5h7"/>',
  base: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  reglages: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  alerte: '<path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 10v4.5M12 17.3v.2"/>'
};
const icone = (nom) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom] || ''}</svg>`;

const ctx = {
  sb,
  version: APP_VERSION,
  profil: null,
  droitsParRole: {},
  pharmacie: {},
  programmes: [],
  derniereSauvegarde: null,
  versionBase: null,
  horsLigne: false,
  get vente() { return this.programmes.find((p) => p.est_vente); },
  peut(droit) {
    if (!this.profil) return false;
    if (this.profil.role === 'gerant') return true;
    if (droit === 'gerant') return false;
    return !!this.droitsParRole[this.profil.role]?.[droit];
  },
  async rechargerContexte() {
    const [params, progs] = await Promise.all([
      q(sb.from('parametres').select('*')),
      q(sb.from('programmes').select('*').order('ordre').order('nom'))
    ]);
    this.droitsParRole = {
      responsable: params.find((p) => p.cle === 'droits_responsable')?.valeur || {},
      vendeur: params.find((p) => p.cle === 'droits_vendeur')?.valeur || {}
    };
    this.pharmacie = params.find((p) => p.cle === 'pharmacie')?.valeur || {};
    this.derniereSauvegarde = params.find((p) => p.cle === 'derniere_sauvegarde')?.valeur || null;
    this.versionBase = Number(params.find((p) => p.cle === 'version_base')?.valeur?.version) || 0;
    this.programmes = progs;
    this.memoriser();
  },
  // Copie du contexte sur l'appareil, pour ouvrir le comptoir sans internet
  memoriser() {
    local.ecrire('contexte', {
      userId: this.profil?.id, profil: this.profil, droitsParRole: this.droitsParRole,
      pharmacie: this.pharmacie, programmes: this.programmes, date: new Date().toISOString()
    });
  },
  naviguer(id) { location.hash = '#/' + id; },
  majBandeaux() { majBandeaux(); },
  async synchroniser() { return lancerSynchro(); }
};

const pageAutorisee = (p) => {
  if (ctx.horsLigne && !p.horsLigne && p.id !== 'journee') return false;
  if (p.droit === null) return true;
  if (p.droit === 'gerant') return ctx.peut('gerant');
  return p.droit.some((d) => ctx.peut(d));
};

// ---------- Connexion ----------

// L'identifiant devient une adresse interne ; une vraie adresse e-mail reste acceptée (compte du gérant).
const versEmail = (identifiant) => {
  const t = identifiant.trim().toLowerCase();
  return t.includes('@') ? t : t + '@' + DOMAINE_IDENTIFIANTS;
};

// Champ mot de passe avec bouton « Afficher » (comme labo)
const champMdp = (id, libelle, autocomplete) => `
  <div><label class="lbl" for="${id}">${esc(libelle)}</label>
    <div class="mdp"><input class="in" id="${id}" type="password" autocomplete="${autocomplete}">
    <button type="button" data-oeil="${id}" aria-label="Afficher le mot de passe">Afficher</button></div></div>`;
function brancherOeils(racine) {
  racine.querySelectorAll('[data-oeil]').forEach((b) => b.onclick = () => {
    const i = racine.querySelector('#' + b.dataset.oeil);
    const voir = i.type === 'password';
    i.type = voir ? 'text' : 'password';
    b.textContent = voir ? 'Masquer' : 'Afficher';
    b.setAttribute('aria-label', voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  });
}

function afficherConnexion(message = '') {
  let oubli = false;
  const dessiner = () => {
    app.innerHTML = `
      <div class="login-wrap">
        <form class="login" novalidate>
          <div class="brand"><div class="logo" aria-hidden="true">+</div>
            <div><div style="font-weight:700;font-size:18px">Pharmacie Simple</div>
            <div class="small muted">${oubli ? 'Mot de passe oublié' : 'Connexion'}</div></div>
          </div>
          ${message ? `<div class="alert alert-warn" role="alert">${esc(message)}</div>` : ''}
          ${!navigator.onLine ? '<div class="alert alert-warn">Pas de connexion internet : la connexion sera possible dès le retour du réseau.</div>' : ''}
          ${oubli ? `
            <p style="margin:0">Demandez au <strong>gérant</strong> de vous donner un nouveau mot de passe (Réglages → Utilisateurs).</p>
            <p class="small muted" style="margin:0">Le gérant qui se connecte avec une adresse e-mail peut recevoir un lien de réinitialisation :</p>
            <div><label class="lbl" for="email">Adresse e-mail du gérant</label><input class="in" id="email" type="email" autocomplete="email"></div>
            <button class="btn btn-p" type="submit">Recevoir le lien</button>` : `
            <div><label class="lbl" for="identifiant">Identifiant</label><input class="in" id="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(local.lire('dernier_identifiant', ''))}"></div>
            ${champMdp('mdp', 'Mot de passe', 'current-password')}
            <button class="btn btn-p btn-big" type="submit">Se connecter</button>`}
          <button type="button" class="link" id="bascule" style="align-self:flex-start">${oubli ? 'Retour à la connexion' : 'Mot de passe oublié ?'}</button>
          <div class="small muted">Version ${esc(APP_VERSION)}</div>
        </form>
      </div>`;
    brancherOeils(app);
    const ident = app.querySelector('#identifiant');
    if (ident) (ident.value ? app.querySelector('#mdp') : ident).focus();
    app.querySelector('#bascule').onclick = () => { oubli = !oubli; message = ''; dessiner(); };
    app.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const bouton = app.querySelector('button[type=submit]');
      bouton.disabled = true;
      try {
        if (!oubli) {
          const identifiant = app.querySelector('#identifiant').value;
          if (!identifiant.trim()) throw new Error('Saisissez votre identifiant.');
          const mdp = app.querySelector('#mdp').value;
          if (!mdp) throw new Error('Saisissez votre mot de passe.');
          const { error } = await sb.auth.signInWithPassword({ email: versEmail(identifiant), password: mdp });
          if (error) throw error;
          // Journal du gérant : qui s'est connecté, et quand (sans bloquer l'ouverture)
          sb.rpc('journal_connexion', { p_evenement: 'connexion' }).then(() => {}, () => {});
          local.ecrire('dernier_identifiant', identifiant.trim().toLowerCase());
        } else {
          const email = app.querySelector('#email').value.trim();
          if (!email.includes('@') || email.endsWith('@' + DOMAINE_IDENTIFIANTS)) throw new Error('Saisissez une vraie adresse e-mail, ou demandez au gérant.');
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          oubli = false;
          message = 'Si ce compte existe, un e-mail de réinitialisation vient d’être envoyé.';
          dessiner();
        }
      } catch (err) {
        if (/Invalid login/i.test(err.message)) message = 'Identifiant ou mot de passe incorrect.';
        else if (/rate limit|too many/i.test(err.message)) message = 'Trop d’essais : patientez quelques minutes avant de réessayer.';
        else message = messageErreur(err);
        dessiner();
      }
    };
  };
  dessiner();
}

// Choix d'un mot de passe : après un lien « mot de passe oublié » ou un mot de passe temporaire donné par le gérant
function afficherChoixMotDePasse({ obligatoire = false } = {}) {
  app.innerHTML = `
    <div class="login-wrap"><form class="login" novalidate>
      <h1>${obligatoire ? 'Choisissez votre mot de passe' : 'Nouveau mot de passe'}</h1>
      ${obligatoire ? '<p style="margin:0">Le gérant vous a donné un mot de passe temporaire. Choisissez maintenant le vôtre : vous seul le connaîtrez.</p>' : ''}
      ${champMdp('n1', 'Nouveau mot de passe', 'new-password')}
      ${champMdp('n2', 'Confirmer le mot de passe', 'new-password')}
      <div class="small muted">${esc(MDP_REGLE)}</div>
      <div class="alert alert-err hidden" id="err" role="alert"></div>
      <button class="btn btn-p btn-big" type="submit">Enregistrer</button>
      ${obligatoire ? '<button type="button" class="link" id="sortir" style="align-self:flex-start">Se déconnecter</button>' : ''}
    </form></div>`;
  brancherOeils(app);
  app.querySelector('#n1').focus();
  const sortir = app.querySelector('#sortir');
  if (sortir) sortir.onclick = () => sb.auth.signOut();
  app.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const a = app.querySelector('#n1').value;
    const z = app.querySelector('#err');
    const montrer = (t) => { z.textContent = t; z.classList.remove('hidden'); };
    if (!mdpValide(a)) return montrer(MDP_REGLE);
    if (a !== app.querySelector('#n2').value) return montrer('Les deux mots de passe sont différents.');
    const bouton = app.querySelector('button[type=submit]');
    bouton.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { bouton.disabled = false; return montrer(/same/i.test(error.message) ? 'Choisissez un mot de passe différent de l’ancien.' : messageErreur(error)); }
    try { await rpc(sb, 'mot_de_passe_personnel_defini', {}); } catch (_) { /* le drapeau sera repris à la prochaine connexion */ }
    toast('Mot de passe enregistré.');
    history.replaceState(null, '', location.pathname + '#/comptoir');
    demarrer();
  };
}

// ---------- Bandeaux : hors ligne, ventes en attente, sauvegarde, nouvelle version ----------

let nouvelleVersion = false;

function majBandeaux() {
  const zone = document.getElementById('bandeaux');
  if (!zone || !ctx.profil) return;
  const file = lireFile().filter((x) => x.utilisateur === ctx.profil.id);
  const attente = file.filter((x) => x.etat === 'attente').length;
  const erreurs = file.filter((x) => x.etat === 'erreur').length;
  const html = [];
  if (!navigator.onLine || ctx.horsLigne) {
    html.push(`<div class="bandeau bandeau-off" role="status">Hors ligne : le comptoir continue, les ventes seront envoyées au retour d’internet.${attente ? ' ' + attente + ' vente(s) en attente.' : ''}</div>`);
  } else if (attente) {
    html.push(`<div class="bandeau bandeau-off" role="status">${attente} vente(s) faite(s) hors ligne en cours d’envoi… <button class="btn btn-sm" id="synchro">Envoyer maintenant</button></div>`);
  }
  if (erreurs) {
    html.push(`<div class="bandeau bandeau-err" role="alert">${erreurs} vente(s) hors ligne refusée(s) par le serveur : <a href="#/journee">à régler dans Ma journée</a></div>`);
  }
  if (ctx.peut('gerant') && !ctx.horsLigne && ctx.versionBase !== null && ctx.versionBase < VERSION_BASE) {
    html.push(`<div class="bandeau bandeau-err" role="alert">La base de données n’est pas à jour (version ${ctx.versionBase}, il faut la ${VERSION_BASE}) : l’inventaire, les commandes et la vente hors ligne ne marcheront pas. Appliquez les migrations du dossier supabase/migrations (voir le README).</div>`);
  }
  if (ctx.peut('gerant') && !ctx.horsLigne) {
    const d = ctx.derniereSauvegarde?.date;
    const jours = d ? Math.floor((debutJour(isoJour()) - debutJour(String(d).slice(0, 10))) / 86400000) : null;
    if (jours === null || jours >= 7) {
      html.push(`<div class="bandeau bandeau-maj">${jours === null ? 'Aucune sauvegarde téléchargée pour l’instant.' : 'Dernière sauvegarde il y a ' + jours + ' jours.'} <a href="#/reglages">Faire une sauvegarde</a></div>`);
    }
  }
  if (nouvelleVersion) {
    html.push('<div class="bandeau bandeau-maj" role="status">Une nouvelle version du site est installée. <button class="btn btn-sm" id="recharger">Recharger</button></div>');
  }
  zone.innerHTML = html.join('');
  const s = zone.querySelector('#synchro');
  if (s) s.onclick = () => lancerSynchro(true);
  const r = zone.querySelector('#recharger');
  if (r) r.onclick = () => location.reload();
}

async function lancerSynchro(afficher = false) {
  if (!ctx.profil || ctx.horsLigne) return;
  const { envoyees } = await synchroniser(sb, ctx.profil.id);
  if (envoyees || afficher) toast(envoyees ? envoyees + ' vente(s) hors ligne enregistrée(s) sur le serveur.' : 'Rien à envoyer pour l’instant.', envoyees ? 'ok' : 'warn');
  majBandeaux();
  return envoyees;
}

// ---------- Application ----------

let pageCourante = null;

// Onglets regroupés (vendre · stock · suivi · gestion), séparés par un trait fin
const menuHtml = () => {
  const groupes = [];
  for (const p of PAGES.filter(pageAutorisee)) {
    if (!groupes.length || groupes[groupes.length - 1].nom !== p.groupe) groupes.push({ nom: p.groupe, pages: [] });
    groupes[groupes.length - 1].pages.push(p);
  }
  return groupes.map((g) => `<div class="groupe">${g.pages.map((p) => `<a href="#/${p.id}" data-page="${p.id}" title="${esc(p.titre)}">${icone(p.icone)}${p.id === 'erreurs' ? '<span class="pastille hidden" aria-label="à corriger"></span>' : ''}${p.court ? `<span class="long">${esc(p.titre)}</span><span class="court">${esc(p.court)}</span>` : `<span>${esc(p.titre)}</span>`}</a>`).join('')}</div>`)
    .join('<span class="sep" aria-hidden="true"></span>')
    + `<span class="version">v${esc(APP_VERSION)}</span>`;
};
// Onglet actif : souligné, et ramené dans la zone visible quand la barre défile (téléphone)
function marquerOnglet(id) {
  const nav = document.querySelector('nav.menu');
  if (!nav) return;
  nav.querySelectorAll('a').forEach((a) => {
    const on = a.dataset.page === id;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
  });
}

function dessinerCadre() {
  app.innerHTML = `
    <div id="bandeaux"></div>
    <header class="topbar">
      <div class="brand"><div class="logo" aria-hidden="true">+</div>
        <div><div class="brand-nom">${esc(ctx.pharmacie.nom || 'Pharmacie')}</div>
        <div class="brand-sous" id="sous-titre">${esc(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
      </div>
      <div class="user-box">
        <span class="qui"><strong>${esc(String(ctx.profil.nom || ctx.profil.identifiant || ctx.profil.email).toUpperCase())}</strong><small>${esc(ROLES[ctx.profil.role] || ctx.profil.role)} · v${esc(APP_VERSION)}</small></span>
        ${ctx.horsLigne ? '' : '<button type="button" id="mon-mdp">Mon mot de passe</button>'}
        <button type="button" id="deconnexion">Se déconnecter</button>
      </div>
    </header>
    <nav class="menu" aria-label="Menu principal">${menuHtml()}</nav>
    <main class="page" id="contenu"></main>`;
  app.querySelector('#deconnexion').onclick = async () => {
    const enAttente = lireFile().filter((x) => x.utilisateur === ctx.profil.id).length;
    if (enAttente && !confirm(enAttente + ' vente(s) hors ligne ne sont pas encore envoyées. Elles resteront sur cet appareil et partiront à votre prochaine connexion. Se déconnecter quand même ?')) return;
    if (ctx.horsLigne) { ctx.horsLigne = false; ctx.profil = null; demarre = false; return afficherConnexion(); }
    // Notée au journal avant de partir (2 secondes au plus : une mauvaise connexion ne bloque pas la sortie)
    await Promise.race([sb.rpc('journal_connexion', { p_evenement: 'deconnexion' }).then(() => {}, () => {}), new Promise((ok) => setTimeout(ok, 2000))]);
    sb.auth.signOut();
  };
  brancherMonMdp();
  majBandeaux();
}

function brancherMonMdp() {
  const mm = app.querySelector('#mon-mdp');
  if (mm) mm.onclick = () => {
    const m = modal('Changer mon mot de passe', `
      ${champMdp('n1', 'Nouveau mot de passe', 'new-password')}
      ${champMdp('n2', 'Confirmer', 'new-password')}
      <div class="small muted">${esc(MDP_REGLE)}</div>
      <button class="btn btn-p" id="ok">Enregistrer</button>`);
    brancherOeils(m.el);
    m.el.querySelector('#ok').onclick = async () => {
      const a = m.el.querySelector('#n1').value;
      if (!mdpValide(a)) return toast(MDP_REGLE, 'warn');
      if (a !== m.el.querySelector('#n2').value) return toast('Les deux mots de passe sont différents.', 'warn');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return erreur(error);
      try { await rpc(sb, 'mot_de_passe_personnel_defini', {}); } catch (_) { /* sans effet si déjà fait */ }
      m.fermer();
      toast('Mot de passe modifié.');
    };
  };
}

async function majCaisse() {
  if (ctx.horsLigne) return;
  try {
    const data = await q(sb.from('caisses').select('id, ouverte_le').is('fermee_le', null).maybeSingle());
    local.ecrire('caisse', data);
    const st = document.getElementById('sous-titre');
    if (st) st.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + (data ? 'Caisse ouverte' : 'Caisse fermée');
  } catch (_) { /* affichage seulement */ }
}
ctx.majCaisse = majCaisse;

async function afficherPage() {
  const pages = PAGES.filter(pageAutorisee);
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const page = pages.find((p) => p.id === id) || pages[0];
  if (!page) return;
  if (page.id !== id) { history.replaceState(null, '', '#/' + page.id); }
  marquerOnglet(page.id);
  const el = document.getElementById('contenu');
  if (pageCourante?.module.quitter) pageCourante.module.quitter();
  pageCourante = page;
  el.innerHTML = '<div class="muted">Chargement…</div>';
  delete el.dataset.pret;
  try {
    await page.module.render(el, ctx);
  } catch (e) {
    el.innerHTML = `<div class="alert alert-err" role="alert">${esc(messageErreur(e))}</div>`;
    console.error(e);
  }
  // Repère « page affichée » (utilisé par les tests automatiques)
  if (pageCourante === page) el.dataset.pret = page.id;
  majCaisse();
}

let demarre = false;
let demarrage = null;
let messageDeconnexion = ''; // affiché sur l'écran de connexion après une déconnexion forcée
function demarrer() {
  if (!demarrage) demarrage = lancer().finally(() => { demarrage = null; });
  return demarrage;
}

// Ouverture sans internet avec le dernier contexte connu de cet appareil (comptoir seulement)
function ouvrirHorsLigne(copie) {
  Object.assign(ctx, { profil: copie.profil, droitsParRole: copie.droitsParRole, pharmacie: copie.pharmacie, programmes: copie.programmes, horsLigne: true });
  demarre = true;
  dessinerCadre();
  afficherPage();
}

async function lancer() {
  const copie = local.lire('contexte');
  let session = null;
  try {
    ({ data: { session } } = await sb.auth.getSession());
  } catch (e) {
    if (!estErreurReseau(e)) throw e;
  }
  if (!session) {
    if (!navigator.onLine && copie?.profil) return ouvrirHorsLigne(copie);
    demarre = false;
    return afficherConnexion();
  }
  try {
    ctx.profil = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!ctx.profil) return afficherConnexion('Profil introuvable. Contactez le gérant.');
    if (!ctx.profil.actif) return deconnecterAvecMessage('Ce compte est désactivé. Contactez le gérant.');
    if (ctx.profil.doit_changer_mdp) return afficherChoixMotDePasse({ obligatoire: true });
    await ctx.rechargerContexte();
    ctx.horsLigne = false;
  } catch (e) {
    if (estErreurReseau(e) && copie?.profil && copie.userId === session.user.id) return ouvrirHorsLigne(copie);
    return afficherConnexion(messageErreur(e));
  }
  demarre = true;
  dessinerCadre();
  afficherPage();
  lancerSynchro();
  majPastille();
}

// ---------- Journal des erreurs (gérant) ----------

// Chaque erreur affichée à un agent est envoyée au journal du gérant (une même erreur au plus une fois par minute)
const dejaSignalees = new Map();
definirRapporteur((e, details = {}) => {
  if (!ctx.profil || ctx.horsLigne || !navigator.onLine) return;
  const message = messageErreur(e);
  const page = pageCourante?.id || '';
  const cle = page + '|' + message;
  if (Date.now() - (dejaSignalees.get(cle) || 0) < 60000) return;
  dejaSignalees.set(cle, Date.now());
  const brut = e?.message && e.message !== message ? e.message : undefined;
  const pile = e instanceof Error && !(e.code) ? String(e.stack || '').split('\n').slice(0, 4).join('\n') : undefined;
  sb.rpc('signaler_erreur', { p: {
    page, message, version: APP_VERSION, appareil: navigator.userAgent.slice(0, 120),
    details: { ...details, ...(e?.code ? { code: e.code } : {}), ...(brut ? { original: brut.slice(0, 300) } : {}), ...(pile ? { pile } : {}) }
  } }).then(() => { if (ctx.peut('gerant')) majPastille(); }, () => {});
});

// Pastille sur l'onglet « Erreurs » : anomalies graves ou à vérifier + erreurs pas encore vues
async function majPastille(anomalies, nbNonVues) {
  if (!ctx.peut('gerant') || ctx.horsLigne) return;
  try {
    if (anomalies === undefined) {
      [anomalies, nbNonVues] = await Promise.all([
        rpc(sb, 'anomalies', {}),
        q(sb.from('erreurs').select('id').eq('vu', false).limit(100)).then((l) => l.length)
      ]);
    }
    const n = anomalies.filter((a) => a.gravite !== 'info').length + nbNonVues;
    const pastille = document.querySelector('nav.menu a[data-page="erreurs"] .pastille');
    if (pastille) {
      pastille.textContent = n > 99 ? '99+' : String(n);
      pastille.classList.toggle('hidden', !n);
    }
  } catch (_) { /* base pas encore à jour, ou réseau : la pastille attendra */ }
}
ctx.majPastille = majPastille;

// Déconnexion forcée : le message reste affiché (l'événement SIGNED_OUT redessine l'écran de connexion)
async function deconnecterAvecMessage(message) {
  messageDeconnexion = message;
  demarre = false;
  ctx.profil = null;
  try { await sb.auth.signOut(); } catch (_) { /* hors ligne : la session locale est quand même effacée */ }
  afficherConnexion(message);
}

// Compte désactivé par le gérant pendant qu'il est utilisé : déconnexion à la vérification suivante
async function verifierCompte() {
  if (!demarre || ctx.horsLigne || !ctx.profil || !navigator.onLine) return;
  try {
    const p = await q(sb.from('profiles').select('actif, role').eq('id', ctx.profil.id).maybeSingle());
    if (!p || !p.actif) return deconnecterAvecMessage('Ce compte a été désactivé par le gérant.');
    if (p.role !== ctx.profil.role) {
      // Le menu suit le nouveau rôle ; la page en cours (un panier par exemple) n'est pas effacée
      ctx.profil.role = p.role;
      ctx.memoriser();
      document.querySelector('nav.menu').innerHTML = menuHtml();
      marquerOnglet(pageCourante?.id);
      majPastille();
      toast('Votre rôle a été changé par le gérant : ' + (ROLES[p.role] || p.role) + '.', 'warn');
    }
  } catch (_) { /* réseau : on réessaiera */ }
}

window.addEventListener('hashchange', () => { if (demarre) afficherPage(); });
// Filet de sécurité : une erreur imprévue (bouton, rechargement d'écran) s'affiche au lieu de passer inaperçue
window.addEventListener('unhandledrejection', (e) => { erreur(e.reason); });
window.addEventListener('error', (e) => { if (e.error) rapporter(e.error, { fichier: String(e.filename || '').split('/').pop(), ligne: e.lineno }); });
window.addEventListener('offline', () => majBandeaux());
// Retour du réseau alors que l'application a démarré hors ligne : on repasse en ligne SANS redessiner
// la page en cours (un panier en train d'être saisi au comptoir n'est pas perdu)
let reprise = null;
async function reprendreEnLigne() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.id !== ctx.profil?.id) { ctx.horsLigne = false; demarre = false; return demarrer(); }
    const profil = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!profil || !profil.actif) return deconnecterAvecMessage('Ce compte est désactivé. Contactez le gérant.');
    ctx.profil = profil;
    await ctx.rechargerContexte();
    ctx.horsLigne = false;
    document.querySelector('nav.menu').innerHTML = menuHtml();
    marquerOnglet(pageCourante?.id);
    const boite = document.querySelector('.user-box');
    if (boite && !boite.querySelector('#mon-mdp')) {
      boite.querySelector('#deconnexion').insertAdjacentHTML('beforebegin', '<button type="button" id="mon-mdp">Mon mot de passe</button>');
      brancherMonMdp();
    }
    majCaisse();
    await lancerSynchro();
    if (pageCourante?.id === 'journee') afficherPage();
  } catch (_) {
    // Réseau encore instable : on restera hors ligne jusqu'au prochain retour
  }
}
window.addEventListener('online', () => {
  if (ctx.horsLigne) { if (!reprise) reprise = reprendreEnLigne().finally(() => { reprise = null; majBandeaux(); }); } else { majBandeaux(); lancerSynchro(); }
});
surChangement(() => majBandeaux());
setInterval(() => { if (demarre && navigator.onLine) { lancerSynchro(); verifierCompte(); } }, 60000);

sb.auth.onAuthStateChange((evenement) => {
  // Jamais d'appel Supabase directement dans ce rappel (risque de blocage) : on diffère
  setTimeout(() => {
    if (evenement === 'PASSWORD_RECOVERY') return afficherChoixMotDePasse();
    if (evenement === 'SIGNED_OUT') { demarre = false; ctx.profil = null; afficherConnexion(messageDeconnexion); messageDeconnexion = ''; }
    if (evenement === 'SIGNED_IN' && !demarre) demarrer();
  }, 0);
});

// Service worker : fonctionnement hors ligne et détection d'une nouvelle version
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }).catch(() => { /* le site marche aussi sans */ });
  let dejaControle = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Pas de rechargement automatique : un panier en cours serait perdu
    if (dejaControle) { nouvelleVersion = true; majBandeaux(); }
    dejaControle = true;
  });
}

demarrer();
