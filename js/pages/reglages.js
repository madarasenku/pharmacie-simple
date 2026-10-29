// Réglages (gérant) : pharmacie, droits du vendeur, utilisateurs, journal et sauvegarde.
import { esc, fmtDateHeure, q, qMaj, erreur, toast, telecharger, isoJour, modal, confirmer, ROLES, DOMAINE_IDENTIFIANTS, MDP_REGLE, mdpValide } from '../util.js';

const DROITS = [
  ['vendre', 'Vendre et encaisser'], ['entree', 'Entrée de stock'], ['credit', 'Vente à crédit'], ['programmes', 'Distribuer (programmes)'],
  ['corriger', 'Corriger le stock'], ['annuler', 'Annuler une vente'], ['prix', 'Changer les prix de vente'], ['rapports', 'Voir bénéfice et rapports'], ['base', 'Modifier la Base']
];
const ACTIONS = {
  correction: ['Correction stock', 'b-low'], inventaire: ['Inventaire', 'b-low'], annulation: ['Annulation', 'b-out'], prix: ['Prix modifié', 'b-exp'],
  ouverture_caisse: ['Ouverture caisse', 'b-ok'], fermeture_caisse: ['Fermeture caisse', 'b-ok'], remboursement: ['Remboursement crédit', 'b-ok'],
  commande: ['Commande district', 'b-exp'], commande_annulee: ['Commande annulée', 'b-neutre'], commande_close: ['Commande close', 'b-neutre'],
  produits_supprimes: ['Produits supprimés', 'b-out'], programmes_supprimes: ['Programmes supprimés', 'b-out'],
  utilisateur_cree: ['Compte créé', 'b-prog'], mot_de_passe_change: ['Mot de passe changé', 'b-prog']
};
// Tables copiées dans la sauvegarde, avec un ordre stable pour la lecture page par page
const TABLES = [
  ['parametres', 'cle'], ['programmes', 'id'], ['produits', 'id'], ['produits_programmes', 'produit_id,programme_id'], ['lots', 'id'],
  ['clients', 'id'], ['caisses', 'id'], ['ventes', 'id'], ['ventes_lignes', 'id'], ['mouvements', 'id'], ['credits_paiements', 'id'],
  ['commandes', 'id'], ['commandes_lignes', 'id'], ['rapports_corrections', 'programme_id,mois,produit_id'], ['journal', 'id'], ['profiles', 'id']
];

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
  let limiteJournal = 200;

  async function dessiner() {
    let requeteJournal = sb.from('journal').select('*, profiles(nom)').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limiteJournal);
    if (filtre) requeteJournal = requeteJournal.in('action', filtre.split(','));
    const [profils, journal] = await Promise.all([
      q(sb.from('profiles').select('*').order('created_at')),
      q(requeteJournal)
    ]);
    const ph = ctx.pharmacie;
    const liste = journal;
    const sauvegarde = ctx.derniereSauvegarde;

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
        <div class="card-head"><div><h2>Sauvegarde</h2><div class="small muted">Les données sont enregistrées en ligne dans Supabase. Téléchargez aussi une copie chaque semaine (clé USB, ordinateur).</div>
          <div class="small" style="margin-top:4px">${sauvegarde?.date ? `Dernière sauvegarde : <strong>${fmtDateHeure(sauvegarde.date)}</strong>${sauvegarde.par ? ' par ' + esc(sauvegarde.par) : ''}` : '<strong style="color:var(--rouge)">Aucune sauvegarde téléchargée pour l’instant.</strong>'}</div></div>
          <button class="btn btn-p" id="sauvegarde">Télécharger une sauvegarde complète</button></div>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Journal des actions sensibles</h2><div class="small muted">Rien ne s'efface : corrections, annulations, prix, caisse.</div></div>
          <div class="inline">${[['', 'Tout'], ['correction,inventaire', 'Stock'], ['annulation', 'Annulations'], ['prix,produits_supprimes,programmes_supprimes', 'Base et prix'], ['ouverture_caisse,fermeture_caisse,remboursement', 'Caisse'], ['commande,commande_annulee,commande_close', 'Commandes'], ['utilisateur_cree,mot_de_passe_change', 'Comptes']]
            .map(([k, l]) => `<button class="chip ${filtre === k ? 'on' : ''}" data-j="${k}">${l}</button>`).join('')}</div></div>
        <div class="table-box"><table class="tbl"><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Détail</th></tr></thead>
          <tbody>${liste.map((j) => {
            const a = ACTIONS[j.action] || [j.action, 'b-ok'];
            return `<tr><td class="num small">${fmtDateHeure(j.created_at)}</td><td>${esc(j.profiles?.nom || '')}</td><td><span class="badge ${a[1]}">${esc(a[0])}</span></td>
              <td class="small">${esc(Object.entries(j.details || {}).map(([k, v]) => k + ' : ' + v).join(' · '))}</td></tr>`;
          }).join('') || '<tr><td colspan="4" class="muted">Rien pour l’instant.</td></tr>'}</tbody></table></div>
        ${journal.length >= limiteJournal ? '<div style="padding:10px 14px"><button class="btn btn-sm" id="plus-journal">Afficher plus</button></div>' : ''}
      </section>`;

    el.querySelector('#ph-ok').onclick = async () => {
      const valeur = {
        nom: el.querySelector('#ph-nom').value.trim(), region: el.querySelector('#ph-region').value.trim(), district: el.querySelector('#ph-district').value.trim(),
        etablissement: el.querySelector('#ph-etab').value.trim(), telephone: el.querySelector('#ph-tel').value.trim(), adresse: el.querySelector('#ph-adr').value.trim()
      };
      try {
        await qMaj(sb.from('parametres').upsert({ cle: 'pharmacie', valeur }).select('cle'));
        ctx.pharmacie = valeur;
        document.querySelector('.brand-nom').textContent = valeur.nom || 'Pharmacie';
        toast('Informations enregistrées.');
      } catch (e) { erreur(e); }
    };
    el.querySelectorAll('[data-droit]').forEach((c) => c.onchange = async () => {
      const role = c.dataset.roleDroit;
      const valeur = { ...(ctx.droitsParRole[role] || {}), [c.dataset.droit]: c.checked };
      try {
        await qMaj(sb.from('parametres').upsert({ cle: 'droits_' + role, valeur }).select('cle'));
        ctx.droitsParRole[role] = valeur;
        toast('Droits du ' + ROLES[role].toLowerCase() + ' mis à jour.');
      } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    el.querySelector('#nouvel-utilisateur').onclick = () => {
      const m = modal('Nouvel utilisateur', `
        <div><label class="lbl" for="u-nom">Nom et prénom</label><input class="in" id="u-nom" autocomplete="off"></div>
        <div><label class="lbl" for="u-id">Identifiant de connexion</label><input class="in" id="u-id" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="Ex. : awa.kone">
          <div class="small muted" style="margin-top:4px">3 à 30 caractères : lettres sans accent, chiffres, point ou tiret.</div></div>
        <div><label class="lbl" for="u-mdp">Mot de passe provisoire</label><input class="in" id="u-mdp" type="text" autocomplete="off" spellcheck="false">
          <div class="small muted" style="margin-top:4px">${esc(MDP_REGLE)} La personne devra choisir son propre mot de passe à sa première connexion.</div></div>
        <div><label class="lbl" for="u-role">Rôle</label><select class="in" id="u-role">
          <option value="vendeur">Vendeur</option><option value="responsable">Responsable</option><option value="gerant">Gérant (administrateur)</option></select></div>
        <button class="btn btn-p" id="u-ok">Créer le compte</button>`);
      const idInput = m.el.querySelector('#u-id');
      idInput.oninput = () => { idInput.value = idInput.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, ''); };
      m.el.querySelector('#u-ok').onclick = async (e) => {
        if (!m.el.querySelector('#u-nom').value.trim()) return toast('Le nom est obligatoire.', 'warn');
        if (!/^[a-z0-9._-]{3,30}$/.test(idInput.value)) return toast('Identifiant : 3 à 30 caractères (lettres sans accent, chiffres, point, tiret).', 'warn');
        if (!mdpValide(m.el.querySelector('#u-mdp').value)) return toast(MDP_REGLE, 'warn');
        e.target.disabled = true;
        try {
          await appelUtilisateurs(sb, {
            action: 'creer', nom: m.el.querySelector('#u-nom').value, identifiant: idInput.value,
            mot_de_passe: m.el.querySelector('#u-mdp').value, role: m.el.querySelector('#u-role').value
          });
          m.fermer();
          toast('Compte créé. Donnez l’identifiant et le mot de passe provisoire à la personne.');
          dessiner();
        } catch (err) { e.target.disabled = false; erreur(err); }
      };
    };
    el.querySelectorAll('[data-mdp]').forEach((b) => b.onclick = () => {
      const m = modal('Nouveau mot de passe pour ' + b.dataset.nom, `
        <div><label class="lbl" for="r-mdp">Mot de passe provisoire</label><input class="in" id="r-mdp" type="text" autocomplete="off" spellcheck="false">
          <div class="small muted" style="margin-top:4px">${esc(MDP_REGLE)} La personne devra le remplacer à sa prochaine connexion.</div></div>
        <button class="btn btn-p" id="r-ok">Enregistrer</button>`);
      m.el.querySelector('#r-ok').onclick = async () => {
        if (!mdpValide(m.el.querySelector('#r-mdp').value)) return toast(MDP_REGLE, 'warn');
        try {
          await appelUtilisateurs(sb, { action: 'mot_de_passe', id: b.dataset.mdp, mot_de_passe: m.el.querySelector('#r-mdp').value });
          m.fermer();
          toast('Mot de passe changé. Donnez-le à la personne.');
        } catch (err) { erreur(err); }
      };
    });
    el.querySelectorAll('[data-role]').forEach((s) => s.onchange = async () => {
      const avant = profils.find((u) => u.id === s.dataset.role)?.role;
      try {
        await qMaj(sb.from('profiles').update({ role: s.value }).eq('id', s.dataset.role).select('id'));
        toast('Rôle modifié.');
        dessiner();
      } catch (e) { s.value = avant; erreur(e); }
    });
    el.querySelectorAll('[data-actif]').forEach((c) => c.onchange = async () => {
      if (!c.checked && !(await confirmer('Désactiver ce compte ?', 'La personne ne pourra plus rien voir ni faire, même si elle est déjà connectée. Ses ventes passées restent.', 'Désactiver'))) { c.checked = true; return; }
      try {
        await qMaj(sb.from('profiles').update({ actif: c.checked }).eq('id', c.dataset.actif).select('id'));
        toast(c.checked ? 'Compte réactivé.' : 'Compte désactivé.');
      } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    el.querySelectorAll('[data-j]').forEach((b) => b.onclick = () => { filtre = b.dataset.j; limiteJournal = 200; dessiner().catch(erreur); });
    const plus = el.querySelector('#plus-journal');
    if (plus) plus.onclick = () => { limiteJournal += 200; dessiner().catch(erreur); };
    el.querySelector('#sauvegarde').onclick = sauvegarder;
  }

  async function sauvegarder() {
    const bouton = el.querySelector('#sauvegarde');
    bouton.disabled = true;
    bouton.textContent = 'Préparation…';
    try {
      const donnees = { application: 'pharmacie-simple', version: ctx.version, date: new Date().toISOString(), par: ctx.profil.nom };
      for (const [t, ordre] of TABLES) {
        const lignes = [];
        for (let debut = 0; ; debut += 1000) {
          let requete = sb.from(t).select('*');
          for (const col of ordre.split(',')) requete = requete.order(col);
          const page = await q(requete.range(debut, debut + 999));
          lignes.push(...page);
          if (page.length < 1000) break;
        }
        donnees[t] = lignes;
      }
      telecharger('sauvegarde-pharmacie-' + isoJour() + '.json', JSON.stringify(donnees, null, 1), 'application/json');
      // On note la date : le rappel de sauvegarde (bandeau du gérant) se base dessus
      const valeur = { date: donnees.date, par: ctx.profil.nom };
      await qMaj(sb.from('parametres').upsert({ cle: 'derniere_sauvegarde', valeur }).select('cle'));
      ctx.derniereSauvegarde = valeur;
      ctx.majBandeaux();
      toast('Sauvegarde téléchargée. Rangez le fichier en lieu sûr (clé USB, ordinateur).');
      dessiner().catch(erreur);
    } catch (e) {
      erreur(e);
      bouton.disabled = false;
      bouton.textContent = 'Télécharger une sauvegarde complète';
    }
  }

  await dessiner();
}
