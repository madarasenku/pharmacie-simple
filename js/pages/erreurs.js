// Journal des erreurs (gérant) : ce qu'il faut corriger dans les données, avec le nom du produit
// et un bouton vers la bonne page, puis les erreurs survenues sur les appareils des agents.
import { esc, fmtDateHeure, q, rpc, erreur, toast } from '../util.js';
import { lireFile } from '../hors-ligne.js';

const GRAVITES = {
  haute: ['À corriger vite', 'b-out', 'var(--rouge)'],
  moyenne: ['À vérifier', 'b-low', 'var(--orange)'],
  info: ['Pour information', 'b-exp', 'var(--bleu)']
};
const PAGES = { base: 'Base', journee: 'Ma journée', inventaire: 'Inventaire', credits: 'Crédits', rapport: 'Rapport district', reglages: 'Réglages' };

// Lien « Corriger » : pour un produit, la Base s'ouvre directement filtrée sur son nom
function lien(a) {
  const nom = a.detail.split(' — ')[0];
  if (a.page === 'base' && ['prix_manquant', 'vente_perte', 'sans_origine'].includes(a.code)) return '#/base?rech=' + encodeURIComponent(nom);
  return '#/' + a.page;
}

export async function render(el, ctx) {
  const { sb } = ctx;
  let voirVues = false;
  let limite = 100;

  async function dessiner() {
    let requete = sb.from('erreurs').select('*, profiles!erreurs_user_id_fkey(nom)').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limite);
    if (!voirVues) requete = requete.eq('vu', false);
    const [anomalies, erreurs] = await Promise.all([rpc(sb, 'anomalies', {}), q(requete)]);
    ctx.majPastille?.(anomalies, erreurs.filter((x) => !x.vu).length);
    const refusees = lireFile().filter((x) => x.etat === 'erreur');

    // Regroupées par sorte d'anomalie, les plus graves d'abord
    const ordre = { haute: 0, moyenne: 1, info: 2 };
    const groupes = new Map();
    for (const a of anomalies.slice().sort((x, y) => ordre[x.gravite] - ordre[y.gravite])) {
      if (!groupes.has(a.code)) groupes.set(a.code, { titre: a.titre, gravite: a.gravite, page: a.page, lignes: [] });
      groupes.get(a.code).lignes.push(a);
    }
    const nbGraves = anomalies.filter((a) => a.gravite === 'haute').length;

    el.innerHTML = `
      <div class="page-head"><div><h1>Journal des erreurs</h1>
        <div class="small muted">Ce qui ne va pas dans les données, avec le produit concerné et la page où le corriger, puis les erreurs apparues à l’écran des agents.</div></div>
        <button class="btn" id="actualiser">Actualiser</button></div>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">À corriger vite</div><div class="v" style="color:var(--rouge)">${nbGraves}</div><div class="s">problèmes graves</div></div>
        <div class="card kpi"><div class="t">À vérifier</div><div class="v" style="color:var(--orange)">${anomalies.length - nbGraves}</div><div class="s">points à regarder</div></div>
        <div class="card kpi"><div class="t">Erreurs non vues</div><div class="v">${erreurs.filter((x) => !x.vu).length}</div><div class="s">apparues chez les agents</div></div>
      </section>

      <section class="card">
        <div class="card-head"><h2>À corriger dans les données</h2><span class="small muted">mis à jour à chaque ouverture de cette page</span></div>
        ${refusees.length ? `<div class="alert alert-err" style="margin:14px 18px 0">${refusees.length} vente(s) faite(s) hors ligne sur cet appareil ont été refusées par le serveur : <a href="#/journee">les régler dans Ma journée</a>.</div>` : ''}
        ${groupes.size ? [...groupes.values()].map((g) => {
          const [libelle, badge, couleur] = GRAVITES[g.gravite] || GRAVITES.info;
          return `<div class="anomalie">
            <div class="inline" style="justify-content:space-between">
              <h3 style="color:${couleur}">${esc(g.titre)} <span class="num">(${g.lignes.length})</span></h3>
              <span class="badge ${badge}">${libelle}</span></div>
            <ul>${g.lignes.slice(0, 50).map((a) => `<li><span>${esc(a.detail)}</span><a class="btn btn-sm" href="${esc(lien(a))}">Corriger${PAGES[a.page] ? ' · ' + esc(PAGES[a.page]) : ''}</a></li>`).join('')}
              ${g.lignes.length > 50 ? `<li class="muted">… et ${g.lignes.length - 50} autre(s)</li>` : ''}</ul>
          </div>`;
        }).join('') : '<div class="alert alert-ok" style="margin:14px 18px">Rien à corriger : les données sont cohérentes.</div>'}
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Erreurs survenues chez les agents</h2><div class="small muted">Message affiché, page, personne et heure. Marquez-les « vues » une fois réglées.</div></div>
          <div class="inline">
            <label class="check small"><input type="checkbox" id="voir-vues" ${voirVues ? 'checked' : ''}> Afficher aussi les erreurs déjà vues</label>
            ${erreurs.some((x) => !x.vu) ? '<button class="btn btn-sm btn-p" id="tout-vu">Tout marquer comme vu</button>' : ''}
          </div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Quand</th><th>Qui</th><th>Page</th><th>Message</th><th></th></tr></thead>
          <tbody>${erreurs.map((x) => `<tr class="${x.vu ? 'off' : ''}">
            <td class="num small">${fmtDateHeure(x.created_at)}</td>
            <td class="small">${esc(x.profiles?.nom || '—')}</td>
            <td class="small">${esc(x.page || '')}</td>
            <td class="keep">${esc(x.message)}${Object.keys(x.details || {}).length ? `<details class="small muted"><summary>détails</summary><code style="white-space:pre-wrap">${esc(JSON.stringify(x.details, null, 1))}</code></details>` : ''}
              <div class="small muted">${esc([x.version ? 'v' + x.version : '', x.appareil || ''].filter(Boolean).join(' · '))}</div></td>
            <td class="keep">${x.vu ? '<span class="badge b-neutre">Vue</span>' : `<button class="btn btn-sm" data-vu="${x.id}">Vue</button>`}</td></tr>`).join('')
            || `<tr><td colspan="5" class="muted">${voirVues ? 'Aucune erreur enregistrée.' : 'Aucune nouvelle erreur.'}</td></tr>`}</tbody>
        </table></div>
        ${erreurs.length >= limite ? '<div style="padding:10px 14px"><button class="btn btn-sm" id="plus">Afficher plus</button></div>' : ''}
      </section>`;

    el.querySelector('#actualiser').onclick = () => dessiner().catch(erreur);
    el.querySelector('#voir-vues').onchange = (e) => { voirVues = e.target.checked; dessiner().catch(erreur); };
    const plus = el.querySelector('#plus');
    if (plus) plus.onclick = () => { limite += 100; dessiner().catch(erreur); };
    const tout = el.querySelector('#tout-vu');
    if (tout) tout.onclick = () => marquer(null);
    el.querySelectorAll('[data-vu]').forEach((b) => b.onclick = () => marquer([Number(b.dataset.vu)]));
  }

  async function marquer(ids) {
    try {
      const n = await rpc(sb, 'marquer_erreurs_vues', { p_ids: ids });
      toast(n > 1 ? n + ' erreurs marquées comme vues.' : 'Erreur marquée comme vue.');
      await dessiner();
    } catch (e) { erreur(e); }
  }

  await dessiner();
}
