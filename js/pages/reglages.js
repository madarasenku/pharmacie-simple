// Réglages (gérant) : pharmacie, droits du vendeur, utilisateurs, journal et sauvegarde.
import { esc, fmtDateHeure, q, erreur, toast, telecharger, isoJour } from '../util.js';

const DROITS = [
  ['vendre', 'Vendre et encaisser'], ['entree', 'Entrée de stock'], ['credit', 'Vente à crédit'], ['programmes', 'Distribuer (programmes)'],
  ['corriger', 'Corriger le stock'], ['annuler', 'Annuler une vente'], ['prix', 'Changer les prix de vente'], ['rapports', 'Voir bénéfice et rapports'], ['base', 'Modifier la Base']
];
const ACTIONS = { correction: ['Correction stock', 'b-low'], annulation: ['Annulation', 'b-out'], prix: ['Prix modifié', 'b-exp'], ouverture_caisse: ['Ouverture caisse', 'b-ok'], fermeture_caisse: ['Fermeture caisse', 'b-ok'] };

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
          <div class="card-head"><div><h2>Droits du vendeur</h2><div class="small muted">Le gérant a toujours tous les droits.</div></div></div>
          <div class="table-box"><table class="tbl"><tbody>
            ${DROITS.map(([k, l]) => `<tr><td>${esc(l)}</td><td style="text-align:center"><input type="checkbox" style="width:22px;height:22px;accent-color:var(--vert)" data-droit="${k}" ${ctx.droits[k] ? 'checked' : ''} aria-label="${esc(l)}"></td></tr>`).join('')}
          </tbody></table></div>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><div><h2>Utilisateurs</h2><div class="small muted">Pour ajouter quelqu'un : il clique sur « Créer un compte » à l'écran de connexion, puis vous réglez son rôle ici.</div></div></div>
        <div class="table-box"><table class="tbl"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Actif</th><th>Créé le</th></tr></thead>
          <tbody>${profils.map((u) => `<tr><td>${esc(u.nom)}</td><td class="small">${esc(u.email || '')}</td>
            <td><select class="in" style="width:150px" data-role="${u.id}" ${u.id === ctx.profil.id ? 'disabled title="Vous ne pouvez pas changer votre propre rôle"' : ''}>
              <option value="vendeur">Vendeur</option><option value="gerant" ${u.role === 'gerant' ? 'selected' : ''}>Gérant</option></select></td>
            <td><input type="checkbox" style="width:22px;height:22px;accent-color:var(--vert)" data-actif="${u.id}" ${u.actif ? 'checked' : ''} ${u.id === ctx.profil.id ? 'disabled' : ''} aria-label="Compte actif"></td>
            <td class="num small">${fmtDateHeure(u.created_at)}</td></tr>`).join('')}</tbody></table></div>
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
      const valeur = { ...ctx.droits, [c.dataset.droit]: c.checked };
      try {
        await q(sb.from('parametres').upsert({ cle: 'droits_vendeur', valeur }));
        ctx.droits = valeur;
        toast('Droits du vendeur mis à jour.');
      } catch (e) { c.checked = !c.checked; erreur(e); }
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
