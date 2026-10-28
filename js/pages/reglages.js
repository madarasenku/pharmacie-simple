// Réglages (gérant) : pharmacie, droits du vendeur, utilisateurs, journal et sauvegarde.
import { esc, fmtDateHeure, q, erreur, toast, telecharger, isoJour, modal, ROLES, DOMAINE_IDENTIFIANTS } from '../util.js';

const DROITS = [
  ['vendre', 'Vendre et encaisser'], ['entree', 'Entrée de stock'], ['credit', 'Vente à crédit'], ['programmes', 'Distribuer (programmes)'],
  ['corriger', 'Corriger le stock'], ['annuler', 'Annuler une vente'], ['prix', 'Changer les prix de vente'], ['rapports', 'Voir bénéfice et rapports'], ['base', 'Modifier la Base']
];
const ACTIONS = { correction: ['Correction stock', 'b-low'], annulation: ['Annulation', 'b-out'], prix: ['Prix modifié', 'b-exp'], ouverture_caisse: ['Ouverture caisse', 'b-ok'], fermeture_caisse: ['Fermeture caisse', 'b-ok'], utilisateur_cree: ['Compte créé', 'b-prog'], mot_de_passe_change: ['Mot de passe changé', 'b-prog'] };

// Appel de la fonction serveur « utilisateurs » (réservée au gérant)
async function appelUtilisateurs(sb, corps) {
  const { data, error } = await sb.functions.invoke('utilisateurs', { body: corps });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return data;
}

export async function render(el, ctx) {
  const { sb } = ctx;
  let filtre = '';

  async function dessiner() {
    const [profils, journal] = await Promise.all([
      q(sb.from('profiles').select('*').order('created_at')),
      q(sb.from('journal').select('*, profiles(nom)').order('created_at', { ascending: false }).limit(200))
    ]);
    const ph = ctx.pharmacie;
    const liste = journal.filter((j) => !filtre || j.action === filtre);

    el.innerHTML = `
      <div class="page-head"><div><h1>Réglages</h1><div class="small muted">Réservé au gérant.</div></div></div>
      <div class="row">
        <section class="card card-pad stack" style="flex:1 1 420px">
          <h2>La pharmacie</h2>
          <div><label class="lbl" for="ph-nom">Nom affiché</label><input class="in" id="ph-nom" value="${esc(ph.nom || '')}"></div>
          <div class="grid-2">
            <div><label class="lbl" for="ph-region">Région sanitaire</label><input class="in" id="ph-region" value="${esc(ph.region || '')}"></div>
            <div><label class="lbl" for="ph-district">District sanitaire</label><input class="in" id="ph-district" value="${esc(ph.district || '')}"></div>
            <div class="span-2"><label class="lbl" for="ph-etab">Établissement sanitaire</label><input class="in" id="ph-etab" value="${esc(ph.etablissement || '')}"></div>
            <div><label class="lbl" for="ph-tel">Téléphone</label><input class="in" id="ph-tel" value="${esc(ph.telephone || '')}"></div>
            <div><label class="lbl" for="ph-adr">Adresse</label><input class="in" id="ph-adr" value="${esc(ph.adresse || '')}"></div>
          </div>
          <button class="btn btn-p" id="ph-ok">Enregistrer</button>
        </section>

        <section class="card" style="flex:1 1 420px">
          <div class="card-head"><div><h2>Droits par rôle</h2><div class="small muted">Le gérant (administrateur) a toujours tous les droits, dont les Réglages.</div></div></div>
          <div class="table-box"><table class="tbl">
            <thead><tr><th>Droit</th><th style="text-align:center">Responsable</th><th style="text-align:center">Vendeur</th></tr></thead>
            <tbody>${DROITS.map(([k, l]) => `<tr><td>${esc(l)}</td>
              ${['responsable', 'vendeur'].map((r) => `<td style="text-align:center"><input type="checkbox" style="width:22px;height:22px;accent-color:var(--vert)" data-droit="${k}" data-role-droit="${r}" ${ctx.droitsParRole[r]?.[k] ? 'checked' : ''} aria-label="${esc(ROLES[r])} : ${esc(l)}"></td>`).join('')}</tr>`).join('')}
            </tbody></table></div>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><div><h2>Utilisateurs</h2><div class="small muted">Chaque personne se connecte avec son identifiant et son mot de passe. Vous créez les comptes ici.</div></div>
          <button class="btn btn-p" id="nouvel-utilisateur">+ Nouvel utilisateur</button></div>
        <div class="table-box"><table class="tbl"><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Actif</th><th>Créé le</th><th></th></tr></thead>
          <tbody>${profils.map((u) => `<tr><td>${esc(u.nom)}</td>
            <td class="num small">${esc(u.identifiant || (u.email && !u.email.endsWith('@' + DOMAINE_IDENTIFIANTS) ? u.email : ''))}</td>
            <td><select class="in" style="width:160px" data-role="${u.id}" ${u.id === ctx.profil.id ? 'disabled title="Vous ne pouvez pas changer votre propre rôle"' : ''}>
              ${Object.entries(ROLES).map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
            <td><input type="checkbox" style="width:22px;height:22px;accent-color:var(--vert)" data-actif="${u.id}" ${u.actif ? 'checked' : ''} ${u.id === ctx.profil.id ? 'disabled' : ''} aria-label="Compte actif"></td>
            <td class="num small">${fmtDateHeure(u.created_at)}</td>
            <td>${u.id === ctx.profil.id ? '' : `<button class="btn btn-sm" data-mdp="${u.id}" data-nom="${esc(u.nom)}">Nouveau mot de passe</button>`}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Sauvegarde</h2><div class="small muted">Les données sont enregistrées en ligne dans Supabase. Téléchargez aussi une copie régulièrement (clé USB, ordinateur).</div></div>
          <button class="btn btn-p" id="sauvegarde">Télécharger une sauvegarde complète</button></div>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Journal des actions sensibles</h2><div class="small muted">Rien ne s'efface : corrections, annulations, prix, caisse.</div></div>
          <div class="inline">${[['', 'Tout'], ['correction', 'Corrections'], ['annulation', 'Annulations'], ['prix', 'Prix'], ['fermeture_caisse', 'Caisse']].map(([k, l]) => `<button class="chip ${filtre === k ? 'on' : ''}" data-j="${k}">${l}</button>`).join('')}</div></div>
        <div class="table-box"><table class="tbl"><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Détail</th></tr></thead>
          <tbody>${liste.map((j) => {
            const a = ACTIONS[j.action] || [j.action, 'b-ok'];
            return `<tr><td class="num small">${fmtDateHeure(j.created_at)}</td><td>${esc(j.profiles?.nom || '')}</td><td><span class="badge ${a[1]}">${esc(a[0])}</span></td>
              <td class="small">${esc(Object.entries(j.details || {}).map(([k, v]) => k + ' : ' + v).join(' · '))}</td></tr>`;
          }).join('') || '<tr><td colspan="4" class="muted">Rien pour l’instant.</td></tr>'}</tbody></table></div>
      </section>`;

    el.querySelector('#ph-ok').onclick = async () => {
      const valeur = {
        nom: el.querySelector('#ph-nom').value.trim(), region: el.querySelector('#ph-region').value.trim(), district: el.querySelector('#ph-district').value.trim(),
        etablissement: el.querySelector('#ph-etab').value.trim(), telephone: el.querySelector('#ph-tel').value.trim(), adresse: el.querySelector('#ph-adr').value.trim()
      };
      try {
        await q(sb.from('parametres').upsert({ cle: 'pharmacie', valeur }));
        ctx.pharmacie = valeur;
        document.querySelector('.brand-nom').textContent = valeur.nom || 'Pharmacie';
        toast('Informations enregistrées.');
      } catch (e) { erreur(e); }
    };
    el.querySelectorAll('[data-droit]').forEach((c) => c.onchange = async () => {
      const role = c.dataset.roleDroit;
      const valeur = { ...(ctx.droitsParRole[role] || {}), [c.dataset.droit]: c.checked };
      try {
        await q(sb.from('parametres').upsert({ cle: 'droits_' + role, valeur }));
        ctx.droitsParRole[role] = valeur;
        toast('Droits du ' + ROLES[role].toLowerCase() + ' mis à jour.');
      } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    el.querySelector('#nouvel-utilisateur').onclick = () => {
      const m = modal('Nouvel utilisateur', `
        <div><label class="lbl" for="u-nom">Nom et prénom</label><input class="in" id="u-nom" autocomplete="off"></div>
        <div><label class="lbl" for="u-id">Identifiant de connexion</label><input class="in" id="u-id" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="Ex. : awa.kone">
          <div class="small muted" style="margin-top:4px">3 à 30 caractères : lettres sans accent, chiffres, point ou tiret.</div></div>
        <div><label class="lbl" for="u-mdp">Mot de passe (6 caractères minimum)</label><input class="in" id="u-mdp" type="text" autocomplete="off"></div>
        <div><label class="lbl" for="u-role">Rôle</label><select class="in" id="u-role">
          <option value="vendeur">Vendeur</option><option value="responsable">Responsable</option><option value="gerant">Gérant (administrateur)</option></select></div>
        <button class="btn btn-p" id="u-ok">Créer le compte</button>`);
      const idInput = m.el.querySelector('#u-id');
      idInput.oninput = () => { idInput.value = idInput.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, ''); };
      m.el.querySelector('#u-ok').onclick = async (e) => {
        e.target.disabled = true;
        try {
          await appelUtilisateurs(sb, {
            action: 'creer', nom: m.el.querySelector('#u-nom').value, identifiant: idInput.value,
            mot_de_passe: m.el.querySelector('#u-mdp').value, role: m.el.querySelector('#u-role').value
          });
          m.fermer();
          toast('Compte créé. Donnez l’identifiant et le mot de passe à la personne.');
          dessiner();
        } catch (err) { e.target.disabled = false; erreur(err); }
      };
    };
    el.querySelectorAll('[data-mdp]').forEach((b) => b.onclick = () => {
      const m = modal('Nouveau mot de passe pour ' + b.dataset.nom, `
        <div><label class="lbl" for="r-mdp">Nouveau mot de passe (6 caractères minimum)</label><input class="in" id="r-mdp" type="text" autocomplete="off"></div>
        <button class="btn btn-p" id="r-ok">Enregistrer</button>`);
      m.el.querySelector('#r-ok').onclick = async () => {
        try {
          await appelUtilisateurs(sb, { action: 'mot_de_passe', id: b.dataset.mdp, mot_de_passe: m.el.querySelector('#r-mdp').value });
          m.fermer();
          toast('Mot de passe changé. Donnez-le à la personne.');
        } catch (err) { erreur(err); }
      };
    });
    el.querySelectorAll('[data-role]').forEach((s) => s.onchange = async () => {
      try { await q(sb.from('profiles').update({ role: s.value }).eq('id', s.dataset.role)); toast('Rôle modifié.'); } catch (e) { erreur(e); }
    });
    el.querySelectorAll('[data-actif]').forEach((c) => c.onchange = async () => {
      try { await q(sb.from('profiles').update({ actif: c.checked }).eq('id', c.dataset.actif)); toast(c.checked ? 'Compte réactivé.' : 'Compte désactivé.'); } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    el.querySelectorAll('[data-j]').forEach((b) => b.onclick = () => { filtre = b.dataset.j; dessiner(); });
    el.querySelector('#sauvegarde').onclick = sauvegarder;
  }

  async function sauvegarder() {
    const tables = ['parametres', 'programmes', 'produits', 'produits_programmes', 'lots', 'clients', 'caisses', 'ventes', 'ventes_lignes', 'mouvements', 'credits_paiements', 'journal', 'profiles'];
    try {
      const donnees = { date: new Date().toISOString() };
      for (const t of tables) {
        const lignes = [];
        for (let debut = 0; ; debut += 1000) {
          const page = await q(sb.from(t).select('*').range(debut, debut + 999));
          lignes.push(...page);
          if (page.length < 1000) break;
        }
        donnees[t] = lignes;
      }
      telecharger('sauvegarde-pharmacie-' + isoJour() + '.json', JSON.stringify(donnees, null, 1), 'application/json');
      toast('Sauvegarde téléchargée.');
    } catch (e) { erreur(e); }
  }

  await dessiner();
}
