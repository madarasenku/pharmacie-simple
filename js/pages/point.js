// Point général : ventes, programmes et stock sur une période.
// Le point « normal » ne compte que la Vente ; chaque programme recouvrable (PHPSP…) a son propre point.
import { esc, fmt, tout, isoJour, chargerCatalogue, joursAvant, prixDe, imprimer, csv, telecharger } from '../util.js';

const MODES = [['especes', 'Espèces'], ['momo', 'Mobile Money'], ['credit', 'Crédit']];

export async function render(el, ctx) {
  const { sb } = ctx;
  let periode = 'mois';
  const vente = ctx.vente;
  const recouvrables = ctx.programmes.filter((g) => g.recouvrable && g.actif);
  // « vente » = point normal ; sinon l'id du programme recouvrable affiché
  let vue = 'vente';

  function bornes() {
    const auj = new Date(isoJour() + 'T00:00:00');
    if (periode === 'jour') return [auj, new Date(auj.getTime() + 86400000), "Aujourd'hui"];
    if (periode === 'semaine') return [new Date(auj.getTime() - 6 * 86400000), new Date(auj.getTime() + 86400000), '7 derniers jours'];
    if (periode === 'mois') return [new Date(auj.getFullYear(), auj.getMonth(), 1), new Date(auj.getTime() + 86400000), 'Ce mois'];
    return [new Date(auj.getFullYear(), auj.getMonth() - 1, 1), new Date(auj.getFullYear(), auj.getMonth(), 1), 'Mois dernier'];
  }

  const somme = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const titreSection = (t) => `<h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">${t}</h2>`;
  const kpiArgent = (vs, achats) => {
    const ca = somme(vs, (v) => Number(v.total));
    const parMode = (m) => somme(vs.filter((v) => v.mode_paiement === m), (v) => Number(v.total));
    return { ca, parMode, achats };
  };

  async function dessiner() {
    const [debut, fin, libelle] = bornes();
    const [ventes, entrees, catalogue] = await Promise.all([
      tout(() => sb.from('ventes').select('id, programme_id, mode_paiement, total, patient_tranche, ventes_lignes(produit_id, quantite, prix_unitaire, cout_unitaire)')
        .eq('annulee', false).gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      tout(() => sb.from('mouvements').select('id, produit_id, quantite, prix_unitaire, programme_id').eq('type', 'entree').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      chargerCatalogue(sb)
    ]);
    const g = vue === 'vente' ? null : recouvrables.find((x) => x.id === vue);
    if (vue !== 'vente' && !g) vue = 'vente';

    const boutons = recouvrables.length ? `<div class="origines" role="group" aria-label="Quel point ?">
        <button class="org ${vue === 'vente' ? 'on' : ''}" data-vue="vente"><strong>Point normal</strong><span class="small">Vente de la pharmacie</span></button>
        ${recouvrables.map((x) => `<button class="org ${vue === x.id ? 'on-r' : ''}" data-vue="${x.id}"><strong>Point ${esc(x.sigle)}</strong><span class="small">${esc(x.nom)} · recouvrable</span></button>`).join('')}
      </div>` : '';
    const periodes = `<div class="inline" role="group" aria-label="Période">
          ${[['jour', "Aujourd'hui"], ['semaine', '7 jours'], ['mois', 'Ce mois'], ['precedent', 'Mois dernier']].map(([k, l]) => `<button class="chip ${periode === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
        </div>`;

    if (g) dessinerRecouvrable(g, { ventes, entrees, catalogue, libelle, boutons, periodes });
    else dessinerNormal({ ventes, entrees, catalogue, libelle, boutons, periodes });

    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { periode = b.dataset.p; dessiner(); });
    el.querySelectorAll('[data-vue]').forEach((b) => b.onclick = () => { vue = b.dataset.vue === 'vente' ? 'vente' : Number(b.dataset.vue); dessiner(); });
  }

  // ---------- Point normal : la Vente, les programmes gratuits et le stock ----------
  function dessinerNormal({ ventes, entrees, catalogue, libelle, boutons, periodes }) {
    const vv = ventes.filter((v) => v.mode_paiement !== 'gratuit' && v.programme_id === vente?.id);
    const k = kpiArgent(vv, somme(entrees.filter((e) => e.programme_id === vente?.id && e.prix_unitaire), (e) => e.quantite * e.prix_unitaire));
    const benef = somme(vv, (v) => somme(v.ventes_lignes, (l) => l.quantite * (l.prix_unitaire - l.cout_unitaire)));
    const gratuits = ctx.programmes.filter((p) => !p.est_vente && !p.recouvrable);
    const exclus = new Set(recouvrables.map((x) => x.id));
    let ruptures = 0, aCommander = 0, bientot = 0, valeur = 0;
    for (const p of catalogue.filter((x) => x.actif)) {
      for (const [id, o] of Object.entries(p.origines)) {
        if (exclus.has(Number(id))) continue;
        if (o.quantite <= 0 && o.cmm > 0) ruptures++;
        else if (o.quantite < Math.ceil(2 * o.cmm) || o.quantite < p.stock_min) aCommander++;
        const j = joursAvant(o.prochaine);
        if (j !== null && j <= 90) bientot++;
        if (vente && Number(id) === vente.id) valeur += o.quantite * Number(p.prix_achat);
      }
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Point général</h1><div class="small muted">${esc(libelle)} · Vente, programmes gratuits et stock${recouvrables.length ? ` (sans ${recouvrables.map((x) => esc(x.sigle)).join(', ')}, qui a son propre point)` : ''}</div></div>
        ${periodes}</div>
      ${boutons}
      ${titreSection('Ventes (argent)')}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Chiffre d'affaires</div><div class="v">${fmt(k.ca)}</div><div class="s">FCFA · ${vv.length} ventes</div></div>
        <div class="card kpi"><div class="t">Bénéfice estimé</div><div class="v" style="color:#1A6438">${fmt(benef)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Achats de médicaments</div><div class="v">${fmt(k.achats)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Répartition</div><div class="s num" style="margin-top:6px">${MODES.map(([m, l]) => `${l} ${fmt(k.parMode(m))}`).join('<br>')}</div></div>
      </section>
      ${titreSection('Programmes (gratuit)')}
      <section class="card"><div class="table-box"><table class="tbl">
        <thead><tr><th>Programme</th><th class="r">Bénéficiaires</th><th class="r">Unités données</th><th class="r">Unités reçues</th><th></th></tr></thead>
        <tbody>${gratuits.map((p) => {
          const vs = ventes.filter((v) => v.programme_id === p.id);
          return `<tr><td><strong>${esc(p.nom)}</strong> <span class="badge b-prog">${esc(p.sigle)}</span></td><td class="num r">${vs.length}</td>
            <td class="num r" style="color:var(--violet);font-weight:600">${fmt(somme(vs, (v) => somme(v.ventes_lignes, (l) => l.quantite)))}</td>
            <td class="num r">${fmt(somme(entrees.filter((e) => e.programme_id === p.id), (e) => e.quantite))}</td><td><a href="#/programmes">Détail</a></td></tr>`;
        }).join('') || '<tr><td colspan="5" class="muted">Aucun programme gratuit.</td></tr>'}</tbody></table></div></section>
      ${titreSection("Stock (aujourd'hui)")}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock vente</div><div class="v">${fmt(valeur)}</div><div class="s">FCFA, au prix d'achat</div></div>
        <div class="card kpi"><div class="t">Ruptures</div><div class="v" style="color:var(--rouge)">${ruptures}</div><div class="s">produits consommés mais à zéro</div></div>
        <div class="card kpi"><div class="t">À commander / demander</div><div class="v" style="color:var(--orange)">${aCommander}</div><div class="s"><a href="#/stock">Voir la liste</a></div></div>
        <div class="card kpi"><div class="t">Périment dans 90 jours</div><div class="v" style="color:var(--bleu)">${bientot}</div><div class="s">lots à écouler en priorité</div></div>
      </section>
      <div class="inline"><a class="btn btn-p" href="#/rapport">Rapport commandes recouvrables (district)</a><a class="btn" href="#/programmes">Comptes rendus des programmes</a></div>`;
  }

  // ---------- Point d'un programme recouvrable (PHPSP…) : son argent, ses produits, son stock ----------
  function dessinerRecouvrable(g, { ventes, entrees, catalogue, libelle, boutons, periodes }) {
    const vs = ventes.filter((v) => v.programme_id === g.id && v.mode_paiement !== 'gratuit');
    const recus = entrees.filter((e) => e.programme_id === g.id);
    const k = kpiArgent(vs, somme(recus.filter((e) => e.prix_unitaire), (e) => e.quantite * e.prix_unitaire));
    const unites = somme(vs, (v) => somme(v.ventes_lignes, (l) => l.quantite));
    const produits = catalogue.filter((p) => p.actif && p.origines[g.id]).map((p) => {
      const lignes = vs.flatMap((v) => v.ventes_lignes.filter((l) => l.produit_id === p.id));
      const o = p.origines[g.id];
      return {
        p, o, prix: prixDe(p, g.id),
        vendu: somme(lignes, (l) => l.quantite),
        montant: somme(lignes, (l) => l.quantite * Number(l.prix_unitaire)),
        recu: somme(recus.filter((e) => e.produit_id === p.id), (e) => e.quantite)
      };
    }).sort((a, b) => b.montant - a.montant || a.p.designation.localeCompare(b.p.designation, 'fr'));
    const valeur = somme(produits, (x) => x.o.quantite * x.prix);
    const ruptures = produits.filter((x) => x.o.quantite <= 0 && x.o.aEuDuStock).length;
    const bientot = produits.filter((x) => { const j = joursAvant(x.o.prochaine); return j !== null && j <= 90; }).length;

    const tableau = (pourImpression) => `<table class="${pourImpression ? 'ft' : 'tbl'}">
      <thead><tr><th>Produit</th><th class="r">Prix ${esc(g.sigle)}</th><th class="r">Reçu</th><th class="r">Vendu</th><th class="r">Montant</th><th class="r">Stock actuel</th></tr></thead>
      <tbody>${produits.map((x) => `<tr><td>${esc(x.p.designation)}</td><td class="num r n">${fmt(x.prix)}</td><td class="num r n">${fmt(x.recu)}</td>
        <td class="num r n" style="font-weight:600">${fmt(x.vendu)}</td><td class="num r n" style="font-weight:700">${fmt(x.montant)}</td><td class="num r n">${fmt(x.o.quantite)}</td></tr>`).join('')
        || `<tr><td colspan="6" class="muted">Aucun produit rattaché à ${esc(g.sigle)} : cochez-les dans l’onglet Base.</td></tr>`}
        <tr><td colspan="4" style="text-align:right;font-weight:700">TOTAL ENCAISSÉ</td><td class="num r n" style="font-weight:700">${fmt(k.ca)}</td><td></td></tr></tbody></table>`;

    el.innerHTML = `
      <div class="page-head"><div><h1>Point ${esc(g.sigle)}</h1><div class="small muted">${esc(libelle)} · ${esc(g.nom)}, programme recouvrable : compté à part, jamais mélangé au point normal</div></div>
        ${periodes}</div>
      ${boutons}
      ${titreSection('Argent encaissé (à reverser au programme)')}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Recettes ${esc(g.sigle)}</div><div class="v" style="color:var(--bleu)">${fmt(k.ca)}</div><div class="s">FCFA · ${vs.length} vente(s)</div></div>
        <div class="card kpi"><div class="t">Unités vendues</div><div class="v">${fmt(unites)}</div><div class="s">sur la période</div></div>
        <div class="card kpi"><div class="t">Livraisons reçues</div><div class="v">${fmt(somme(recus, (e) => e.quantite))}</div><div class="s">unités${k.achats ? ' · ' + fmt(k.achats) + ' F' : ''}</div></div>
        <div class="card kpi"><div class="t">Répartition</div><div class="s num" style="margin-top:6px">${MODES.map(([m, l]) => `${l} ${fmt(k.parMode(m))}`).join('<br>')}</div></div>
      </section>
      ${titreSection('Par produit')}
      <section class="card"><div class="card-head"><h2>${esc(g.sigle)} · ${esc(libelle)}</h2>
        <div class="inline"><button class="btn btn-sm" id="csv">Exporter Excel</button><button class="btn btn-sm btn-p" id="imprimer">Imprimer le point ${esc(g.sigle)}</button></div></div>
        <div class="table-box">${tableau(false)}</div></section>
      ${titreSection("Stock " + esc(g.sigle) + " (aujourd'hui)")}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock ${esc(g.sigle)}</div><div class="v">${fmt(valeur)}</div><div class="s">FCFA, au prix ${esc(g.sigle)}</div></div>
        <div class="card kpi"><div class="t">Ruptures</div><div class="v" style="color:var(--rouge)">${ruptures}</div><div class="s"><a href="#/stock">Voir le stock</a></div></div>
        <div class="card kpi"><div class="t">Périment dans 90 jours</div><div class="v" style="color:var(--bleu)">${bientot}</div><div class="s">lots à écouler en priorité</div></div>
      </section>`;

    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><strong>${esc(ph.etablissement || ph.nom || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
          <div style="text-align:center;font-weight:700;font-size:16px">POINT ${esc(g.sigle)} — ${esc(g.nom.toUpperCase())}</div>
          <div style="text-align:right">Période : ${esc(libelle)}<br>Date : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <div style="margin-top:12px">${tableau(true)}</div>
        <div style="margin-top:8px;font-size:12px">${MODES.map(([m, l]) => `${l} : ${fmt(k.parMode(m))} F`).join(' · ')}</div>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`);
    };
    el.querySelector('#csv').onclick = () => {
      const l = [['Produit', 'Prix ' + g.sigle, 'Reçu', 'Vendu', 'Montant', 'Stock actuel']];
      produits.forEach((x) => l.push([x.p.designation, x.prix, x.recu, x.vendu, x.montant, x.o.quantite]));
      l.push(['TOTAL ENCAISSÉ', '', '', unites, k.ca, '']);
      telecharger('point-' + g.sigle + '-' + isoJour() + '.csv', csv(l));
    };
  }

  await dessiner();
}
