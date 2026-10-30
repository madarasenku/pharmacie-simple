// Point général : un point par programme vendu, jamais mélangés.
//   • « Point PR.REC » : les produits recouvrables de la pharmacie (et, à côté, ce que les programmes gratuits ont donné) ;
//   • « Point PHPSP » : un par programme recouvrable (son argent est à reverser).
// Même présentation pour tous : ventes et bénéfices, bénéfice en un coup d'œil, jour par jour, par produit, stock valorisé.
import { esc, fmt, tout, rpc, isoJour, isoMois, nomMois, fmtDate, chargerCatalogue, joursAvant, prixDe, imprimer, csv, telecharger } from '../util.js';

const MODES = [['especes', 'Espèces'], ['momo', 'Mobile Money'], ['credit', 'Crédit']];

export async function render(el, ctx) {
  const { sb } = ctx;
  const rec = ctx.vente;
  const recouvrables = ctx.programmes.filter((g) => g.recouvrable && g.actif);
  const points = [rec, ...recouvrables].filter(Boolean);
  let vue = points[0]?.id; // programme du point affiché
  let periode = 'mois';
  let moisChoisi = isoMois();
  let tousProduits = false;

  if (!points.length) {
    el.innerHTML = '<div class="alert alert-warn">Aucun programme payant n’est configuré (onglet Base).</div>';
    return;
  }

  function bornes() {
    const auj = new Date(isoJour() + 'T00:00:00');
    const demain = new Date(auj.getTime() + 86400000);
    if (periode === 'jour') return [auj, demain, "Aujourd'hui"];
    if (periode === 'semaine') return [new Date(auj.getTime() - 6 * 86400000), demain, '7 derniers jours'];
    if (periode === 'mois') return [new Date(auj.getFullYear(), auj.getMonth(), 1), demain, 'Ce mois'];
    if (periode === 'annee') return [new Date(auj.getFullYear(), 0, 1), demain, 'Cette année'];
    if (periode === 'choisi') {
      const [a, m] = moisChoisi.split('-').map(Number);
      return [new Date(a, m - 1, 1), new Date(a, m, 1), nomMois(moisChoisi)];
    }
    return [new Date(auj.getFullYear(), auj.getMonth() - 1, 1), new Date(auj.getFullYear(), auj.getMonth(), 1), 'Mois dernier'];
  }

  const somme = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const titreSection = (t) => `<h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">${t}</h2>`;
  const pct = (m) => (m === null || m === undefined ? '—' : Math.round(m) + ' %');
  const couleurBenef = (v) => (v < 0 ? 'var(--rouge)' : '#1A6438');
  const titrePoint = (g) => (g.est_vente ? 'Point PR.' + g.sigle : 'Point ' + g.sigle);
  const nomPrix = (g) => (g.est_vente ? 'Prix vente' : 'Prix ' + g.sigle);

  // Totaux de bénéfices sur [de, a[ (dates « AAAA-MM-JJ »)
  const totalBenef = (r, de, a) => {
    const dans = (x) => x.jour >= de && x.jour < a;
    const js = r.jours.filter(dans);
    const ca = somme(js, (x) => Number(x.ca));
    const cout = somme(js, (x) => Number(x.cout));
    const perte = somme(r.pertes.filter(dans), (x) => Number(x.valeur));
    return { ca, cout, perte, credit: somme(js, (x) => Number(x.credit)), nb: somme(js, (x) => Number(x.nb)), brut: ca - cout, net: ca - cout - perte, marge: ca ? ((ca - cout) / ca) * 100 : null };
  };

  async function dessiner() {
    const g = points.find((x) => x.id === vue) || points[0];
    vue = g.id;
    const [debut, fin, libelle] = bornes();
    const auj = new Date(isoJour() + 'T00:00:00');
    const demain = new Date(auj.getTime() + 86400000);
    const debutAnnee = new Date(auj.getFullYear(), 0, 1);
    const debutCartes = new Date(Math.min(debutAnnee.getTime(), auj.getTime() - 6 * 86400000));
    const per = { p_debut: isoJour(debut), p_fin: isoJour(fin) };
    const gratuits = g.est_vente ? ctx.programmes.filter((p) => p.actif && !p.est_vente && !p.recouvrable) : [];
    const [ventes, entrees, catalogue, b, an, sv] = await Promise.all([
      tout(() => sb.from('ventes').select('id, programme_id, mode_paiement, ventes_lignes(quantite, prix_unitaire)')
        .eq('annulee', false).gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      tout(() => sb.from('mouvements').select('id, produit_id, quantite, prix_unitaire, programme_id').eq('type', 'entree').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      chargerCatalogue(sb),
      rpc(sb, 'benefices', { ...per, p_programme: g.id }),
      rpc(sb, 'benefices', { p_debut: isoJour(debutCartes), p_fin: isoJour(demain), p_programme: g.id }),
      rpc(sb, 'stock_valeurs', per)
    ]);

    // ----- Ventes et bénéfices de la période -----
    const t = totalBenef(b, per.p_debut, per.p_fin);
    const vs = ventes.filter((v) => v.programme_id === g.id && v.mode_paiement !== 'gratuit');
    // Calculée comme le chiffre d'affaires (lignes de vente) : les deux concordent toujours
    const montantVente = (v) => somme(v.ventes_lignes || [], (l) => l.quantite * Number(l.prix_unitaire));
    const parMode = (m) => somme(vs.filter((v) => v.mode_paiement === m), montantVente);
    const achats = somme(entrees.filter((e) => e.programme_id === g.id && e.prix_unitaire), (e) => e.quantite * e.prix_unitaire);
    const demainIso = isoJour(demain);
    const cartes = [
      ["Aujourd'hui", totalBenef(an, isoJour(auj), demainIso)],
      ['7 derniers jours', totalBenef(an, isoJour(new Date(auj.getTime() - 6 * 86400000)), demainIso)],
      ['Ce mois', totalBenef(an, isoJour(new Date(auj.getFullYear(), auj.getMonth(), 1)), demainIso)],
      ['Cette année', totalBenef(an, isoJour(debutAnnee), demainIso)]
    ];

    // ----- Jour par jour (ou mois par mois sur une longue période) -----
    const parMois = Math.round((fin - debut) / 86400000) > 62;
    const groupes = new Map();
    const groupe = (jour) => {
      const k = parMois ? jour.slice(0, 7) : jour;
      if (!groupes.has(k)) groupes.set(k, { k, ca: 0, cout: 0, nb: 0, perte: 0 });
      return groupes.get(k);
    };
    for (const x of b.jours) { const gr = groupe(x.jour); gr.ca += Number(x.ca); gr.cout += Number(x.cout); gr.nb += Number(x.nb); }
    for (const x of b.pertes) groupe(x.jour).perte += Number(x.valeur);
    const lignes = [...groupes.values()].sort((x, y) => (x.k < y.k ? 1 : -1));
    const maxBenef = Math.max(1, ...lignes.map((x) => x.ca - x.cout));
    const nomLigne = (k) => (parMois ? nomMois(k) : fmtDate(k));

    // ----- Par produit -----
    const prixProduit = (id) => { const p = catalogue.find((x) => x.id === id); return p ? prixDe(p, g.id) : 0; };
    const produits = b.produits;
    const montres = tousProduits ? produits : produits.slice(0, 15);
    const remarque = (x) => (x.sans_achat ? '<span class="badge b-low">Prix d’achat manquant</span>' : Number(x.ca) - Number(x.cout) < 0 ? '<span class="badge b-out">Vendu à perte</span>' : '');

    // ----- Stock du programme -----
    const val = (x, champ) => Number(x[champ]) * Number(x.prix);
    const toutes = sv.filter((x) => x.programme_id === g.id);
    const ls = toutes.filter((x) => ['debut', 'entrees', 'sorties', 'pertes', 'fin'].some((c) => Number(x[c]) !== 0));
    const st = { sorties: somme(toutes, (x) => val(x, 'sorties')), fin: somme(toutes, (x) => val(x, 'fin')), finAchat: somme(toutes, (x) => Number(x.fin) * Number(x.prix_achat)) };
    const rupture = (x) => Number(x.fin) <= 0 && (Number(x.debut) > 0 || Number(x.entrees) > 0);
    let ruptures = 0, aCommander = 0, bientot = 0;
    for (const p of catalogue.filter((x) => x.actif && x.origines[g.id])) {
      const o = p.origines[g.id];
      if (o.quantite <= 0 && o.aEuDuStock) ruptures++;
      else if (o.aEuDuStock && (o.quantite < Math.ceil(2 * o.cmm) || o.quantite < p.stock_min)) aCommander++;
      const j = joursAvant(o.prochaine);
      if (j !== null && j <= 90) bientot++;
    }

    // ----- Programmes gratuits (Point PR.REC seulement) -----
    const resumeGratuit = gratuits.map((p) => {
      const lsP = sv.filter((x) => x.programme_id === p.id);
      const vsP = ventes.filter((v) => v.programme_id === p.id);
      return { p, beneficiaires: vsP.length, donnees: somme(vsP, (v) => somme(v.ventes_lignes || [], (l) => l.quantite)),
        recues: somme(entrees.filter((e) => e.programme_id === p.id), (e) => e.quantite),
        valeurDonnee: somme(lsP, (x) => val(x, 'sorties')), valeurRestante: somme(lsP, (x) => val(x, 'fin')) };
    });

    const boutons = `<div class="origines" role="group" aria-label="Quel point ?">
        ${points.map((x) => `<button class="org ${x.id === g.id ? (x.est_vente ? 'on' : 'on-r') : ''}" data-vue="${x.id}"><strong>${esc(titrePoint(x))}</strong>
          <span class="small">${esc(x.est_vente ? 'Produits recouvrables' : x.nom + ' · recouvrable')}</span></button>`).join('')}
      </div>`;
    const periodes = `<div class="inline" role="group" aria-label="Période">
        ${[['jour', "Aujourd'hui"], ['semaine', '7 jours'], ['mois', 'Ce mois'], ['precedent', 'Mois dernier'], ['annee', 'Cette année']]
          .map(([k, l]) => `<button class="chip ${periode === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
        <label class="sr" for="mois-choisi">Choisir un mois précis</label>
        <input class="in" type="month" id="mois-choisi" value="${moisChoisi}" max="${isoMois()}" style="width:auto;${periode === 'choisi' ? 'border-color:var(--vert);box-shadow:0 0 0 2px #CDE9DA' : ''}">
      </div>`;

    el.innerHTML = `
      <div class="page-head"><div><h1>${esc(titrePoint(g))}</h1><div class="small muted">${esc(libelle)} · ${g.est_vente
        ? 'produits recouvrables de la pharmacie' + (recouvrables.length ? ` (sans ${esc(recouvrables.map((x) => x.sigle).join(', '))}, qui a son propre point)` : '')
        : esc(g.nom) + ', programme recouvrable : compté à part, jamais mélangé au point PR.' + esc(rec?.sigle || 'REC')}</div></div>
        ${periodes}</div>
      ${boutons}
      ${titreSection('Ventes (argent)')}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Chiffre d'affaires</div><div class="v">${fmt(t.ca)}</div><div class="s">FCFA · ${fmt(t.nb)} vente(s)${g.recouvrable ? ' · à reverser' : ''}</div></div>
        <div class="card kpi"><div class="t">Bénéfice estimé</div><div class="v" style="color:${couleurBenef(t.brut)}">${fmt(t.brut)}</div><div class="s">FCFA · marge ${pct(t.marge)}</div></div>
        <div class="card kpi"><div class="t">Achats de médicaments</div><div class="v">${fmt(achats)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Répartition</div><div class="s num" style="margin-top:6px">${MODES.map(([m, l]) => `${l} ${fmt(parMode(m))}`).join('<br>')}</div></div>
        <div class="card kpi"><div class="t">Pertes</div><div class="v" style="color:${t.perte ? 'var(--rouge)' : 'inherit'}">${fmt(t.perte)}</div><div class="s">périmés, casse, écarts (prix d’achat)</div></div>
        <div class="card kpi"><div class="t">Bénéfice net</div><div class="v" style="color:${couleurBenef(t.net)}">${fmt(t.net)}</div><div class="s">FCFA, après pertes</div></div>
      </section>
      ${g.recouvrable ? `<div class="alert alert-prog">${esc(g.nom)} est un programme recouvrable : ses recettes (${fmt(t.ca)} F sur la période) sont à reverser selon ses règles.</div>` : ''}
      ${titreSection('Bénéfice en un coup d’œil')}
      <section class="grid-kpi">
        ${cartes.map(([titre, c]) => `<div class="card kpi"><div class="t">${titre}</div><div class="v" style="color:${couleurBenef(c.brut)}">${fmt(c.brut)}</div>
          <div class="s">FCFA de bénéfice · ${fmt(c.ca)} de ventes${c.perte ? `<br>− ${fmt(c.perte)} de pertes = <strong>${fmt(c.net)}</strong> net` : ''}</div></div>`).join('')}
      </section>
      <section class="card" data-bloc="jours"><div class="card-head"><h2>${parMois ? 'Mois par mois' : 'Jour par jour'}</h2>
        <div class="inline"><button class="btn btn-sm" id="csv">Exporter Excel</button><button class="btn btn-sm btn-p" id="imprimer">Imprimer le ${esc(titrePoint(g))}</button></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>${parMois ? 'Mois' : 'Jour'}</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Marge</th><th class="r">Pertes</th><th class="r">Net</th><th></th></tr></thead>
          <tbody>${lignes.map((x) => `<tr><td>${esc(nomLigne(x.k))}</td><td class="num r">${fmt(x.ca)}</td><td class="num r">${fmt(x.cout)}</td>
            <td class="num r" style="font-weight:700;color:${couleurBenef(x.ca - x.cout)}">${fmt(x.ca - x.cout)}</td><td class="num r muted">${pct(x.ca ? ((x.ca - x.cout) / x.ca) * 100 : null)}</td>
            <td class="num r" style="color:${x.perte ? 'var(--rouge)' : 'inherit'}">${x.perte ? fmt(x.perte) : '—'}</td><td class="num r" style="font-weight:600">${fmt(x.ca - x.cout - x.perte)}</td>
            <td style="width:120px"><div class="barre"><i style="width:${Math.max(0, Math.round(((x.ca - x.cout) / maxBenef) * 100))}%"></i></div></td></tr>`).join('')
            || '<tr><td colspan="8" class="muted">Aucune vente sur cette période.</td></tr>'}
            ${lignes.length ? `<tr><td style="font-weight:700">TOTAL</td><td class="num r" style="font-weight:700">${fmt(t.ca)}</td><td class="num r" style="font-weight:700">${fmt(t.cout)}</td>
              <td class="num r" style="font-weight:700">${fmt(t.brut)}</td><td class="num r">${pct(t.marge)}</td><td class="num r" style="font-weight:700">${fmt(t.perte)}</td><td class="num r" style="font-weight:700">${fmt(t.net)}</td><td></td></tr>` : ''}</tbody>
        </table></div></section>
      <section class="card" data-bloc="produits"><div class="card-head"><div><h2>Par produit</h2><div class="small muted">Produits vendus sur la période, ceux qui rapportent le plus d’abord. Un prix d’achat à 0 donne un faux bénéfice : corrigez-le dans la <a href="#/base">Base</a>.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Vendu</th><th class="r">Montant</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Marge</th><th></th></tr></thead>
          <tbody>${montres.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r">${fmt(prixProduit(x.produit_id))}</td><td class="num r">${fmt(x.quantite)}</td><td class="num r" style="font-weight:600">${fmt(x.ca)}</td><td class="num r">${fmt(x.cout)}</td>
            <td class="num r" style="font-weight:700;color:${couleurBenef(x.ca - x.cout)}">${fmt(x.ca - x.cout)}</td><td class="num r muted">${pct(Number(x.ca) ? ((x.ca - x.cout) / x.ca) * 100 : null)}</td>
            <td>${remarque(x)}${remarque(x) ? ` <a class="small" href="#/base?rech=${encodeURIComponent(x.designation)}">Corriger</a>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="8" class="muted">Aucune vente sur cette période.</td></tr>'}
            ${produits.length ? `<tr><td colspan="3" style="text-align:right;font-weight:700">${g.recouvrable ? 'TOTAL ENCAISSÉ' : 'TOTAL'}</td><td class="num r" style="font-weight:700">${fmt(t.ca)}</td><td class="num r" style="font-weight:700">${fmt(t.cout)}</td><td class="num r" style="font-weight:700">${fmt(t.brut)}</td><td colspan="2"></td></tr>` : ''}</tbody>
        </table></div>
        ${produits.length > 15 ? `<div style="padding:10px 14px"><button class="btn btn-sm" id="tous-produits">${tousProduits ? 'Réduire à 15' : 'Voir les ' + produits.length + ' produits'}</button></div>` : ''}</section>
      ${titreSection('Stock ' + esc(g.sigle))}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock ${esc(g.sigle)}</div><div class="v">${fmt(st.fin)}</div><div class="s">FCFA au ${g.est_vente ? 'prix de vente' : 'prix ' + esc(g.sigle)}${g.est_vente ? ` · ${fmt(st.finAchat)} au prix d’achat` : ''}</div></div>
        <div class="card kpi"><div class="t">Ruptures</div><div class="v" style="color:var(--rouge)">${ruptures}</div><div class="s">produits déjà reçus, à zéro aujourd’hui</div></div>
        <div class="card kpi"><div class="t">À commander</div><div class="v" style="color:var(--orange)">${aCommander}</div><div class="s"><a href="#/stock">Voir la liste</a></div></div>
        <div class="card kpi"><div class="t">Périment dans 90 jours</div><div class="v" style="color:var(--bleu)">${bientot}</div><div class="s">lots à écouler en priorité</div></div>
      </section>
      <section class="card" data-bloc="stock"><div class="card-head"><div><h2>Stock et valeurs ${esc(g.sigle)}</h2><div class="small muted">Début + entrées − sorties − pertes = reste, sur la période.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes et écarts</th><th class="r">Reste</th><th class="r">Valeur sortie</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${ls.map((x) => `<tr><td>${esc(x.designation)}${rupture(x) ? ' <span class="badge b-out">Rupture</span>' : ''}</td><td class="num r">${fmt(x.prix)}</td><td class="num r">${fmt(x.debut)}</td><td class="num r">${fmt(x.entrees)}</td>
            <td class="num r" style="font-weight:600">${fmt(x.sorties)}</td><td class="num r">${fmt(x.pertes)}</td><td class="num r" style="font-weight:700">${fmt(x.fin)}</td>
            <td class="num r">${fmt(val(x, 'sorties'))}</td><td class="num r" style="font-weight:700">${fmt(val(x, 'fin'))}</td></tr>`).join('')
            || `<tr><td colspan="9" class="muted">Aucun mouvement ni stock ${esc(g.sigle)} sur cette période.</td></tr>`}
            <tr><td colspan="7" style="text-align:right;font-weight:700">TOTAL (FCFA)</td><td class="num r" style="font-weight:700">${fmt(st.sorties)}</td><td class="num r" style="font-weight:700">${fmt(st.fin)}</td></tr></tbody></table></div>
        ${toutes.length > ls.length ? `<div class="small muted" style="padding:10px 18px">${toutes.length - ls.length} produit(s) sans stock ni mouvement sur la période ne sont pas listés.</div>` : ''}
      </section>
      ${gratuits.length ? `${titreSection('Programmes (gratuit)')}
      <section class="card" data-bloc="gratuits"><div class="table-box"><table class="tbl">
        <thead><tr><th>Programme</th><th class="r">Bénéficiaires</th><th class="r">Unités données</th><th class="r">Unités reçues</th><th class="r">Valeur donnée</th><th class="r">Valeur restante</th><th></th></tr></thead>
        <tbody>${resumeGratuit.map((x) => `<tr><td><strong>${esc(x.p.nom)}</strong> <span class="badge b-prog">${esc(x.p.sigle)}</span></td><td class="num r">${fmt(x.beneficiaires)}</td>
          <td class="num r" style="color:var(--violet);font-weight:600">${fmt(x.donnees)}</td><td class="num r">${fmt(x.recues)}</td>
          <td class="num r">${fmt(x.valeurDonnee)}</td><td class="num r" style="font-weight:700">${fmt(x.valeurRestante)}</td><td><a href="#/programmes">Détail</a></td></tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="padding:8px 18px 12px">Rien n’est vendu : la valeur d’un programme gratuit se règle dans la Base (colonne « Valeur » du programme ; vide = prix de vente normal).</div></section>` : ''}
      ${g.est_vente ? '<div class="inline"><a class="btn btn-p" href="#/rapport">Rapport commandes recouvrables (district)</a><a class="btn" href="#/programmes">Comptes rendus des programmes</a></div>' : ''}`;

    el.querySelectorAll('[data-p]').forEach((x) => x.onclick = () => { periode = x.dataset.p; dessiner(); });
    const m = el.querySelector('#mois-choisi');
    m.onchange = () => { if (!m.value) return; moisChoisi = m.value; periode = 'choisi'; dessiner(); };
    el.querySelectorAll('[data-vue]').forEach((x) => x.onclick = () => { vue = Number(x.dataset.vue); tousProduits = false; dessiner(); });
    const tp = el.querySelector('#tous-produits');
    if (tp) tp.onclick = () => { tousProduits = !tousProduits; dessiner(); };

    el.querySelector('#csv').onclick = () => {
      const l = [[titrePoint(g) + ' — ' + libelle], [], ["Chiffre d'affaires", t.ca], ['Bénéfice estimé', t.brut], ['Achats de médicaments', achats],
        ...MODES.map(([mo, lb]) => [lb, parMode(mo)]), ['Pertes', t.perte], ['Bénéfice net', t.net], [],
        [parMois ? 'Mois' : 'Jour', 'Ventes', "Coût d'achat", 'Bénéfice', 'Pertes', 'Net'],
        ...lignes.slice().reverse().map((x) => [nomLigne(x.k), x.ca, x.cout, x.ca - x.cout, x.perte, x.ca - x.cout - x.perte]), [],
        ['Produit', nomPrix(g), 'Vendu', 'Montant', "Coût d'achat", 'Bénéfice'],
        ...produits.map((x) => [x.designation, prixProduit(x.produit_id), x.quantite, x.ca, x.cout, x.ca - x.cout]), [],
        ['Produit', nomPrix(g), 'Début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Reste', 'Valeur sortie', 'Valeur restante'],
        ...ls.map((x) => [x.designation, x.prix, x.debut, x.entrees, x.sorties, x.pertes, x.fin, val(x, 'sorties'), val(x, 'fin')])];
      telecharger(titrePoint(g).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + isoJour(debut) + '.csv', csv(l));
    };
    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><strong>${esc(ph.etablissement || ph.nom || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
          <div style="text-align:center;font-weight:700;font-size:16px">${esc(titrePoint(g).toUpperCase())}${g.recouvrable ? ' — ' + esc(g.nom.toUpperCase()) : ''}</div>
          <div style="text-align:right">Période : ${esc(libelle)}<br>Date : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <div style="margin-top:10px;font-size:12px">Chiffre d'affaires : <strong>${fmt(t.ca)} F</strong> · Bénéfice estimé : <strong>${fmt(t.brut)} F</strong> · Achats : ${fmt(achats)} F
          · Pertes : ${fmt(t.perte)} F · Bénéfice net : <strong>${fmt(t.net)} F</strong><br>${MODES.map(([mo, lb]) => `${lb} : ${fmt(parMode(mo))} F`).join(' · ')}</div>
        <table class="ft" style="margin-top:10px"><thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Vendu</th><th class="r">Montant</th><th class="r">Coût</th><th class="r">Bénéfice</th></tr></thead>
          <tbody>${produits.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r n">${fmt(prixProduit(x.produit_id))}</td><td class="num r n">${fmt(x.quantite)}</td><td class="num r n">${fmt(x.ca)}</td><td class="num r n">${fmt(x.cout)}</td><td class="num r n">${fmt(x.ca - x.cout)}</td></tr>`).join('')}
          <tr><td colspan="3"><strong>${g.recouvrable ? 'TOTAL ENCAISSÉ' : 'TOTAL'}</strong></td><td class="num r n"><strong>${fmt(t.ca)}</strong></td><td class="num r n"><strong>${fmt(t.cout)}</strong></td><td class="num r n"><strong>${fmt(t.brut)}</strong></td></tr></tbody></table>
        <div style="font-weight:700;margin:12px 0 6px">Stock ${esc(g.sigle)}</div>
        <table class="ft"><thead><tr><th>Produit</th><th class="r">Prix</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes</th><th class="r">Reste</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${ls.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r n">${fmt(x.prix)}</td><td class="num r n">${fmt(x.debut)}</td><td class="num r n">${fmt(x.entrees)}</td><td class="num r n">${fmt(x.sorties)}</td><td class="num r n">${fmt(x.pertes)}</td><td class="num r n">${fmt(x.fin)}</td><td class="num r n">${fmt(val(x, 'fin'))}</td></tr>`).join('')}
          <tr><td colspan="7" style="text-align:right"><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(st.fin)}</strong></td></tr></tbody></table>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`, { paysage: true });
    };
  }

  await dessiner();
}
