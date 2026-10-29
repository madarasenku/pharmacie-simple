// Point général : ventes, programmes et stock sur une période.
// Le point « normal » ne compte que la Vente ; chaque programme recouvrable (PHPSP…) a son propre point.
// Deux vues de plus pour la direction : les bénéfices (jour, mois, année) et le stock valorisé de chaque programme.
import { esc, fmt, tout, rpc, isoJour, isoMois, nomMois, fmtDate, chargerCatalogue, joursAvant, prixDe, imprimer, csv, telecharger } from '../util.js';

const MODES = [['especes', 'Espèces'], ['momo', 'Mobile Money'], ['credit', 'Crédit']];

export async function render(el, ctx) {
  const { sb } = ctx;
  let periode = 'mois';
  const vente = ctx.vente;
  const recouvrables = ctx.programmes.filter((g) => g.recouvrable && g.actif);
  // « vente » = point normal ; « benefices » ; « stock » ; sinon l'id du programme recouvrable affiché
  let vue = 'vente';
  let moisChoisi = isoMois();
  let progStock = 'tous'; // vue « stock » : récapitulatif ou un programme
  let tousProduits = false; // vue « bénéfices » : classement complet des produits
  const nouvelles = () => vue === 'benefices' || vue === 'stock';

  function bornes() {
    const auj = new Date(isoJour() + 'T00:00:00');
    if (periode === 'jour') return [auj, new Date(auj.getTime() + 86400000), "Aujourd'hui"];
    if (periode === 'semaine') return [new Date(auj.getTime() - 6 * 86400000), new Date(auj.getTime() + 86400000), '7 derniers jours'];
    if (periode === 'mois') return [new Date(auj.getFullYear(), auj.getMonth(), 1), new Date(auj.getTime() + 86400000), 'Ce mois'];
    if (periode === 'annee') return [new Date(auj.getFullYear(), 0, 1), new Date(auj.getTime() + 86400000), 'Cette année'];
    if (periode === 'choisi') {
      const [a, m] = moisChoisi.split('-').map(Number);
      return [new Date(a, m - 1, 1), new Date(a, m, 1), nomMois(moisChoisi)];
    }
    return [new Date(auj.getFullYear(), auj.getMonth() - 1, 1), new Date(auj.getFullYear(), auj.getMonth(), 1), 'Mois dernier'];
  }

  const somme = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const titreSection = (t) => `<h2 class="muted small" style="text-transform:uppercase;letter-spacing:.06em">${t}</h2>`;
  const kpiArgent = (vs, achats) => {
    const ca = somme(vs, (v) => Number(v.total));
    const parMode = (m) => somme(vs.filter((v) => v.mode_paiement === m), (v) => Number(v.total));
    return { ca, parMode, achats };
  };

  function entete() {
    const [, , libelle] = bornes();
    const boutons = `<div class="origines" role="group" aria-label="Quel point ?">
        <button class="org ${vue === 'vente' ? 'on' : ''}" data-vue="vente"><strong>Point normal</strong><span class="small">Vente de la pharmacie</span></button>
        ${recouvrables.map((x) => `<button class="org ${vue === x.id ? 'on-r' : ''}" data-vue="${x.id}"><strong>Point ${esc(x.sigle)}</strong><span class="small">${esc(x.nom)} · recouvrable</span></button>`).join('')}
        <button class="org ${vue === 'benefices' ? 'on' : ''}" data-vue="benefices"><strong>Bénéfices</strong><span class="small">jour, mois, année</span></button>
        <button class="org ${vue === 'stock' ? 'on-v' : ''}" data-vue="stock"><strong>Stock et valeurs</strong><span class="small">par programme</span></button>
      </div>`;
    const liste = [['jour', "Aujourd'hui"], ['semaine', '7 jours'], ['mois', 'Ce mois'], ['precedent', 'Mois dernier'], ...(nouvelles() ? [['annee', 'Cette année']] : [])];
    const periodes = `<div class="inline" role="group" aria-label="Période">
          ${liste.map(([k, l]) => `<button class="chip ${periode === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
          <label class="sr" for="mois-choisi">Choisir un mois précis</label>
          <input class="in" type="month" id="mois-choisi" value="${moisChoisi}" max="${isoMois()}" style="width:auto;${periode === 'choisi' ? 'border-color:var(--vert);box-shadow:0 0 0 2px #CDE9DA' : ''}">
        </div>`;
    return { boutons, periodes, libelle };
  }

  function brancher() {
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { periode = b.dataset.p; dessiner(); });
    const m = el.querySelector('#mois-choisi');
    if (m) m.onchange = () => { if (!m.value) return; moisChoisi = m.value; periode = 'choisi'; dessiner(); };
    el.querySelectorAll('[data-vue]').forEach((b) => b.onclick = () => {
      vue = ['vente', 'benefices', 'stock'].includes(b.dataset.vue) ? b.dataset.vue : Number(b.dataset.vue);
      if (!nouvelles() && periode === 'annee') periode = 'mois';
      dessiner();
    });
  }

  async function dessiner() {
    if (nouvelles()) {
      const [debut, fin] = bornes();
      const infos = entete();
      if (vue === 'benefices') await dessinerBenefices(debut, fin, infos);
      else await dessinerStock(debut, fin, infos);
      brancher();
      return;
    }
    const [debut, fin, libelle] = bornes();
    const [ventes, entrees, catalogue] = await Promise.all([
      tout(() => sb.from('ventes').select('id, programme_id, mode_paiement, total, patient_tranche, ventes_lignes(produit_id, quantite, prix_unitaire, cout_unitaire)')
        .eq('annulee', false).gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      tout(() => sb.from('mouvements').select('id, produit_id, quantite, prix_unitaire, programme_id').eq('type', 'entree').gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('id')),
      chargerCatalogue(sb)
    ]);
    const g = vue === 'vente' ? null : recouvrables.find((x) => x.id === vue);
    if (vue !== 'vente' && !g) vue = 'vente';

    const { boutons, periodes } = entete();

    if (g) dessinerRecouvrable(g, { ventes, entrees, catalogue, libelle, boutons, periodes });
    else dessinerNormal({ ventes, entrees, catalogue, libelle, boutons, periodes });

    brancher();
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

  const pct = (m) => (m === null || m === undefined ? '—' : Math.round(m) + ' %');
  const couleurBenef = (v) => (v < 0 ? 'var(--rouge)' : '#1A6438');

  // ---------- Bénéfices : jour, mois, année (la Vente seulement) ----------
  async function dessinerBenefices(debut, fin, { boutons, periodes, libelle }) {
    const auj = new Date(isoJour() + 'T00:00:00');
    const demain = new Date(auj.getTime() + 86400000);
    const debutAnnee = new Date(auj.getFullYear(), 0, 1);
    const debutCartes = new Date(Math.min(debutAnnee.getTime(), auj.getTime() - 6 * 86400000));
    const [b, an] = await Promise.all([
      rpc(sb, 'benefices', { p_debut: isoJour(debut), p_fin: isoJour(fin) }),
      rpc(sb, 'benefices', { p_debut: isoJour(debutCartes), p_fin: isoJour(demain) })
    ]);

    const total = (r, de, a) => {
      const dans = (x) => x.jour >= de && x.jour < a;
      const js = r.jours.filter(dans);
      const ca = somme(js, (x) => Number(x.ca));
      const cout = somme(js, (x) => Number(x.cout));
      const perte = somme(r.pertes.filter(dans), (x) => Number(x.valeur));
      return { ca, cout, perte, credit: somme(js, (x) => Number(x.credit)), nb: somme(js, (x) => Number(x.nb)), brut: ca - cout, net: ca - cout - perte, marge: ca ? ((ca - cout) / ca) * 100 : null };
    };
    const demainIso = isoJour(demain);
    const cartes = [
      ["Aujourd'hui", total(an, isoJour(auj), demainIso)],
      ['7 derniers jours', total(an, isoJour(new Date(auj.getTime() - 6 * 86400000)), demainIso)],
      ['Ce mois', total(an, isoJour(new Date(auj.getFullYear(), auj.getMonth(), 1)), demainIso)],
      ['Cette année', total(an, isoJour(debutAnnee), demainIso)]
    ];
    const t = total(b, isoJour(debut), isoJour(fin));

    // Une ligne par jour (période courte) ou par mois (période longue)
    const parMois = Math.round((fin - debut) / 86400000) > 62;
    const groupes = new Map();
    const groupe = (jour) => {
      const k = parMois ? jour.slice(0, 7) : jour;
      if (!groupes.has(k)) groupes.set(k, { k, ca: 0, cout: 0, nb: 0, perte: 0 });
      return groupes.get(k);
    };
    for (const x of b.jours) { const g = groupe(x.jour); g.ca += Number(x.ca); g.cout += Number(x.cout); g.nb += Number(x.nb); }
    for (const x of b.pertes) groupe(x.jour).perte += Number(x.valeur);
    const lignes = [...groupes.values()].sort((x, y) => (x.k < y.k ? 1 : -1));
    const maxBenef = Math.max(1, ...lignes.map((g) => g.ca - g.cout));
    const nomLigne = (k) => (parMois ? nomMois(k) : fmtDate(k));

    const produits = b.produits;
    const montres = tousProduits ? produits : produits.slice(0, 15);
    const remarque = (x) => (x.sans_achat ? '<span class="badge b-low">Prix d’achat manquant</span>' : Number(x.ca) - Number(x.cout) < 0 ? '<span class="badge b-out">Vendu à perte</span>' : '');

    el.innerHTML = `
      <div class="page-head"><div><h1>Bénéfices</h1><div class="small muted">${esc(libelle)} · la Vente de la pharmacie (prix de vente moins prix d’achat). Les programmes gratuits ne rapportent rien et ${recouvrables.length ? esc(recouvrables.map((x) => x.sigle).join(', ')) + ' est à reverser : ' : ''}ils ne sont pas comptés ici.</div></div>
        ${periodes}</div>
      ${boutons}
      ${titreSection('En un coup d’œil')}
      <section class="grid-kpi">
        ${cartes.map(([titre, c]) => `<div class="card kpi"><div class="t">${titre}</div><div class="v" style="color:${couleurBenef(c.brut)}">${fmt(c.brut)}</div>
          <div class="s">FCFA de bénéfice · ${fmt(c.ca)} de ventes${c.perte ? `<br>− ${fmt(c.perte)} de pertes = <strong>${fmt(c.net)}</strong> net` : ''}</div></div>`).join('')}
      </section>
      ${titreSection(esc(libelle))}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Ventes</div><div class="v">${fmt(t.ca)}</div><div class="s">FCFA · ${fmt(t.nb)} vente(s)</div></div>
        <div class="card kpi"><div class="t">Coût d'achat</div><div class="v">${fmt(t.cout)}</div><div class="s">FCFA, ce que ces produits ont coûté</div></div>
        <div class="card kpi"><div class="t">Bénéfice</div><div class="v" style="color:${couleurBenef(t.brut)}">${fmt(t.brut)}</div><div class="s">FCFA · marge ${pct(t.marge)}</div></div>
        <div class="card kpi"><div class="t">Pertes</div><div class="v" style="color:${t.perte ? 'var(--rouge)' : 'inherit'}">${fmt(t.perte)}</div><div class="s">périmés, casse, écarts d’inventaire (prix d’achat)</div></div>
        <div class="card kpi"><div class="t">Bénéfice net</div><div class="v" style="color:${couleurBenef(t.net)}">${fmt(t.net)}</div><div class="s">FCFA, après pertes</div></div>
        <div class="card kpi"><div class="t">Vendu à crédit</div><div class="v">${fmt(t.credit)}</div><div class="s">FCFA pas forcément encaissés : <a href="#/credits">voir les crédits</a></div></div>
      </section>
      <section class="card"><div class="card-head"><h2>${parMois ? 'Mois par mois' : 'Jour par jour'}</h2>
        <div class="inline"><button class="btn btn-sm" id="csv">Exporter Excel</button><button class="btn btn-sm btn-p" id="imprimer">Imprimer</button></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>${parMois ? 'Mois' : 'Jour'}</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Marge</th><th class="r">Pertes</th><th class="r">Net</th><th></th></tr></thead>
          <tbody>${lignes.map((g) => `<tr><td>${esc(nomLigne(g.k))}</td><td class="num r">${fmt(g.ca)}</td><td class="num r">${fmt(g.cout)}</td>
            <td class="num r" style="font-weight:700;color:${couleurBenef(g.ca - g.cout)}">${fmt(g.ca - g.cout)}</td><td class="num r muted">${pct(g.ca ? ((g.ca - g.cout) / g.ca) * 100 : null)}</td>
            <td class="num r" style="color:${g.perte ? 'var(--rouge)' : 'inherit'}">${g.perte ? fmt(g.perte) : '—'}</td><td class="num r" style="font-weight:600">${fmt(g.ca - g.cout - g.perte)}</td>
            <td style="width:120px"><div class="barre"><i style="width:${Math.max(0, Math.round(((g.ca - g.cout) / maxBenef) * 100))}%"></i></div></td></tr>`).join('')
            || '<tr><td colspan="8" class="muted">Aucune vente sur cette période.</td></tr>'}
            ${lignes.length ? `<tr><td style="font-weight:700">TOTAL</td><td class="num r" style="font-weight:700">${fmt(t.ca)}</td><td class="num r" style="font-weight:700">${fmt(t.cout)}</td>
              <td class="num r" style="font-weight:700">${fmt(t.brut)}</td><td class="num r">${pct(t.marge)}</td><td class="num r" style="font-weight:700">${fmt(t.perte)}</td><td class="num r" style="font-weight:700">${fmt(t.net)}</td><td></td></tr>` : ''}</tbody>
        </table></div></section>
      <section class="card"><div class="card-head"><div><h2>Produits qui rapportent le plus</h2><div class="small muted">Classés par bénéfice sur la période. Un prix d’achat à 0 donne un faux bénéfice : corrigez-le dans la <a href="#/base">Base</a>.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">Vendu</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Marge</th><th></th></tr></thead>
          <tbody>${montres.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r">${fmt(x.quantite)}</td><td class="num r">${fmt(x.ca)}</td><td class="num r">${fmt(x.cout)}</td>
            <td class="num r" style="font-weight:700;color:${couleurBenef(x.ca - x.cout)}">${fmt(x.ca - x.cout)}</td><td class="num r muted">${pct(Number(x.ca) ? ((x.ca - x.cout) / x.ca) * 100 : null)}</td>
            <td>${remarque(x)}${remarque(x) ? ` <a class="small" href="#/base?rech=${encodeURIComponent(x.designation)}">Corriger</a>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="7" class="muted">Aucune vente sur cette période.</td></tr>'}</tbody>
        </table></div>
        ${produits.length > 15 ? `<div style="padding:10px 14px"><button class="btn btn-sm" id="tous-produits">${tousProduits ? 'Réduire à 15' : 'Voir les ' + produits.length + ' produits'}</button></div>` : ''}</section>`;

    const tp = el.querySelector('#tous-produits');
    if (tp) tp.onclick = () => { tousProduits = !tousProduits; dessiner(); };
    el.querySelector('#csv').onclick = () => {
      const l = [[parMois ? 'Mois' : 'Jour', 'Ventes', "Coût d'achat", 'Bénéfice', 'Pertes', 'Net']];
      lignes.slice().reverse().forEach((g) => l.push([nomLigne(g.k), g.ca, g.cout, g.ca - g.cout, g.perte, g.ca - g.cout - g.perte]));
      l.push(['TOTAL', t.ca, t.cout, t.brut, t.perte, t.net], [], ['Produit', 'Vendu', 'Ventes', "Coût d'achat", 'Bénéfice']);
      produits.forEach((x) => l.push([x.designation, x.quantite, x.ca, x.cout, x.ca - x.cout]));
      telecharger('benefices-' + isoJour(debut) + '.csv', csv(l));
    };
    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><strong>${esc(ph.etablissement || ph.nom || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
          <div style="text-align:center;font-weight:700;font-size:16px">BÉNÉFICES — ${esc(libelle.toUpperCase())}</div>
          <div style="text-align:right">Date : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <table class="ft" style="margin-top:12px"><thead><tr><th>${parMois ? 'Mois' : 'Jour'}</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Pertes</th><th class="r">Net</th></tr></thead>
          <tbody>${lignes.slice().reverse().map((g) => `<tr><td>${esc(nomLigne(g.k))}</td><td class="num r n">${fmt(g.ca)}</td><td class="num r n">${fmt(g.cout)}</td><td class="num r n">${fmt(g.ca - g.cout)}</td><td class="num r n">${fmt(g.perte)}</td><td class="num r n">${fmt(g.ca - g.cout - g.perte)}</td></tr>`).join('')}
          <tr><td><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(t.ca)}</strong></td><td class="num r n"><strong>${fmt(t.cout)}</strong></td><td class="num r n"><strong>${fmt(t.brut)}</strong></td><td class="num r n"><strong>${fmt(t.perte)}</strong></td><td class="num r n"><strong>${fmt(t.net)}</strong></td></tr></tbody></table>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`);
    };
  }

  // ---------- Stock et valeurs : par programme, ce qui reste, ce qui est sorti, à quel prix ----------
  async function dessinerStock(debut, fin, { boutons, periodes, libelle }) {
    const sv = await rpc(sb, 'stock_valeurs', { p_debut: isoJour(debut), p_fin: isoJour(fin) });
    const actifs = ctx.programmes.filter((g) => g.actif);
    if (progStock !== 'tous' && !actifs.some((g) => g.id === progStock)) progStock = 'tous';
    const type = (g) => (g.est_vente ? 'Vente' : g.recouvrable ? 'Recouvrable' : 'Gratuit');
    const nomPrix = (g) => (g.est_vente ? 'Prix vente' : g.recouvrable ? 'Prix ' + g.sigle : 'Valeur ' + g.sigle);
    const val = (x, champ) => Number(x[champ]) * Number(x.prix);
    const lignesDe = (id) => sv.filter((x) => x.programme_id === id);
    const resume = actifs.map((g) => {
      const ls = lignesDe(g.id);
      return { g, nb: ls.filter((x) => Number(x.fin) > 0).length, debut: somme(ls, (x) => val(x, 'debut')), entrees: somme(ls, (x) => val(x, 'entrees')),
        sorties: somme(ls, (x) => val(x, 'sorties')), pertes: somme(ls, (x) => val(x, 'pertes')), fin: somme(ls, (x) => val(x, 'fin')) };
    });
    const tot = (champ) => somme(resume, (r) => r[champ]);
    const venteRes = resume.find((r) => r.g.est_vente);
    const g = progStock === 'tous' ? null : actifs.find((x) => x.id === progStock);
    const puces = `<div class="inline" role="group" aria-label="Programme">
        <button class="chip ${g ? '' : 'on'}" data-prog="tous">Tous les programmes</button>
        ${actifs.map((x) => `<button class="chip ${g && g.id === x.id ? 'on' : ''}" data-prog="${x.id}">${esc(x.est_vente ? 'Vente' : x.sigle)}</button>`).join('')}</div>`;

    let corps, imprimable, lignesCsv, nomFichier;
    if (!g) {
      corps = `<div class="table-box"><table class="tbl">
          <thead><tr><th>Programme</th><th>Type</th><th class="r">Produits en stock</th><th class="r">Valeur au début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes et écarts</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${resume.map((r) => `<tr class="clic" data-prog="${r.g.id}"><td><strong>${esc(r.g.nom)}</strong> <span class="badge ${r.g.est_vente ? 'b-ok' : r.g.recouvrable ? 'b-rec' : 'b-prog'}">${esc(r.g.est_vente ? 'Vente' : r.g.sigle)}</span></td><td class="small">${type(r.g)}</td>
            <td class="num r">${fmt(r.nb)}</td><td class="num r">${fmt(r.debut)}</td><td class="num r">${fmt(r.entrees)}</td><td class="num r" style="font-weight:600">${fmt(r.sorties)}</td>
            <td class="num r">${fmt(r.pertes)}</td><td class="num r" style="font-weight:700">${fmt(r.fin)}</td></tr>`).join('')}
            <tr><td colspan="3" style="text-align:right;font-weight:700">TOTAL (FCFA)</td><td class="num r" style="font-weight:700">${fmt(tot('debut'))}</td><td class="num r" style="font-weight:700">${fmt(tot('entrees'))}</td>
              <td class="num r" style="font-weight:700">${fmt(tot('sorties'))}</td><td class="num r" style="font-weight:700">${fmt(tot('pertes'))}</td><td class="num r" style="font-weight:700">${fmt(tot('fin'))}</td></tr></tbody></table></div>`;
      imprimable = `<table class="ft"><thead><tr><th>Programme</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes</th><th class="r">Valeur restante</th></tr></thead><tbody>
        ${resume.map((r) => `<tr><td>${esc(r.g.nom)}</td><td class="num r n">${fmt(r.debut)}</td><td class="num r n">${fmt(r.entrees)}</td><td class="num r n">${fmt(r.sorties)}</td><td class="num r n">${fmt(r.pertes)}</td><td class="num r n">${fmt(r.fin)}</td></tr>`).join('')}
        <tr><td><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(tot('debut'))}</strong></td><td class="num r n"><strong>${fmt(tot('entrees'))}</strong></td><td class="num r n"><strong>${fmt(tot('sorties'))}</strong></td><td class="num r n"><strong>${fmt(tot('pertes'))}</strong></td><td class="num r n"><strong>${fmt(tot('fin'))}</strong></td></tr></tbody></table>`;
      lignesCsv = [['Programme', 'Type', 'Valeur au début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Valeur restante'],
        ...resume.map((r) => [r.g.nom, type(r.g), r.debut, r.entrees, r.sorties, r.pertes, r.fin]), ['TOTAL', '', tot('debut'), tot('entrees'), tot('sorties'), tot('pertes'), tot('fin')]];
      nomFichier = 'stock-valeurs-tous';
    } else {
      const toutes = lignesDe(g.id);
      const ls = toutes.filter((x) => ['debut', 'entrees', 'sorties', 'pertes', 'fin'].some((c) => Number(x[c]) !== 0));
      const r = resume.find((x) => x.g.id === g.id);
      const rupture = (x) => Number(x.fin) <= 0 && (Number(x.debut) > 0 || Number(x.entrees) > 0);
      corps = `<div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes et écarts</th><th class="r">Reste</th><th class="r">Valeur sortie</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${ls.map((x) => `<tr><td>${esc(x.designation)}${rupture(x) ? ' <span class="badge b-out">Rupture</span>' : ''}</td><td class="num r">${fmt(x.prix)}</td><td class="num r">${fmt(x.debut)}</td><td class="num r">${fmt(x.entrees)}</td>
            <td class="num r" style="font-weight:600">${fmt(x.sorties)}</td><td class="num r">${fmt(x.pertes)}</td><td class="num r" style="font-weight:700">${fmt(x.fin)}</td>
            <td class="num r">${fmt(val(x, 'sorties'))}</td><td class="num r" style="font-weight:700">${fmt(val(x, 'fin'))}</td></tr>`).join('')
            || `<tr><td colspan="9" class="muted">Aucun mouvement ni stock pour ${esc(g.sigle)} sur cette période.</td></tr>`}
            <tr><td colspan="7" style="text-align:right;font-weight:700">TOTAL (FCFA)</td><td class="num r" style="font-weight:700">${fmt(r.sorties)}</td><td class="num r" style="font-weight:700">${fmt(r.fin)}</td></tr></tbody></table></div>
        ${toutes.length > ls.length ? `<div class="small muted" style="padding:10px 18px">${toutes.length - ls.length} produit(s) sans stock ni mouvement sur la période ne sont pas listés.</div>` : ''}
        ${g.est_vente ? '' : `<div class="small muted" style="padding:0 18px 12px">${esc(nomPrix(g))} : modifiable produit par produit dans la <a href="#/base">Base</a> (colonne « ${g.recouvrable ? 'Prix' : 'Valeur'} ${esc(g.sigle)} » ; vide = prix de vente normal).</div>`}`;
      imprimable = `<table class="ft"><thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes</th><th class="r">Reste</th><th class="r">Valeur sortie</th><th class="r">Valeur restante</th></tr></thead><tbody>
        ${ls.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r n">${fmt(x.prix)}</td><td class="num r n">${fmt(x.debut)}</td><td class="num r n">${fmt(x.entrees)}</td><td class="num r n">${fmt(x.sorties)}</td><td class="num r n">${fmt(x.pertes)}</td><td class="num r n">${fmt(x.fin)}</td><td class="num r n">${fmt(val(x, 'sorties'))}</td><td class="num r n">${fmt(val(x, 'fin'))}</td></tr>`).join('')}
        <tr><td colspan="7" style="text-align:right"><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(r.sorties)}</strong></td><td class="num r n"><strong>${fmt(r.fin)}</strong></td></tr></tbody></table>`;
      lignesCsv = [['Produit', nomPrix(g), 'Début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Reste', 'Valeur sortie', 'Valeur restante'],
        ...ls.map((x) => [x.designation, x.prix, x.debut, x.entrees, x.sorties, x.pertes, x.fin, val(x, 'sorties'), val(x, 'fin')]), ['TOTAL', '', '', '', '', '', '', r.sorties, r.fin]];
      nomFichier = 'stock-valeurs-' + g.sigle;
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Stock et valeurs</h1><div class="small muted">${esc(libelle)} · pour chaque programme : le stock au début, les entrées, ce qui est sorti (vendu ou donné), les pertes, ce qui reste, et leur valeur en francs.</div></div>
        ${periodes}</div>
      ${boutons}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock restant</div><div class="v">${fmt(tot('fin'))}</div><div class="s">FCFA, tous programmes${venteRes ? ` · dont Vente ${fmt(venteRes.fin)}` : ''}</div></div>
        <div class="card kpi"><div class="t">Valeur sortie</div><div class="v">${fmt(tot('sorties'))}</div><div class="s">FCFA vendus ou donnés sur la période</div></div>
        <div class="card kpi"><div class="t">Valeur entrée</div><div class="v">${fmt(tot('entrees'))}</div><div class="s">FCFA reçus sur la période</div></div>
      </section>
      <section class="card"><div class="card-head"><div><h2>${g ? esc(g.nom) : 'Récapitulatif par programme'}</h2><div class="small muted">${g ? 'Prix de chaque produit pour ce programme.' : 'Cliquez sur un programme pour voir ses produits.'}</div></div>
        <div class="inline">${puces}<button class="btn btn-sm" id="csv">Exporter Excel</button><button class="btn btn-sm btn-p" id="imprimer">Imprimer</button></div></div>
        ${corps}</section>`;

    el.querySelectorAll('[data-prog]').forEach((b) => b.onclick = () => { progStock = b.dataset.prog === 'tous' ? 'tous' : Number(b.dataset.prog); dessiner(); });
    el.querySelector('#csv').onclick = () => telecharger(nomFichier + '-' + isoJour(debut) + '.csv', csv(lignesCsv));
    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><strong>${esc(ph.etablissement || ph.nom || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
          <div style="text-align:center;font-weight:700;font-size:16px">STOCK ET VALEURS — ${esc((g ? g.nom : 'TOUS LES PROGRAMMES').toUpperCase())}</div>
          <div style="text-align:right">Période : ${esc(libelle)}<br>Date : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <div style="margin-top:12px">${imprimable}</div>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`, { paysage: !!g });
    };
  }

  await dessiner();
}
