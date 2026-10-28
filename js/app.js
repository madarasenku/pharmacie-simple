import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { esc, q, erreur, toast, messageErreur, modal, ROLES, DOMAINE_IDENTIFIANTS } from './util.js';

import * as comptoir from './pages/comptoir.js';
import * as entree from './pages/entree.js';
import * as stock from './pages/stock.js';
import * as journee from './pages/journee.js';
import * as credits from './pages/credits.js';
import * as programmes from './pages/programmes.js';
import * as point from './pages/point.js';
import * as rapport from './pages/rapport.js';
import * as base from './pages/base.js';
import * as reglages from './pages/reglages.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');

// Pages du menu : droit nécessaire (null = tout membre, 'gerant' = gérant seul)
const PAGES = [
  { id: 'comptoir', titre: 'Comptoir', module: comptoir, droit: ['vendre', 'programmes'] },
  { id: 'entree', titre: 'Entrée de stock', module: entree, droit: ['entree'] },
  { id: 'stock', titre: 'Mon stock', module: stock, droit: null },
  { id: 'journee', titre: 'Ma journée', module: journee, droit: ['vendre'] },
  { id: 'credits', titre: 'Crédits', module: credits, droit: ['credit'] },
  { id: 'programmes', titre: 'Programmes', module: programmes, droit: ['programmes', 'rapports'] },
  { id: 'point', titre: 'Point général', module: point, droit: ['rapports'] },
  { id: 'rapport', titre: 'Rapport district', module: rapport, droit: ['rapports'] },
  { id: 'base', titre: 'Base', module: base, droit: ['base'] },
  { id: 'reglages', titre: 'Réglages', module: reglages, droit: 'gerant' }
];

const ctx = {
  sb,
  profil: null,
  droits: {},
  droitsParRole: {},
  pharmacie: {},
  programmes: [],
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
    this.programmes = progs;
  },
  naviguer(id) { location.hash = '#/' + id; }
};

const pageAutorisee = (p) => {
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
          ${message ? `<div class="alert alert-warn">${esc(message)}</div>` : ''}
          ${oubli ? `
            <p style="margin:0">Demandez au <strong>gérant</strong> de vous donner un nouveau mot de passe (Réglages → Utilisateurs).</p>
            <p class="small muted" style="margin:0">Le gérant qui se connecte avec une adresse e-mail peut recevoir un lien de réinitialisation :</p>
            <div><label class="lbl" for="email">Adresse e-mail du gérant</label><input class="in" id="email" type="email" autocomplete="email"></div>
            <button class="btn btn-p" type="submit">Recevoir le lien</button>` : `
            <div><label class="lbl" for="identifiant">Identifiant</label><input class="in" id="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
            <div><label class="lbl" for="mdp">Mot de passe</label><input class="in" id="mdp" type="password" autocomplete="current-password" required></div>
            <button class="btn btn-p btn-big" type="submit">Se connecter</button>`}
          <button type="button" class="link" id="bascule" style="align-self:flex-start">${oubli ? 'Retour à la connexion' : 'Mot de passe oublié ?'}</button>
        </form>
      </div>`;
    app.querySelector('#bascule').onclick = () => { oubli = !oubli; message = ''; dessiner(); };
    app.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const bouton = app.querySelector('button[type=submit]');
      bouton.disabled = true;
      try {
        if (!oubli) {
          const identifiant = app.querySelector('#identifiant').value;
          if (!identifiant.trim()) throw new Error('Saisissez votre identifiant.');
          const { error } = await sb.auth.signInWithPassword({ email: versEmail(identifiant), password: app.querySelector('#mdp').value });
          if (error) throw error;
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
        message = /Invalid login/i.test(err.message) ? 'Identifiant ou mot de passe incorrect.' : messageErreur(err);
        dessiner();
      }
    };
  };
  dessiner();
}

function afficherNouveauMotDePasse() {
  app.innerHTML = `
    <div class="login-wrap"><form class="login">
      <h1>Nouveau mot de passe</h1>
      <div><label class="lbl" for="mdp">Mot de passe (6 caractères minimum)</label><input class="in" id="mdp" type="password" minlength="6" autocomplete="new-password" required></div>
      <button class="btn btn-p btn-big" type="submit">Enregistrer</button>
    </form></div>`;
  app.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: app.querySelector('#mdp').value });
    if (error) return erreur(error);
    toast('Mot de passe modifié.');
    history.replaceState(null, '', location.pathname);
    demarrer();
  };
}

// ---------- Application ----------

let pageCourante = null;

function dessinerCadre() {
  const pages = PAGES.filter(pageAutorisee);
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="logo" aria-hidden="true">+</div>
        <div><div class="brand-nom">${esc(ctx.pharmacie.nom || 'Pharmacie')}</div>
        <div class="brand-sous" id="sous-titre">${esc(new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
      </div>
      <div class="user-box">
        <span>${esc(ctx.profil.nom || ctx.profil.identifiant || ctx.profil.email)} · ${esc(ROLES[ctx.profil.role] || ctx.profil.role)}</span>
        <button type="button" id="mon-mdp">Mon mot de passe</button>
        <button type="button" id="deconnexion">Se déconnecter</button>
      </div>
    </header>
    <nav class="menu" aria-label="Menu principal">
      ${pages.map((p) => `<a href="#/${p.id}" data-page="${p.id}">${esc(p.titre)}</a>`).join('')}
    </nav>
    <main class="page" id="contenu"></main>`;
  app.querySelector('#deconnexion').onclick = () => sb.auth.signOut();
  app.querySelector('#mon-mdp').onclick = () => {
    const m = modal('Changer mon mot de passe', `
      <div><label class="lbl" for="n1">Nouveau mot de passe (6 caractères minimum)</label><input class="in" id="n1" type="password" autocomplete="new-password"></div>
      <div><label class="lbl" for="n2">Confirmer</label><input class="in" id="n2" type="password" autocomplete="new-password"></div>
      <button class="btn btn-p" id="ok">Enregistrer</button>`);
    m.el.querySelector('#ok').onclick = async () => {
      const a = m.el.querySelector('#n1').value;
      if (a.length < 6) return toast('6 caractères minimum.', 'warn');
      if (a !== m.el.querySelector('#n2').value) return toast('Les deux mots de passe sont différents.', 'warn');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return erreur(error);
      m.fermer();
      toast('Mot de passe modifié.');
    };
  };
}

async function majCaisse() {
  try {
    const { data } = await sb.from('caisses').select('id, ouverte_le').is('fermee_le', null).maybeSingle();
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
  document.querySelectorAll('nav.menu a').forEach((a) => a.classList.toggle('on', a.dataset.page === page.id));
  const el = document.getElementById('contenu');
  if (pageCourante?.module.quitter) pageCourante.module.quitter();
  pageCourante = page;
  el.innerHTML = '<div class="muted">Chargement…</div>';
  try {
    await page.module.render(el, ctx);
  } catch (e) {
    el.innerHTML = `<div class="alert alert-err">${esc(messageErreur(e))}</div>`;
    console.error(e);
  }
  majCaisse();
}

let demarre = false;
let demarrage = null;
function demarrer() {
  if (!demarrage) demarrage = lancer().finally(() => { demarrage = null; });
  return demarrage;
}
async function lancer() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { demarre = false; return afficherConnexion(); }
  try {
    ctx.profil = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!ctx.profil) return afficherConnexion('Profil introuvable. Contactez le gérant.');
    if (!ctx.profil.actif) {
      await sb.auth.signOut();
      return afficherConnexion('Ce compte est désactivé. Contactez le gérant.');
    }
    await ctx.rechargerContexte();
  } catch (e) {
    return afficherConnexion(messageErreur(e));
  }
  demarre = true;
  dessinerCadre();
  afficherPage();
}

window.addEventListener('hashchange', () => { if (demarre) afficherPage(); });
sb.auth.onAuthStateChange((evenement) => {
  if (evenement === 'PASSWORD_RECOVERY') return afficherNouveauMotDePasse();
  if (evenement === 'SIGNED_OUT') { demarre = false; ctx.profil = null; afficherConnexion(); }
  if (evenement === 'SIGNED_IN' && !demarre) demarrer();
});

demarrer();
