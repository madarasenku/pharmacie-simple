// Réglages (gérant) : pharmacie, droits du vendeur, utilisateurs, journal et sauvegarde.
import { esc, fmt, fmtDateHeure, q, qMaj, erreur, toast, telecharger, csv, isoJour, modal, confirmer, ROLES, DOMAINE_IDENTIFIANTS, MDP_REGLE, mdpValide } from '../util.js';

const DROITS = [
  ['vendre', 'Vendre et encaisser'], ['entree', 'Entrée de stock'], ['credit', 'Vente à crédit'], ['programmes', 'Distribuer (programmes)'],
  ['corriger', 'Corriger le stock'], ['annuler', 'Annuler une vente'], ['prix', 'Changer les prix de vente'], ['rapports', 'Voir bénéfice et rapports'], ['base', 'Modifier la Base']
];
// Journal : chaque action (libellé, couleur, groupe du filtre). Les actions récentes portent une phrase prête à lire
// (details.texte, écrite par la base) ; les plus anciennes sont mises en forme ici.
const ACTIONS = {
  vente: ['Vente', 'b-ok', 'ventes'], distribution: ['Distribution', 'b-prog', 'ventes'], annulation: ['Annulation', 'b-out', 'ventes'],
  entree: ['Entrée de stock', 'b-ok', 'stock'], correction: ['Correction stock', 'b-low', 'stock'], inventaire: ['Inventaire', 'b-low', 'stock'],
  ouverture_caisse: ['Ouverture caisse', 'b-ok', 'caisse'], fermeture_caisse: ['Fermeture caisse', 'b-ok', 'caisse'], remboursement: ['Remboursement crédit', 'b-ok', 'caisse'],
  client_cree: ['Client créé', 'b-neutre', 'caisse'], client_modifie: ['Client modifié', 'b-neutre', 'caisse'],
  prix: ['Prix modifié', 'b-exp', 'base'], produit_cree: ['Produit créé', 'b-exp', 'base'], produit_modifie: ['Produit modifié', 'b-exp', 'base'],
  produits_supprimes: ['Produits supprimés', 'b-out', 'base'], programme_cree: ['Programme créé', 'b-exp', 'base'], programme_modifie: ['Programme modifié', 'b-exp', 'base'],
  programmes_supprimes: ['Programmes supprimés', 'b-out', 'base'], origine_ajoutee: ['Origine cochée', 'b-neutre', 'base'], origine_retiree: ['Origine décochée', 'b-neutre', 'base'],
  commande: ['Commande district', 'b-exp', 'commandes'], commande_annulee: ['Commande annulée', 'b-neutre', 'commandes'], commande_close: ['Commande close', 'b-neutre', 'commandes'],
  rapport_corrige: ['Rapport corrigé', 'b-low', 'commandes'],
  utilisateur_cree: ['Compte créé', 'b-prog', 'comptes'], mot_de_passe_change: ['Mot de passe changé', 'b-prog', 'comptes'], compte_modifie: ['Compte modifié', 'b-prog', 'comptes'],
  connexion: ['Connexion', 'b-neutre', 'comptes'], deconnexion: ['Déconnexion', 'b-neutre', 'comptes'],
  reglage_modifie: ['Réglage modifié', 'b-neutre', 'reglages'], droits_modifies: ['Droits modifiés', 'b-low', 'reglages'], sauvegarde: ['Sauvegarde', 'b-ok', 'reglages']
};
const GROUPES = [['', 'Tout'], ['ventes', 'Ventes'], ['stock', 'Stock'], ['caisse', 'Caisse et crédits'], ['base', 'Base'], ['commandes', 'Commandes'], ['comptes', 'Comptes et connexions'], ['reglages', 'Réglages']];
const actionsDu = (groupe) => Object.keys(ACTIONS).filter((a) => ACTIONS[a][2] === groupe);
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

// Noms des produits, lots, clients et commandes cités par numéro dans les anciennes lignes du journal
async function nomsDu(journal, sb) {
  const ids = { produits: new Set(), lots: new Set(), clients: new Set(), commandes: new Set() };
  for (const j of journal) {
    const d = j.details || {};
    if (d.texte) continue;
    if (Number.isInteger(d.produit)) ids.produits.add(d.produit);
    if (Number.isInteger(d.lot)) ids.lots.add(d.lot);
    if (Number.isInteger(d.client)) ids.clients.add(d.client);
    if (Number.isInteger(d.commande)) ids.commandes.add(d.commande);
  }
  const lire = async (table, champ, set) => (set.size ? new Map((await q(sb.from(table).select('id, ' + champ).in('id', [...set]))).map((x) => [x.id, x[champ]])) : new Map());
  const [produits, lots, clients, commandes] = await Promise.all([
    lire('produits', 'designation', ids.produits), lire('lots', 'numero', ids.lots), lire('clients', 'nom', ids.clients), lire('commandes', 'numero', ids.commandes)
  ]);
  return { produits, lots, clients, commandes };
}

function detailLisible(j, noms) {
  const d = j.details || {};
  if (d.texte) return d.texte;
  const prod = (v) => (Number.isInteger(v) ? noms.produits.get(v) || 'produit n°' + v : v);
  const F = (n) => fmt(n) + ' F';
  switch (j.action) {
    case 'correction': return [prod(d.produit), d.lot ? 'lot ' + (noms.lots.get(d.lot) || d.lot) : '', d.avant + ' → ' + d.apres, d.motif].filter(Boolean).join(' · ');
    case 'annulation': return 'Vente ' + d.vente + ' · ' + F(d.total) + (d.motif ? ' · motif : ' + d.motif : '');
    case 'ouverture_caisse': return 'Fond de caisse ' + F(d.fond);
    case 'fermeture_caisse': return 'Espèces comptées ' + F(d.comptees) + (Number(d.ecart) ? ' · écart ' + (d.ecart > 0 ? '+' : '−') + F(Math.abs(d.ecart)) : ' · pas d’écart');
    case 'remboursement': return (noms.clients.get(d.client) || 'client n°' + d.client) + ' · ' + F(d.montant);
    case 'prix': return [prod(d.produit), d.origine, d.avant !== undefined ? F(d.avant) + ' → ' + F(d.apres) : d.prix_vente !== undefined ? F(d.prix_vente) : ''].filter(Boolean).join(' · ');
    case 'inventaire': return [d.reference, (d.corrections ?? 0) + ' correction(s)', (d.lots_ajoutes ?? 0) + ' lot(s) ajouté(s)'].join(' · ');
    case 'commande': case 'commande_annulee': case 'commande_close':
      return 'Commande ' + (noms.commandes.get(d.commande) || 'n°' + d.commande) + (d.total !== undefined ? ' · ' + F(d.total) : '');
    case 'produits_supprimes': case 'programmes_supprimes':
      return [d.supprimes?.length ? 'supprimés : ' + d.supprimes.join(', ') : '', d.desactives?.length ? 'masqués : ' + d.desactives.join(', ') : ''].filter(Boolean).join(' · ') || '—';
    case 'utilisateur_cree': return (d.identifiant || '') + (d.role ? ' · ' + (ROLES[d.role] || d.role) : '');
    case 'mot_de_passe_change': return d.identifiant || '';
    default: return Object.entries(d).map(([k, v]) => k + ' : ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ');
  }
}

export async function render(el, ctx) {
  const { sb } = ctx;
  let filtre = ''; // groupe d'actions
  let personne = '';
  let jour = '';
  let limiteJournal = 200;

  async function dessiner() {
    let requeteJournal = sb.from('journal').select('*, profiles(nom)').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limiteJournal);
    if (filtre) requeteJournal = requeteJournal.in('action', actionsDu(filtre));
    if (personne) requeteJournal = requeteJournal.eq('user_id', personne);
    if (jour) {
      const d = new Date(jour + 'T00:00:00');
      requeteJournal = requeteJournal.gte('created_at', d.toISOString()).lt('created_at', new Date(d.getTime() + 86400000).toISOString());
    }
    const [profils, journal] = await Promise.all([
      q(sb.from('profiles').select('*').order('created_at')),
      q(requeteJournal)
    ]);
    const noms = await nomsDu(journal, sb);
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
        <div class="card-head"><div><h2>Journal de toutes les actions</h2><div class="small muted">Chaque vente, distribution, entrée, correction, modification de la Base, caisse, crédit, commande, compte et connexion : qui, quand, quoi. Rien ne s’efface.</div></div>
          <button class="btn btn-sm" id="csv-journal">Exporter Excel</button></div>
        <div class="inline" style="padding:12px 18px 0">
          ${GROUPES.map(([k, l]) => `<button class="chip ${filtre === k ? 'on' : ''}" data-j="${k}">${l}</button>`).join('')}
        </div>
        <div class="inline" style="padding:10px 18px 12px">
          <label class="small muted" for="j-qui">Qui</label>
          <select class="in" id="j-qui" style="width:auto"><option value="">Tout le monde</option>${profils.map((p) => `<option value="${p.id}" ${personne === p.id ? 'selected' : ''}>${esc(p.nom || p.identifiant || '')}</option>`).join('')}</select>
          <label class="small muted" for="j-jour">Jour</label>
          <input class="in" type="date" id="j-jour" value="${jour}" max="${isoJour()}" style="width:auto">
          ${jour || personne ? '<button class="link small" id="j-effacer">Effacer les filtres</button>' : ''}
        </div>
        <div class="table-box defile"><table class="tbl"><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Détail</th></tr></thead>
          <tbody>${liste.map((j) => {
            const a = ACTIONS[j.action] || [j.action, 'b-ok'];
            return `<tr><td class="num small" style="white-space:nowrap">${fmtDateHeure(j.created_at)}</td><td class="small">${esc(j.profiles?.nom || '')}</td><td><span class="badge ${a[1]}">${esc(a[0])}</span></td>
              <td class="small" data-detail>${esc(detailLisible(j, noms))}</td></tr>`;
          }).join('') || '<tr><td colspan="4" class="muted">Rien pour ces filtres.</td></tr>'}</tbody></table></div>
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
        <div><label class="lbl" for="u-nom">Nom et prénom</label><input class="in" id="u-nom" autocomplete="off" style="text-transform:uppercase" placeholder="Ex. : KONE AWA"></div>
        <div><label class="lbl" for="u-id">Identifiant de connexion</label><input class="in" id="u-id" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="Ex. : awa.kone">
          <div class="small muted" style="margin-top:4px">3 à 30 caractères : lettres sans accent, chiffres, point ou tiret.</div></div>
        <div><label class="lbl" for="u-mdp">Mot de passe provisoire</label><input class="in" id="u-mdp" type="text" autocomplete="off" spellcheck="false">
          <div class="small muted" style="margin-top:4px">${esc(MDP_REGLE)} La personne devra choisir son propre mot de passe à sa première connexion.</div></div>
        <div><label class="lbl" for="u-role">Rôle</label><select class="in" id="u-role">
          <option value="vendeur">Vendeur</option><option value="responsable">Responsable</option><option value="gerant">Gérant (administrateur)</option></select></div>
        <button class="btn btn-p" id="u-ok">Créer le compte</button>`);
      const idInput = m.el.querySelector('#u-id');
      // Les noms des agents s'écrivent en MAJUSCULES (la base le garantit aussi)
      const nomInput = m.el.querySelector('#u-nom');
      nomInput.oninput = () => { const pos = nomInput.selectionStart; nomInput.value = nomInput.value.toUpperCase(); nomInput.setSelectionRange(pos, pos); };
      idInput.oninput = () => { idInput.value = idInput.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, ''); };
      m.el.querySelector('#u-ok').onclick = async (e) => {
        if (!m.el.querySelector('#u-nom').value.trim()) return toast('Le nom est obligatoire.', 'warn');
        if (!/^[a-z0-9._-]{3,30}$/.test(idInput.value)) return toast('Identifiant : 3 à 30 caractères (lettres sans accent, chiffres, point, tiret).', 'warn');
        if (!mdpValide(m.el.querySelector('#u-mdp').value)) return toast(MDP_REGLE, 'warn');
        e.target.disabled = true;
        try {
          await appelUtilisateurs(sb, {
            action: 'creer', nom: nomInput.value.trim().toUpperCase(), identifiant: idInput.value,
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
    el.querySelector('#j-qui').onchange = (e) => { personne = e.target.value; limiteJournal = 200; dessiner().catch(erreur); };
    el.querySelector('#j-jour').onchange = (e) => { jour = e.target.value; limiteJournal = 200; dessiner().catch(erreur); };
    const eff = el.querySelector('#j-effacer');
    if (eff) eff.onclick = () => { jour = ''; personne = ''; dessiner().catch(erreur); };
    el.querySelector('#csv-journal').onclick = () => {
      const l = [['Date', 'Qui', 'Action', 'Détail']];
      journal.forEach((j) => l.push([fmtDateHeure(j.created_at), j.profiles?.nom || '', (ACTIONS[j.action] || [j.action])[0], detailLisible(j, noms)]));
      telecharger('journal-' + (jour || isoJour()) + '.csv', csv(l));
    };
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
