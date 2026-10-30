// Mon stock : stock par origine, alertes, lots, corrections et historique.
import { esc, fmt, fmtPeremption, fmtDateHeure, q, rpc, erreur, toast, modal, chargerCatalogue, correspond, entier, csv, telecharger, isoJour, joursAvant, local, prixDe } from '../util.js';

const TYPES = { entree: 'Entrée', vente: 'Vente', distribution: 'Distribution', correction: 'Correction', perime: 'Périmé', annulation: 'Annulation' };

export async function render(el, ctx) {
  const { sb } = ctx;
  let catalogue = [];
  let filtre = 'tout';
  let recherche = '';
  const origines = ctx.programmes.filter((p) => p.actif);
  const vente = ctx.vente;
  // Origine affichée : « tout » ou un programme (choix gardé sur l'appareil, comme l'Inventaire)
  let vue = local.lire('stock_origine', 'tout');
  if (vue !== 'tout' && !origines.some((o) => o.id === vue)) vue = 'tout';
  const nom = (id) => { const o = origines.find((x) => x.id === id); return o ? (o.sigle) : '?'; };
  const visibles = () => (vue === 'tout' ? origines : origines.filter((o) => o.id === vue));

  // État d'un produit, calculé seulement sur les origines affichées. « drap » garde TOUS ses signaux
  // (un produit peut être à la fois en rupture et avoir un lot périmé) : les filtres s'en servent.
  function etatProduit(p) {
    const cles = visibles().map((o) => o.id).filter((id) => p.origines[id]);
    if (!cles.length) return { cle: 'aucun', texte: 'Sans origine', badge: 'b-low', drap: new Set(['aucun']) };
    // « Rupture » seulement pour un produit qui a déjà été en stock : sinon c'est un produit jamais saisi
    const ruptures = cles.filter((id) => p.origines[id].quantite <= 0 && p.origines[id].aEuDuStock);
    const jamais = cles.every((id) => p.origines[id].quantite <= 0 && !p.origines[id].aEuDuStock);
    const bas = cles.filter((id) => p.origines[id].quantite > 0 && p.origines[id].quantite < Math.max(p.stock_min, Math.ceil(p.origines[id].cmm)));
    const perimes = cles.filter((id) => p.origines[id].perimee > 0);
    const bientot = cles.some((id) => { const j = joursAvant(p.origines[id].prochaine); return j !== null && j <= 90; });
    const qui = (ids) => (vue === 'tout' ? ' · ' + ids.map(nom).join(', ') : '');
    const drap = new Set([...(ruptures.length ? ['rupture'] : []), ...(bas.length ? ['bas'] : []), ...(perimes.length ? ['perime'] : []),
      ...(bientot ? ['bientot'] : []), ...(jamais ? ['jamais'] : [])]);
    // Un lot périmé encore sur l'étagère passe avant tout : il risque d'être servi par erreur
    if (perimes.length) return { cle: 'perime', texte: 'Périmé à retirer' + qui(perimes) + (ruptures.length ? ' · rupture' : bas.length ? ' · stock bas' : ''), badge: 'b-out', drap };
    if (ruptures.length) return { cle: 'rupture', texte: 'Rupture' + qui(ruptures), badge: 'b-out', drap };
    if (bas.length) return { cle: 'bas', texte: 'Bas' + qui(bas), badge: 'b-low', drap };
    if (bientot) return { cle: 'bientot', texte: 'Périme bientôt', badge: 'b-exp', drap };
    if (jamais) return { cle: 'jamais', texte: 'Jamais en stock', badge: 'b-neutre', drap };
    return { cle: 'ok', texte: 'OK', badge: 'b-ok', drap };
  }

  // Chiffres d'un produit sur les origines affichées
  function chiffres(p) {
    const os = visibles().map((o) => p.origines[o.id]).filter(Boolean);
    return {
      total: os.reduce((s, o) => s + o.quantite, 0),
      cmm: os.reduce((s, o) => s + o.cmm, 0),
      prochaine: os.map((o) => o.prochaine).filter(Boolean).sort()[0] || null
    };
  }

  // Prix et valeur du stock : pour ceux qui voient les rapports (gérant, responsable), pas pour les agents
  const voirValeurs = ctx.peut('rapports');
  const valeurDe = (p) => visibles().reduce((s, o) => s + (p.origines[o.id] ? p.origines[o.id].quantite * prixDe(p, o.id) : 0), 0);

  function dessiner() {
    const cols = visibles();
    const enVue = catalogue.filter((p) => p.actif && cols.some((o) => p.origines[o.id]));
    const avecEtat = enVue.map((p) => ({ p, e: etatProduit(p) }));
    const garde = (x, k) => k === 'tout' || x.e.drap.has(k) || (k === 'bas' && x.e.drap.has('rupture'));
    const compte = (k) => avecEtat.filter((x) => garde(x, k)).length;
    const liste = avecEtat
      .filter((x) => garde(x, filtre))
      .filter((x) => correspond(x.p, recherche));
    const plusieurs = cols.length > 1;
    const valeurTotale = liste.reduce((s, { p }) => s + valeurDe(p), 0);
    const nbCols = (plusieurs ? cols.length + 1 : 1) + 5 + (voirValeurs ? (plusieurs ? 1 : 2) : 0);

    const montrerCommande = vente && (vue === 'tout' || vue === vente.id);
    const aCommander = montrerCommande ? catalogue.filter((p) => p.actif && p.origines[vente.id]).map((p) => {
      const o = p.origines[vente.id];
      return { p, o, qte: Math.max(0, Math.ceil(2 * o.cmm - o.quantite)) };
    }).filter((x) => x.o.aEuDuStock && (x.qte > 0 || x.o.quantite < x.p.stock_min)) : [];
    const progsVus = cols.filter((x) => !x.est_vente);
    const aDemander = [];
    for (const p of catalogue) for (const o of progsVus) {
      const s = p.origines[o.id];
      if (p.actif && s && s.aEuDuStock && s.quantite < Math.max(p.stock_min, Math.ceil(s.cmm))) aDemander.push({ p, o, s });
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Mon stock</h1><div class="small muted">Le stock baisse à chaque vente ou distribution et monte à chaque entrée. Cliquez sur un produit pour voir ses lots et son historique.</div></div>
        <div class="inline"><button class="btn" id="export">Exporter Excel</button>${ctx.peut('rapports') ? '<a class="btn" href="#/rapport">Rapport de commande district</a>' : ''}</div></div>
      <div class="origines" role="group" aria-label="Origine affichée">
        <button class="org ${vue === 'tout' ? 'on' : ''}" data-vue="tout"><strong>Tout</strong><span class="small">toutes les origines</span></button>
        ${origines.map((o) => `<button class="org ${o.id === vue ? (o.est_vente ? 'on' : o.recouvrable ? 'on-r' : 'on-v') : ''}" data-vue="${o.id}"><strong>${esc(o.sigle)}</strong><span class="small">${esc(o.est_vente ? 'recouvrable · payant' : o.recouvrable ? o.nom + ' · payant' : o.nom)}</span></button>`).join('')}
      </div>
      ${compte('jamais') && ctx.peut('corriger') ? `<div class="alert alert-prog">${compte('jamais')} produit(s) n’ont encore jamais eu de stock enregistré${vue === 'tout' ? '' : ' en ' + esc(nom(vue))}.
        S’ils sont déjà sur vos étagères, saisissez-les dans <a href="#/inventaire">Inventaire</a> (stock de départ) ; sinon faites une <a href="#/entree">entrée</a> à leur réception.</div>` : ''}
      <div class="inline">
        <div style="flex:1 1 280px"><label class="sr" for="rech">Chercher</label><input class="in" id="rech" type="search" placeholder="Chercher un produit ou un code-barres" value="${esc(recherche)}"></div>
        <div class="inline" role="group" aria-label="Filtrer">
          ${[['tout', 'Tout', avecEtat.length], ['bas', 'À commander', compte('bas')], ['rupture', 'Rupture', compte('rupture')], ['bientot', 'Périme bientôt', compte('bientot')], ['perime', 'Périmés', compte('perime')], ['jamais', 'Jamais en stock', compte('jamais')]]
            .map(([k, l, n]) => `<button class="chip ${filtre === k ? 'on' : ''}" data-filtre="${k}">${l} <span class="num">${n}</span></button>`).join('')}
        </div>
      </div>
      <div class="card"><div class="table-box"><table class="tbl">
        <thead><tr><th>Produit</th>${plusieurs ? cols.map((o) => `<th class="r ${o.est_vente ? '' : 'prog-col'}">${esc(o.sigle)}</th>`).join('') + '<th class="r">Total</th>' : `<th class="r">Stock ${esc(nom(vue))}</th>`}${voirValeurs ? (plusieurs ? '' : `<th class="r">Prix ${esc(nom(vue))}</th>`) + '<th class="r">Valeur (F)</th>' : ''}<th class="r">Conso / mois</th><th class="r" title="Mois de stock disponible : stock ÷ consommation mensuelle">MSD</th><th>Péremption</th><th>État</th></tr></thead>
        <tbody>${liste.map(({ p, e }) => {
          const c = chiffres(p);
          return `<tr class="clic" data-produit="${p.id}"><td>${esc(p.designation)}</td>
            ${plusieurs ? cols.map((o) => `<td class="num r ${o.est_vente ? '' : 'prog-col'}" style="${o.est_vente ? 'font-weight:600' : ''}">${p.origines[o.id] ? fmt(p.origines[o.id].quantite) : '—'}</td>`).join('') : ''}
            <td class="num r" style="font-weight:700">${fmt(c.total)}</td>${voirValeurs ? (plusieurs ? '' : `<td class="num r">${fmt(prixDe(p, vue))}</td>`) + `<td class="num r">${fmt(valeurDe(p))}</td>` : ''}<td class="num r muted">${c.cmm ? c.cmm.toFixed(1).replace('.', ',') : '—'}</td>
            <td class="num r" style="${c.cmm && c.total / c.cmm < 1 ? 'color:var(--rouge);font-weight:700' : ''}">${c.cmm ? (c.total / c.cmm).toFixed(1).replace('.', ',') : '—'}</td>
            <td class="num">${fmtPeremption(c.prochaine)}</td><td><span class="badge ${e.badge}">${esc(e.texte)}</span></td></tr>`;
        }).join('') || `<tr><td colspan="${nbCols}" class="muted">Aucun produit${vue === 'tout' ? '' : ' rattaché à ' + esc(nom(vue))}.</td></tr>`}
          ${voirValeurs && liste.length ? `<tr><td colspan="${(plusieurs ? cols.length + 1 : 1) + (plusieurs ? 0 : 1) + 1}" style="text-align:right;font-weight:700">VALEUR DU STOCK AFFICHÉ${filtre === 'tout' && !recherche ? '' : ' (liste filtrée)'}</td><td class="num r" style="font-weight:700">${fmt(valeurTotale)}</td><td colspan="4"></td></tr>` : ''}</tbody>
      </table></div>
        ${voirValeurs ? '<div class="small muted" style="padding:8px 18px 12px">Valeur = stock utilisable × prix de l’origine (prix de vente, prix PHPSP, ou valeur du programme saisie dans la Base). Les lots périmés ne comptent pas.</div>' : ''}</div>

      <div class="row">
        ${montrerCommande ? `<section class="card card-pad stack" style="flex:1 1 380px">
          <h2>À commander (${esc(vente.sigle)})</h2>
          <div class="small muted">Quantité = 2 × consommation mensuelle − stock disponible.</div>
          ${aCommander.map((x) => `<div class="inline" style="justify-content:space-between;border-bottom:1px solid #EDF1EF;padding:6px 0">
            <span>${esc(x.p.designation)}<br><span class="small muted">stock ${x.o.quantite} · conso ${String(x.o.cmm).replace('.', ',')}/mois</span></span><strong class="num">${fmt(x.qte)}</strong></div>`).join('') || '<div class="muted">Rien à commander.</div>'}
        </section>` : ''}
        ${progsVus.length ? `<section class="card card-pad stack" style="flex:1 1 380px">
          <h2 style="color:var(--violet)">${vue === 'tout' ? 'À demander aux programmes' : 'À demander au ' + esc(nom(vue))}</h2>
          ${aDemander.map((x) => `<div class="inline" style="justify-content:space-between;border-bottom:1px solid #EDF1EF;padding:6px 0">
            <span>${esc(x.p.designation)}<br><span class="small muted">stock ${x.s.quantite}</span></span><span class="badge b-prog">${esc(x.o.sigle)}</span></div>`).join('') || '<div class="muted">Rien à demander.</div>'}
        </section>` : ''}
      </div>`;

    el.querySelectorAll('[data-vue]').forEach((b) => b.onclick = () => {
      vue = b.dataset.vue === 'tout' ? 'tout' : Number(b.dataset.vue);
      local.ecrire('stock_origine', vue);
      dessiner();
    });
    el.querySelectorAll('[data-filtre]').forEach((b) => b.onclick = () => { filtre = b.dataset.filtre; dessiner(); });
    const r = el.querySelector('#rech');
    r.oninput = () => {
      recherche = r.value;
      const pos = r.selectionStart;
      dessiner();
      const n = el.querySelector('#rech');
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    el.querySelectorAll('[data-produit]').forEach((tr) => tr.onclick = () => detail(catalogue.find((p) => p.id === Number(tr.dataset.produit))).catch(erreur));
    el.querySelector('#export').onclick = () => {
      const lignes = [['Produit', ...(plusieurs ? [...cols.map((o) => (o.sigle)), 'Total'] : ['Stock ' + nom(vue)]), ...(voirValeurs ? [...(plusieurs ? [] : ['Prix ' + nom(vue)]), 'Valeur'] : []), 'Conso/mois', 'MSD (mois)', 'Péremption', 'État']];
      for (const { p, e } of liste) {
        const c = chiffres(p);
        lignes.push([p.designation, ...(plusieurs ? cols.map((o) => p.origines[o.id]?.quantite ?? '') : []), c.total, ...(voirValeurs ? [...(plusieurs ? [] : [prixDe(p, vue)]), valeurDe(p)] : []), c.cmm, c.cmm ? Math.round((c.total / c.cmm) * 10) / 10 : '', fmtPeremption(c.prochaine), e.texte]);
      }
      telecharger('stock-' + (vue === 'tout' ? 'tout' : nom(vue)) + '-' + isoJour() + '.csv', csv(lignes));
    };
  }

  async function detail(p) {
    const [lots, mvts] = await Promise.all([
      q(sb.from('lots').select('*').eq('produit_id', p.id).order('peremption', { nullsFirst: false })),
      q(sb.from('mouvements').select('*, profiles(nom)').eq('produit_id', p.id).order('created_at', { ascending: false }).limit(40))
    ]);
    const nom = (id) => { const o = origines.find((x) => x.id === id); return o ? (o.sigle) : '?'; };
    const peutCorriger = ctx.peut('corriger');
    const m = modal(p.designation, `
      <div class="small muted">${p.code_barres ? 'Code-barres ' + esc(p.code_barres) + ' · ' : ''}Prix de vente ${fmt(p.prix_vente)} F · minimum ${p.stock_min}</div>
      <h3>Lots en stock</h3>
      <div class="table-box"><table class="tbl"><thead><tr><th>Origine</th><th>Lot</th><th>Péremption</th><th class="r">Qté</th>${peutCorriger ? '<th>Correction</th>' : ''}</tr></thead>
        <tbody>${lots.filter((l) => l.quantite > 0 || peutCorriger).map((l) => {
          const perime = l.peremption && new Date(l.peremption) < new Date(isoJour());
          return `<tr><td><span class="badge ${origines.find((o) => o.id === l.programme_id)?.est_vente ? 'b-ok' : 'b-prog'}">${esc(nom(l.programme_id))}</span></td>
          <td class="num">${esc(l.numero || '—')}</td><td class="num">${fmtPeremption(l.peremption)} ${perime ? '<span class="badge b-out">Périmé</span>' : ''}</td>
          <td class="num r" style="font-weight:600">${fmt(l.quantite)}</td>
          ${peutCorriger ? `<td><div class="inline" style="flex-wrap:nowrap">
            <label class="sr" for="c-${l.id}">Quantité réelle</label><input class="in num" id="c-${l.id}" style="width:80px" inputmode="numeric" placeholder="réel">
            <select class="in" data-motif="${l.id}" style="width:150px" aria-label="Motif">${(perime ? ['Périmé jeté', 'Erreur de comptage', 'Casse / perte'] : ['Erreur de comptage', 'Casse / perte', 'Périmé jeté']).map((x) => `<option>${x}</option>`).join('')}</select>
            <button class="btn btn-sm" data-corriger="${l.id}">OK</button></div></td>` : ''}</tr>`;
        }).join('') || '<tr><td colspan="5" class="muted">Aucun lot.</td></tr>'}</tbody></table></div>
      ${peutCorriger ? '<div class="small muted">Pour recompter tout le stock d’un coup, utilisez la page <a href="#/inventaire">Inventaire</a>.</div>' : '<div class="small muted">Seul le gérant (ou une personne autorisée) peut corriger le stock.</div>'}
      <h3>Historique</h3>
      <div class="table-box"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Origine</th><th>Référence</th><th class="r">Qté</th><th>Par</th></tr></thead>
        <tbody>${mvts.map((x) => `<tr><td class="num small">${fmtDateHeure(x.created_at)}</td><td>${esc(TYPES[x.type])}</td><td>${esc(nom(x.programme_id))}</td>
          <td class="small">${esc(x.reference || x.motif || x.fournisseur || '')}</td>
          <td class="num r" style="font-weight:600;color:${x.quantite > 0 ? '#1A6438' : 'var(--rouge)'}">${x.quantite > 0 ? '+' : '−'}${fmt(Math.abs(x.quantite))}</td>
          <td class="small muted">${esc(x.profiles?.nom || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun mouvement.</td></tr>'}</tbody></table></div>`, { large: true });
    m.el.querySelectorAll('[data-corriger]').forEach((b) => b.onclick = async () => {
      const id = Number(b.dataset.corriger);
      const reel = entier(m.el.querySelector('#c-' + id).value);
      if (reel === null || reel < 0) return toast('Saisissez la quantité réellement présente.', 'warn');
      try {
        await rpc(sb, 'corriger_stock', { p_lot_id: id, p_quantite_reelle: reel, p_motif: m.el.querySelector(`[data-motif="${id}"]`).value });
        toast('Correction enregistrée.');
        m.fermer();
        catalogue = await chargerCatalogue(sb);
        dessiner();
        detail(catalogue.find((x) => x.id === p.id)).catch(erreur);
      } catch (e) { erreur(e); }
    });
  }

  catalogue = await chargerCatalogue(sb);
  dessiner();
}
