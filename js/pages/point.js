// Point général : ventes, programmes et stock sur une période.
// Le point « normal » ne compte que la Vente ; chaque programme recouvrable (PHPSP…) a son propre point.
// Une vue de plus pour la direction : « Bénéfices et stock », filtrée par programme (bénéfices jour, mois, année et stock valorisé).
import { esc, fmt, tout, rpc, isoJour, isoMois, nomMois, fmtDate, chargerCatalogue, joursAvant, prixDe, estPayant, imprimer, csv, telecharger } from '../util.js';

const MODES = [['especes', 'Espèces'], ['momo', 'Mobile Money'], ['credit', 'Crédit']];

export async function render(el, ctx) {
  const { sb } = ctx;
  let periode = 'mois';
  const vente = ctx.vente;
  const recouvrables = ctx.programmes.filter((g) => g.recouvrable && g.actif);
  // « vente » = point normal ; « resultats » = bénéfices et stock ; sinon l'id du programme recouvrable affiché
  let vue = 'vente';
  let moisChoisi = isoMois();
  let filtre = 'tous'; // « Bénéfices et stock » : tous les programmes, ou l'id d'un programme
  let tousProduits = false; // classement complet des produits
  const nouvelles = () => vue === 'resultats';

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
        <button class="org ${vue === 'resultats' ? 'on' : ''}" data-vue="resultats"><strong>Bénéfices et stock</strong><span class="small">par programme · jour, mois, année</span></button>
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
      vue = ['vente', 'resultats'].includes(b.dataset.vue) ? b.dataset.vue : Number(b.dataset.vue);
      if (!nouvelles() && periode === 'annee') periode = 'mois';
      dessiner();
    });
  }

  async function dessiner() {
    if (nouvelles()) {
      const [debut, fin] = bornes();
      const infos = entete();
      await dessinerResultats(debut, fin, infos);
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
  const nomCourt = (g) => (g.est_vente ? 'Vente' : g.sigle);
  const typeDe = (g) => (g.est_vente ? 'Vente' : g.recouvrable ? 'Recouvrable' : 'Gratuit');
  const nomPrix = (g) => (g.est_vente ? 'Prix vente' : g.recouvrable ? 'Prix ' + g.sigle : 'Valeur ' + g.sigle);
  const badgeDe = (g) => (g.est_vente ? 'b-ok' : g.recouvrable ? 'b-rec' : 'b-prog');

  // Totaux de bénéfices sur [de, a[ (dates « AAAA-MM-JJ »)
  const totalBenef = (r, de, a) => {
    const dans = (x) => x.jour >= de && x.jour < a;
    const js = r.jours.filter(dans);
    const ca = somme(js, (x) => Number(x.ca));
    const cout = somme(js, (x) => Number(x.cout));
    const perte = somme(r.pertes.filter(dans), (x) => Number(x.valeur));
    return { ca, cout, perte, credit: somme(js, (x) => Number(x.credit)), nb: somme(js, (x) => Number(x.nb)), brut: ca - cout, net: ca - cout - perte, marge: ca ? ((ca - cout) / ca) * 100 : null };
  };

  // ---------- Bénéfices et stock : un seul écran, avec en haut le choix du programme ----------
  async function dessinerResultats(debut, fin, { boutons, periodes, libelle }) {
    const actifs = ctx.programmes.filter((x) => x.actif);
    if (filtre !== 'tous' && !actifs.some((x) => x.id === filtre)) filtre = 'tous';
    const g = filtre === 'tous' ? null : actifs.find((x) => x.id === filtre);
    const payants = actifs.filter(estPayant);
    const auj = new Date(isoJour() + 'T00:00:00');
    const demain = new Date(auj.getTime() + 86400000);
    const debutAnnee = new Date(auj.getFullYear(), 0, 1);
    const debutCartes = new Date(Math.min(debutAnnee.getTime(), auj.getTime() - 6 * 86400000));
    const per = { p_debut: isoJour(debut), p_fin: isoJour(fin) };
    // Un seul aller-retour : le stock de tous les programmes, et les bénéfices de ce qu'on regarde
    const demandes = g ? (estPayant(g) ? [{ ...per, p_programme: g.id }, { p_debut: isoJour(debutCartes), p_fin: isoJour(demain), p_programme: g.id }] : [])
      : payants.map((x) => ({ ...per, p_programme: x.id }));
    const [sv, ...benefs] = await Promise.all([rpc(sb, 'stock_valeurs', per), ...demandes.map((a) => rpc(sb, 'benefices', a))]);

    // Stock valorisé
    const val = (x, champ) => Number(x[champ]) * Number(x.prix);
    const lignesDe = (id) => sv.filter((x) => x.programme_id === id);
    const resume = actifs.map((x) => {
      const ls = lignesDe(x.id);
      return { g: x, nb: ls.filter((l) => Number(l.fin) > 0).length, debut: somme(ls, (l) => val(l, 'debut')), entrees: somme(ls, (l) => val(l, 'entrees')),
        sorties: somme(ls, (l) => val(l, 'sorties')), pertes: somme(ls, (l) => val(l, 'pertes')), fin: somme(ls, (l) => val(l, 'fin')) };
    });
    const tot = (champ) => somme(resume, (r) => r[champ]);

    const filtreHtml = `<div class="origines" role="group" aria-label="Quel programme ?">
        <button class="org ${g ? '' : 'on'}" data-filtre="tous"><strong>Tout</strong><span class="small">tous les programmes</span></button>
        ${actifs.map((x) => `<button class="org ${g && g.id === x.id ? (x.est_vente ? 'on' : x.recouvrable ? 'on-r' : 'on-v') : ''}" data-filtre="${x.id}"><strong>${esc(nomCourt(x))}</strong><span class="small">${esc(x.est_vente ? 'bénéfices et stock' : x.recouvrable ? 'recouvrable · bénéfices et stock' : 'gratuit · stock')}</span></button>`).join('')}
      </div>`;

    let corps, imprimable, lignesCsv, nomFichier;
    if (!g) ({ corps, imprimable, lignesCsv, nomFichier } = vueTout(resume, tot, payants, benefs, per));
    else {
      const stock = vueStock(g, lignesDe(g.id), resume.find((r) => r.g.id === g.id));
      const benef = estPayant(g) ? vueBenefices(g, benefs[0], benefs[1], debut, fin, libelle, { auj, demain, debutAnnee }) : null;
      corps = (benef ? benef.html : vueDonne(g, resume.find((r) => r.g.id === g.id))) + stock.html;
      imprimable = (benef ? benef.imprimable + '<div style="height:16px"></div>' : '') + stock.imprimable;
      lignesCsv = [...(benef ? [...benef.csv, []] : []), ...stock.csv];
      nomFichier = 'benefices-stock-' + nomCourt(g);
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Bénéfices et stock</h1><div class="small muted">${esc(libelle)} · choisissez un programme : ses bénéfices (s’il est vendu), puis son stock au début, ses entrées, ce qui est sorti, ses pertes et ce qui reste, avec leur valeur en francs.</div></div>
        ${periodes}</div>
      ${boutons}
      ${titreSection('Quel programme ?')}
      ${filtreHtml}
      <div class="inline" style="justify-content:flex-end"><button class="btn btn-sm" id="csv">Exporter Excel</button><button class="btn btn-sm btn-p" id="imprimer">Imprimer</button></div>
      ${corps}`;

    el.querySelectorAll('[data-filtre]').forEach((b) => b.onclick = () => { filtre = b.dataset.filtre === 'tous' ? 'tous' : Number(b.dataset.filtre); tousProduits = false; dessiner(); });
    const tp = el.querySelector('#tous-produits');
    if (tp) tp.onclick = () => { tousProduits = !tousProduits; dessiner(); };
    el.querySelector('#csv').onclick = () => telecharger(nomFichier + '-' + isoJour(debut) + '.csv', csv(lignesCsv));
    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><strong>${esc(ph.etablissement || ph.nom || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
          <div style="text-align:center;font-weight:700;font-size:16px">BÉNÉFICES ET STOCK — ${esc((g ? g.nom : 'TOUS LES PROGRAMMES').toUpperCase())}</div>
          <div style="text-align:right">Période : ${esc(libelle)}<br>Date : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <div style="margin-top:12px">${imprimable}</div>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`, { paysage: !!g });
    };
  }

  // « Tout » : une ligne par programme, bénéfice (programmes vendus) et valeurs du stock
  function vueTout(resume, tot, payants, benefs, per) {
    const parProg = new Map(payants.map((x, i) => [x.id, totalBenef(benefs[i], per.p_debut, per.p_fin)]));
    const cartes = payants.map((x) => {
      const b = parProg.get(x.id);
      return `<div class="card kpi"><div class="t">Bénéfice ${esc(nomCourt(x))}</div><div class="v" style="color:${couleurBenef(b.brut)}">${fmt(b.brut)}</div><div class="s">FCFA · ${fmt(b.ca)} de ventes${x.recouvrable ? ' (à reverser)' : ''}</div></div>`;
    }).join('');
    const corps = `
      <section class="grid-kpi">${cartes}
        <div class="card kpi"><div class="t">Valeur sortie</div><div class="v">${fmt(tot('sorties'))}</div><div class="s">FCFA vendus ou donnés, tous programmes</div></div>
        <div class="card kpi"><div class="t">Valeur du stock restant</div><div class="v">${fmt(tot('fin'))}</div><div class="s">FCFA, tous programmes</div></div>
      </section>
      <section class="card"><div class="card-head"><div><h2>Récapitulatif par programme</h2><div class="small muted">Cliquez sur un programme pour voir ses bénéfices et ses produits.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Programme</th><th>Type</th><th class="r">Ventes</th><th class="r">Bénéfice</th><th class="r">Valeur au début</th><th class="r">Entrées</th><th class="r">Valeur sortie</th><th class="r">Pertes et écarts</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${resume.map((r) => {
            const b = parProg.get(r.g.id);
            return `<tr class="clic" data-filtre="${r.g.id}"><td><strong>${esc(r.g.nom)}</strong> <span class="badge ${badgeDe(r.g)}">${esc(nomCourt(r.g))}</span></td><td class="small">${typeDe(r.g)}</td>
              <td class="num r">${b ? fmt(b.ca) : '—'}</td><td class="num r" style="font-weight:700;${b ? 'color:' + couleurBenef(b.brut) : ''}">${b ? fmt(b.brut) : '—'}</td>
              <td class="num r">${fmt(r.debut)}</td><td class="num r">${fmt(r.entrees)}</td><td class="num r" style="font-weight:600">${fmt(r.sorties)}</td>
              <td class="num r">${fmt(r.pertes)}</td><td class="num r" style="font-weight:700">${fmt(r.fin)}</td></tr>`;
          }).join('')}
            <tr><td colspan="4" style="text-align:right;font-weight:700">TOTAL DU STOCK (FCFA)</td><td class="num r" style="font-weight:700">${fmt(tot('debut'))}</td><td class="num r" style="font-weight:700">${fmt(tot('entrees'))}</td>
              <td class="num r" style="font-weight:700">${fmt(tot('sorties'))}</td><td class="num r" style="font-weight:700">${fmt(tot('pertes'))}</td><td class="num r" style="font-weight:700">${fmt(tot('fin'))}</td></tr></tbody></table></div>
      </section>`;
    const imprimable = `<table class="ft"><thead><tr><th>Programme</th><th class="r">Ventes</th><th class="r">Bénéfice</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes</th><th class="r">Valeur restante</th></tr></thead><tbody>
      ${resume.map((r) => { const b = parProg.get(r.g.id); return `<tr><td>${esc(r.g.nom)}</td><td class="num r n">${b ? fmt(b.ca) : '—'}</td><td class="num r n">${b ? fmt(b.brut) : '—'}</td><td class="num r n">${fmt(r.debut)}</td><td class="num r n">${fmt(r.entrees)}</td><td class="num r n">${fmt(r.sorties)}</td><td class="num r n">${fmt(r.pertes)}</td><td class="num r n">${fmt(r.fin)}</td></tr>`; }).join('')}
      <tr><td colspan="3"><strong>TOTAL DU STOCK</strong></td><td class="num r n"><strong>${fmt(tot('debut'))}</strong></td><td class="num r n"><strong>${fmt(tot('entrees'))}</strong></td><td class="num r n"><strong>${fmt(tot('sorties'))}</strong></td><td class="num r n"><strong>${fmt(tot('pertes'))}</strong></td><td class="num r n"><strong>${fmt(tot('fin'))}</strong></td></tr></tbody></table>`;
    const lignesCsv = [['Programme', 'Type', 'Ventes', 'Bénéfice', 'Valeur au début', 'Entrées', 'Valeur sortie', 'Pertes et écarts', 'Valeur restante'],
      ...resume.map((r) => { const b = parProg.get(r.g.id); return [r.g.nom, typeDe(r.g), b ? b.ca : '', b ? b.brut : '', r.debut, r.entrees, r.sorties, r.pertes, r.fin]; }),
      ['TOTAL DU STOCK', '', '', '', tot('debut'), tot('entrees'), tot('sorties'), tot('pertes'), tot('fin')]];
    return { corps, imprimable, lignesCsv, nomFichier: 'benefices-stock-tout' };
  }

  // Bénéfices d'un programme vendu (Vente ou recouvrable)
  function vueBenefices(g, b, an, debut, fin, libelle, { auj, demain, debutAnnee }) {
    const demainIso = isoJour(demain);
    const cartes = [
      ["Aujourd'hui", totalBenef(an, isoJour(auj), demainIso)],
      ['7 derniers jours', totalBenef(an, isoJour(new Date(auj.getTime() - 6 * 86400000)), demainIso)],
      ['Ce mois', totalBenef(an, isoJour(new Date(auj.getFullYear(), auj.getMonth(), 1)), demainIso)],
      ['Cette année', totalBenef(an, isoJour(debutAnnee), demainIso)]
    ];
    const t = totalBenef(b, isoJour(debut), isoJour(fin));
    // Une ligne par jour (période courte) ou par mois (période longue)
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
    const produits = b.produits;
    const montres = tousProduits ? produits : produits.slice(0, 15);
    const remarque = (x) => (x.sans_achat ? '<span class="badge b-low">Prix d’achat manquant</span>' : Number(x.ca) - Number(x.cout) < 0 ? '<span class="badge b-out">Vendu à perte</span>' : '');
    const nom = nomCourt(g);

    const html = `
      ${titreSection('Bénéfices ' + esc(nom) + ' en un coup d’œil')}
      <section class="grid-kpi">
        ${cartes.map(([titre, c]) => `<div class="card kpi"><div class="t">${titre}</div><div class="v" style="color:${couleurBenef(c.brut)}">${fmt(c.brut)}</div>
          <div class="s">FCFA de bénéfice · ${fmt(c.ca)} de ventes${c.perte ? `<br>− ${fmt(c.perte)} de pertes = <strong>${fmt(c.net)}</strong> net` : ''}</div></div>`).join('')}
      </section>
      ${g.recouvrable ? `<div class="alert alert-prog">${esc(g.nom)} est un programme recouvrable : ses recettes sont à reverser selon ses règles. Le détail à reverser est dans le <strong>Point ${esc(g.sigle)}</strong>.</div>` : ''}
      ${titreSection('Bénéfices ' + esc(nom) + ' · ' + esc(libelle))}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Ventes</div><div class="v">${fmt(t.ca)}</div><div class="s">FCFA · ${fmt(t.nb)} vente(s)</div></div>
        <div class="card kpi"><div class="t">Coût d'achat</div><div class="v">${fmt(t.cout)}</div><div class="s">FCFA, ce que ces produits ont coûté</div></div>
        <div class="card kpi"><div class="t">Bénéfice</div><div class="v" style="color:${couleurBenef(t.brut)}">${fmt(t.brut)}</div><div class="s">FCFA · marge ${pct(t.marge)}</div></div>
        <div class="card kpi"><div class="t">Pertes</div><div class="v" style="color:${t.perte ? 'var(--rouge)' : 'inherit'}">${fmt(t.perte)}</div><div class="s">périmés, casse, écarts d’inventaire (prix d’achat)</div></div>
        <div class="card kpi"><div class="t">Bénéfice net</div><div class="v" style="color:${couleurBenef(t.net)}">${fmt(t.net)}</div><div class="s">FCFA, après pertes</div></div>
        <div class="card kpi"><div class="t">Vendu à crédit</div><div class="v">${fmt(t.credit)}</div><div class="s">FCFA pas forcément encaissés : <a href="#/credits">voir les crédits</a></div></div>
      </section>
      <section class="card" data-bloc="jours"><div class="card-head"><h2>${parMois ? 'Mois par mois' : 'Jour par jour'}</h2></div>
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
      <section class="card" data-bloc="produits"><div class="card-head"><div><h2>Produits qui rapportent le plus</h2><div class="small muted">Classés par bénéfice sur la période. Un prix d’achat à 0 donne un faux bénéfice : corrigez-le dans la <a href="#/base">Base</a>.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">Vendu</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Marge</th><th></th></tr></thead>
          <tbody>${montres.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r">${fmt(x.quantite)}</td><td class="num r">${fmt(x.ca)}</td><td class="num r">${fmt(x.cout)}</td>
            <td class="num r" style="font-weight:700;color:${couleurBenef(x.ca - x.cout)}">${fmt(x.ca - x.cout)}</td><td class="num r muted">${pct(Number(x.ca) ? ((x.ca - x.cout) / x.ca) * 100 : null)}</td>
            <td>${remarque(x)}${remarque(x) ? ` <a class="small" href="#/base?rech=${encodeURIComponent(x.designation)}">Corriger</a>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="7" class="muted">Aucune vente sur cette période.</td></tr>'}</tbody>
        </table></div>
        ${produits.length > 15 ? `<div style="padding:10px 14px"><button class="btn btn-sm" id="tous-produits">${tousProduits ? 'Réduire à 15' : 'Voir les ' + produits.length + ' produits'}</button></div>` : ''}</section>`;

    const imprimable = `<div style="font-weight:700;margin-bottom:6px">Bénéfices ${esc(nom)}</div>
      <table class="ft"><thead><tr><th>${parMois ? 'Mois' : 'Jour'}</th><th class="r">Ventes</th><th class="r">Coût d'achat</th><th class="r">Bénéfice</th><th class="r">Pertes</th><th class="r">Net</th></tr></thead>
        <tbody>${lignes.slice().reverse().map((x) => `<tr><td>${esc(nomLigne(x.k))}</td><td class="num r n">${fmt(x.ca)}</td><td class="num r n">${fmt(x.cout)}</td><td class="num r n">${fmt(x.ca - x.cout)}</td><td class="num r n">${fmt(x.perte)}</td><td class="num r n">${fmt(x.ca - x.cout - x.perte)}</td></tr>`).join('')}
        <tr><td><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(t.ca)}</strong></td><td class="num r n"><strong>${fmt(t.cout)}</strong></td><td class="num r n"><strong>${fmt(t.brut)}</strong></td><td class="num r n"><strong>${fmt(t.perte)}</strong></td><td class="num r n"><strong>${fmt(t.net)}</strong></td></tr></tbody></table>`;
    const lignesCsv = [['Bénéfices ' + nom], [parMois ? 'Mois' : 'Jour', 'Ventes', "Coût d'achat", 'Bénéfice', 'Pertes', 'Net'],
      ...lignes.slice().reverse().map((x) => [nomLigne(x.k), x.ca, x.cout, x.ca - x.cout, x.perte, x.ca - x.cout - x.perte]),
      ['TOTAL', t.ca, t.cout, t.brut, t.perte, t.net], [], ['Produit', 'Vendu', 'Ventes', "Coût d'achat", 'Bénéfice'],
      ...produits.map((x) => [x.designation, x.quantite, x.ca, x.cout, x.ca - x.cout])];
    return { html, imprimable, csv: lignesCsv };
  }

  // Programme gratuit : pas de bénéfice, la valeur de ce qui a été donné
  function vueDonne(g, r) {
    return `${titreSection(esc(g.sigle) + ' · programme gratuit')}
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur donnée</div><div class="v" style="color:var(--violet)">${fmt(r.sorties)}</div><div class="s">FCFA distribués sur la période (pas de bénéfice : rien n’est vendu)</div></div>
        <div class="card kpi"><div class="t">Valeur reçue</div><div class="v">${fmt(r.entrees)}</div><div class="s">FCFA reçus sur la période</div></div>
        <div class="card kpi"><div class="t">Valeur du stock restant</div><div class="v">${fmt(r.fin)}</div><div class="s">FCFA · ${fmt(r.nb)} produit(s) en stock</div></div>
      </section>`;
  }

  // Stock d'un programme, produit par produit, avec sa valeur
  function vueStock(g, toutes, r) {
    const ls = toutes.filter((x) => ['debut', 'entrees', 'sorties', 'pertes', 'fin'].some((c) => Number(x[c]) !== 0));
    const val = (x, champ) => Number(x[champ]) * Number(x.prix);
    const rupture = (x) => Number(x.fin) <= 0 && (Number(x.debut) > 0 || Number(x.entrees) > 0);
    const html = `
      ${titreSection('Stock ' + esc(nomCourt(g)))}
      ${estPayant(g) ? `<section class="grid-kpi">
        <div class="card kpi"><div class="t">Valeur du stock restant</div><div class="v">${fmt(r.fin)}</div><div class="s">FCFA, au ${esc(nomPrix(g).toLowerCase())} · ${fmt(r.nb)} produit(s) en stock</div></div>
        <div class="card kpi"><div class="t">Valeur sortie</div><div class="v">${fmt(r.sorties)}</div><div class="s">FCFA sur la période</div></div>
        <div class="card kpi"><div class="t">Valeur entrée</div><div class="v">${fmt(r.entrees)}</div><div class="s">FCFA reçus sur la période</div></div>
      </section>` : ''}
      <section class="card" data-bloc="stock"><div class="card-head"><div><h2>${esc(g.nom)} : stock et valeurs</h2><div class="small muted">Début + entrées − sorties − pertes = reste.</div></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes et écarts</th><th class="r">Reste</th><th class="r">Valeur sortie</th><th class="r">Valeur restante</th></tr></thead>
          <tbody>${ls.map((x) => `<tr><td>${esc(x.designation)}${rupture(x) ? ' <span class="badge b-out">Rupture</span>' : ''}</td><td class="num r">${fmt(x.prix)}</td><td class="num r">${fmt(x.debut)}</td><td class="num r">${fmt(x.entrees)}</td>
            <td class="num r" style="font-weight:600">${fmt(x.sorties)}</td><td class="num r">${fmt(x.pertes)}</td><td class="num r" style="font-weight:700">${fmt(x.fin)}</td>
            <td class="num r">${fmt(val(x, 'sorties'))}</td><td class="num r" style="font-weight:700">${fmt(val(x, 'fin'))}</td></tr>`).join('')
            || `<tr><td colspan="9" class="muted">Aucun mouvement ni stock pour ${esc(nomCourt(g))} sur cette période.</td></tr>`}
            <tr><td colspan="7" style="text-align:right;font-weight:700">TOTAL (FCFA)</td><td class="num r" style="font-weight:700">${fmt(r.sorties)}</td><td class="num r" style="font-weight:700">${fmt(r.fin)}</td></tr></tbody></table></div>
        ${toutes.length > ls.length ? `<div class="small muted" style="padding:10px 18px">${toutes.length - ls.length} produit(s) sans stock ni mouvement sur la période ne sont pas listés.</div>` : ''}
        ${g.est_vente ? '' : `<div class="small muted" style="padding:0 18px 12px">${esc(nomPrix(g))} : modifiable produit par produit dans la <a href="#/base">Base</a> (colonne « ${esc(nomPrix(g))} » ; vide = prix de vente normal).</div>`}
      </section>`;
    const imprimable = `<div style="font-weight:700;margin-bottom:6px">Stock ${esc(nomCourt(g))}</div>
      <table class="ft"><thead><tr><th>Produit</th><th class="r">${esc(nomPrix(g))}</th><th class="r">Début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Pertes</th><th class="r">Reste</th><th class="r">Valeur sortie</th><th class="r">Valeur restante</th></tr></thead><tbody>
      ${ls.map((x) => `<tr><td>${esc(x.designation)}</td><td class="num r n">${fmt(x.prix)}</td><td class="num r n">${fmt(x.debut)}</td><td class="num r n">${fmt(x.entrees)}</td><td class="num r n">${fmt(x.sorties)}</td><td class="num r n">${fmt(x.pertes)}</td><td class="num r n">${fmt(x.fin)}</td><td class="num r n">${fmt(val(x, 'sorties'))}</td><td class="num r n">${fmt(val(x, 'fin'))}</td></tr>`).join('')}
      <tr><td colspan="7" style="text-align:right"><strong>TOTAL</strong></td><td class="num r n"><strong>${fmt(r.sorties)}</strong></td><td class="num r n"><strong>${fmt(r.fin)}</strong></td></tr></tbody></table>`;
    const lignesCsv = [['Stock ' + nomCourt(g)], ['Produit', nomPrix(g), 'Début', 'Entrées', 'Sorties', 'Pertes et écarts', 'Reste', 'Valeur sortie', 'Valeur restante'],
      ...ls.map((x) => [x.designation, x.prix, x.debut, x.entrees, x.sorties, x.pertes, x.fin, val(x, 'sorties'), val(x, 'fin')]), ['TOTAL', '', '', '', '', '', '', r.sorties, r.fin]];
    return { html, imprimable, csv: lignesCsv };
  }

  await dessiner();
}
