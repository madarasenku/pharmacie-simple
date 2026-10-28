// Point général : ventes, programmes et stock sur une période.
import { esc, fmt, q, isoJour, chargerCatalogue, joursAvant } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  let periode = 'mois';

  function bornes() {
    const auj = new Date(isoJour() + 'T00:00:00');
    if (periode === 'jour') return [auj, new Date(auj.getTime() + 86400000), "Aujourd'hui"];
    if (periode === 'semaine') return [new Date(auj.getTime() - 6 * 86400000), new Date(auj.getTime() + 86400000), '7 derniers jours'];
    if (periode === 'mois') return [new Date(auj.getFullYear(), auj.getMonth(), 1), new Date(auj.getTime() + 86400000), 'Ce mois'];
    return [new Date(auj.getFullYear(), auj.getMonth() - 1, 1), new Date(auj.getFullYear(), auj.getMonth(), 1), 'Mois dernier'];
  }

  async function dessiner() {
    const [debut, fin, libelle] = bornes();
    const [ventes, entrees, catalogue] = await Promise.all([
      q(sb.from('ventes').select('id, programme_id, mode_paiement, total, patient_tranche, ventes_lignes(quantite, prix_unitaire, cout_unitaire)')
        .eq('annulee', false).gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).limit(10000)),
      q(sb.from('mouvements').select('quantite, prix_unitaire, programme_id').eq('type', 'entree').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).limit(10000)),
      chargerCatalogue(sb)
    ]);
    const vv = ventes.filter((v) => v.mode_paiement !== 'gratuit');
    const somme = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    const ca = somme(vv, (v) => Number(v.total));
    const benef = somme(vv, (v) => somme(v.ventes_lignes, (l) => l.quantite * (l.prix_unitaire - l.cout_unitaire)));
    const parMode = (m) => somme(vv.filter((v) => v.mode_paiement === m), (v) => Number(v.total));
    const achats = somme(entrees.filter((e) => e.prix_unitaire), (e) => e.quantite * e.prix_unitaire);
    const progs = ctx.programmes.filter((p) => !p.est_vente);
    const vente = ctx.vente;
    let ruptures = 0, aCommander = 0, bientot = 0, valeur = 0;
    for (const p of catalogue.filter((x) => x.actif)) {
      for (const [id, o] of Object.entries(p.origines)) {
        if (o.quantite <= 0 && o.cmm > 0) ruptures++;
        else if (o.quantite < Math.ceil(2 * o.cmm) || o.quantite < p.stock_min) aCommander++;
        const j = joursAvant(o.prochaine);
        if (j !== null && j <= 90) bientot++;
        if (vente && Number(id) === vente.id) valeur += o.quantite * Number(p.prix_achat);
      }
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Point général</h1><div class="small muted">${esc(libelle)} · ventes, programmes et stock réunis</div></div>
        <div class="inline" role="group" aria-label="Période">
          ${[['jour', "Aujourd'hui"], ['semaine', '7 jours'], ['mois', 'Ce mois'], ['precedent', 'Mois dernier']].map(([k, l]) => `<button class="chip ${periode === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
        </div></div>
      <h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">Ventes (argent)</h2>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Chiffre d'affaires</div><div class="v">${fmt(ca)}</div><div class="s">FCFA · ${vv.length} ventes</div></div>
        <div class="card kpi"><div class="t">Bénéfice estimé</div><div class="v" style="color:#1A6438">${fmt(benef)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Achats de médicaments</div><div class="v">${fmt(achats)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Répartition</div><div class="s num" style="margin-top:6px">Espèces ${fmt(parMode('especes'))}<br>Mobile Money ${fmt(parMode('momo'))}<br>Crédit ${fmt(parMode('credit'))}</div></div>
      </section>
      <h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">Programmes (gratuit)</h2>
      <section class="card"><div class="table-box"><table class="tbl">
        <thead><tr><th>Programme</th><th class="r">Bénéficiaires</th><th class="r">Unités données</th><th class="r">Unités reçues</th><th></th></tr></thead>
        <tbody>${progs.map((p) => {
          const vs = ventes.filter((v) => v.programme_id === p.id);
          return `<tr><td><strong>${esc(p.nom)}</strong> <span class="badge b-prog">${esc(p.sigle)}</span></td><td class="num r">${vs.length}</td>
            <td class="num r" style="color:var(--violet);font-weight:600">${fmt(somme(vs, (v) => somme(v.ventes_lignes, (l) => l.quantite)))}</td>
            <td class="num r">${fmt(somme(entrees.filter((e) => e.programme_id === p.id), (e) => e.quantite))}</td><td><a href="#/programmes">Détail</a></td></tr>`;
        }).join('')}</tbody></table></div></section>
      <h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">Stock (aujourd'hui)</h2>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock vente</div><div class="v">${fmt(valeur)}</div><div class="s">FCFA, au prix d'achat</div></div>
        <div class="card kpi"><div class="t">Ruptures</div><div class="v" style="color:var(--rouge)">${ruptures}</div><div class="s">produits consommés mais à zéro</div></div>
        <div class="card kpi"><div class="t">À commander / demander</div><div class="v" style="color:var(--orange)">${aCommander}</div><div class="s"><a href="#/stock">Voir la liste</a></div></div>
        <div class="card kpi"><div class="t">Périment dans 90 jours</div><div class="v" style="color:var(--bleu)">${bientot}</div><div class="s">lots à écouler en priorité</div></div>
      </section>
      <div class="inline"><a class="btn btn-p" href="#/rapport">Rapport commandes recouvrables (district)</a><a class="btn" href="#/programmes">Comptes rendus des programmes</a></div>`;

    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { periode = b.dataset.p; dessiner(); });
  }

  await dessiner();
}
