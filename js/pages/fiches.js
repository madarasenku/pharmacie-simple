// Fiches PNLP du district (Nouvelle PSP) : RAPPORT-COMMANDE MENSUEL ESPC, IDE et ASC, remplis à partir du stock,
// et les agents de santé communautaires (ASC) : remises de produits et rapport mensuel de chaque ASC.
// Les calculs sont faits par la base (fiche_pnlp) ; ici on affiche, on saisit et on imprime la fiche du papier.
import { esc, fmt, fmtDate, fmtDateHeure, q, rpc, toast, erreur, modal, imprimer, csv, telecharger, nomMois, entier, isoMois } from '../util.js';

export const estPnlp = (g) => !!g && (g.code === 'PNLP' || g.sigle === 'PNLP');

const TITRE = { ESPC: 'RAPPORT-COMMANDE MENSUEL ESPC', IDE: 'RAPPORT-COMMANDE MENSUEL IDE', ASC: 'RAPPORT-COMMANDE MENSUEL ASC' };
const dec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const signe = (n) => (!n ? '0' : n > 0 ? '+' + fmt(n) : '−' + fmt(-n));
const NIVEAU = { urgent: 'Commande urgente', bas: 'Sous le minimum', sur: 'Au-dessus du maximum' };

// Colonnes de chaque fiche, dans l'ordre du papier : [titre, lettre et formule, valeur, style, champ saisi par l'ASC]
function colonnes(fiche) {
  if (fiche === 'IDE') {
    return [
      ['Stock initial', 'A', (r) => fmt(r.a)],
      ['Quantité reçue du DS', 'B', (r) => fmt(r.b)],
      ['Quantité distribuée aux ASC', 'C', (r) => fmt(r.asc), 'gris'],
      ['Quantité dispensée', 'D', (r) => fmt(r.c)],
      ['Pertes et ajustements', 'E', (r) => signe(r.d)],
      ['Stock disponible', 'F=A+B-C-D+/-E', (r) => fmt(r.e), 'fort'],
      ['Nombre de jours de rupture', 'G', (r) => fmt(r.f)],
      ['Consom mensuelle M-2', 'H', (r) => fmt(r.m2)],
      ['Consom mensuelle M-1', 'I', (r) => fmt(r.m1)],
      ['CMM (consommation mensuelle moyenne)', 'J=(D+H+I)/3', (r) => dec(r.cmm)],
      ['MSD', 'K=F/J', (r) => dec(r.msd), 'msd']
    ];
  }
  if (fiche === 'ASC') {
    return [
      ['Stock initial', 'A', (r) => fmt(r.a), '', 'si'],
      ['Quantité reçue de l’IDE', 'B', (r) => fmt(r.b)],
      ['Quantité dispensée', 'C', (r) => fmt(r.c), '', 'c'],
      ['Pertes', 'D', (r) => fmt(r.d), '', 'd'],
      ['Stock disponible', 'E=A+B-C-D', (r) => fmt(r.e), 'fort'],
      ['Nombre de jours de rupture', 'F', (r) => fmt(r.f), '', 'f'],
      ['Consom mensuelle M-2', 'G', (r) => fmt(r.m2)],
      ['Consom mensuelle M-1', 'H', (r) => fmt(r.m1)],
      ['CMM (consommation mensuelle moyenne)', 'I=(C+G+H)/3', (r) => dec(r.cmm)],
      ['MSD', 'J=E/I', (r) => dec(r.msd), 'msd']
    ];
  }
  return [
    ['Stock initial', 'A', (r) => fmt(r.a)],
    ['Quantité reçue du DS', 'B', (r) => fmt(r.b)],
    ['Quantité distribuée aux ASC', '', (r) => fmt(r.asc), 'gris'],
    ['Quantité dispensée', 'C', (r) => fmt(r.c)],
    ['Pertes et ajustements', 'D', (r) => signe(r.d)],
    ['Stock disponible', 'E=A+B-C+/-D', (r) => fmt(r.e), 'fort'],
    ['Nombre de jours de rupture', 'F', (r) => fmt(r.f)],
    ['Consom mensuelle M-2', 'G', (r) => fmt(r.m2)],
    ['Consom mensuelle M-1', 'H', (r) => fmt(r.m1)],
    ['CMM (consommation mensuelle moyenne)', 'I=(C+G+H)/3', (r) => dec(r.cmm)],
    ['MSD', 'J=E/I', (r) => dec(r.msd), 'msd']
  ];
}
const QUANTITE = { ESPC: ['Quantités allouée par le DS', 'K=I*Max-E'], IDE: ['Quantités à allouer aux ASC', 'L=Σ QtA ASC'], ASC: ['Quantités allouée par le DS', 'K=I*Max-E'] };

// ═════════ Une fiche : ESPC, IDE ou ASC (tous les ASC, ou un seul pour saisir son rapport) ═════════
export async function renderFiche(box, ctx, { fiche, mois }) {
  const { sb } = ctx;
  const peutSaisir = ctx.peut('programmes') || ctx.peut('rapports');
  const peutBase = ctx.peut('base');
  let ascId = null;
  let modeLiens = false;

  async function dessiner() {
    const [f, agents, liens] = await Promise.all([
      rpc(sb, 'fiche_pnlp', fiche === 'ASC' ? { p_fiche: fiche, p_mois: mois + '-01', p_asc: ascId } : { p_fiche: fiche, p_mois: mois + '-01' }),
      fiche === 'ASC' ? q(sb.from('agents_asc').select('id, nom, localite, actif').order('nom')) : Promise.resolve([]),
      modeLiens ? choixProduits() : Promise.resolve(null)
    ]);
    const cols = colonnes(fiche);
    const [titreQ, formuleQ] = QUANTITE[fiche];
    const parAsc = fiche === 'ASC' && ascId !== null;
    const lignes = f.lignes;
    const sansProduit = lignes.filter((r) => r.ligne_id !== null && !r.produit_id);
    const nb = (k) => lignes.filter((r) => r.niveau === k).length;
    const ph = ctx.pharmacie || {};
    const ent = f.entete || {};

    const cellule = (r, c) => {
      const [, , val, style, champ] = c;
      const cls = 'num r' + (style ? ' col-' + style : '');
      if (!r.produit_id && r.ligne_id !== null) return `<td class="${cls} vide"></td>`;
      if (parAsc && champ && peutSaisir) {
        const v = champ === 'si' ? (r.si ?? '') : (r[champ] || '');
        const indice = champ === 'si' ? fmt(r.a) : '0';
        return `<td class="${cls}"><input class="in num" inputmode="numeric" data-${champ}="${esc(r.k)}" value="${esc(v)}" placeholder="${esc(indice)}" aria-label="${esc(c[0])} — ${esc(r.designation)}"></td>`;
      }
      const cible = style === 'fort' ? ` data-e="${esc(r.k)}"` : '';
      return `<td class="${cls}"${cible}>${val(r)}</td>`;
    };
    const quantite = (r) => {
      if (!r.produit_id || r.q === null || r.q === undefined) return '<td class="num r col-q vide"></td>';
      if (parAsc || !peutSaisir) return `<td class="num r col-q" data-kq="${esc(r.k)}"><b>${fmt(r.q)}</b></td>`;
      return `<td class="num r col-q"><input class="in num" inputmode="numeric" data-q="${esc(r.k)}" value="${r.q}" aria-label="${esc(titreQ)} — ${esc(r.designation)}">
        ${r.corrigee ? `<div class="small muted">calcul : ${fmt(r.qcalc)}</div>` : ''}</td>`;
    };
    const lien = (r) => {
      if (r.ligne_id === null) return '<div class="small muted">Autre produit du PNLP, absent du formulaire</div>';
      if (modeLiens && liens) {
        const choisi = r.produit_id ? r.produit_id + ':' + r.programme_id : '';
        return `<select class="in" data-lier="${r.ligne_id}" aria-label="Produit relié à ${esc(r.designation)}"><option value="">— Aucun produit —</option>
          ${liens.map((o) => `<option value="${o.v}" ${o.v === choisi ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
      }
      if (!r.produit_id) return '<div class="small" style="color:var(--orange)">Aucun produit relié : cases à remplir à la main</div>';
      return r.produit.toUpperCase() === r.designation.toUpperCase() && r.origine === 'PNLP' ? ''
        : `<div class="small muted">${esc(r.produit)} · ${esc(r.origine)}</div>`;
    };

    box.innerHTML = `
      <section class="card fiche-pnlp">
        <div class="card-head">
          <div><h2>${esc(TITRE[fiche])} · ${esc(nomMois(mois))}</h2>
            <div class="small muted">Niveau de stock maximum ${dec(f.niveaux.max)} · minimum ${dec(f.niveaux.min)} · point de commande urgente ${dec(f.niveaux.urgence)}
              ${fiche === 'ASC' ? ` · ${f.nombre_asc} ASC` : ''}</div></div>
          <div class="inline">
            ${f.urgent ? '<span class="badge b-out" id="fiche-urgent">URGENT</span>' : ''}
            <button class="btn btn-sm" id="fiche-csv">Exporter Excel</button>
            <button class="btn btn-sm btn-v" id="fiche-imprimer">Imprimer la fiche</button>
          </div>
        </div>
        <div class="card-pad stack">
        ${fiche === 'ASC' ? `<div class="inline" style="align-items:flex-end">
          <div><label class="lbl" for="fiche-asc">ASC</label><select class="in" id="fiche-asc">
            <option value="">Tous les ASC (fiche du mois)</option>
            ${agents.map((a) => `<option value="${a.id}" ${a.id === ascId ? 'selected' : ''}>${esc(a.nom)}${a.localite ? ' · ' + esc(a.localite) : ''}${a.actif ? '' : ' (désactivé)'}</option>`).join('')}
          </select></div>
          <span class="small muted" style="padding-bottom:10px">${parAsc ? 'Saisissez ce que cet ASC a dispensé et perdu ce mois : le reçu vient de ses remises.' : 'Choisissez un ASC pour saisir son rapport du mois.'}</span>
        </div>` : ''}
        ${f.en_cours ? '<div class="alert alert-warn small">Mois en cours : la fiche compte les mouvements jusqu’à aujourd’hui. Imprimez-la à la fin du mois.</div>' : ''}
        ${sansProduit.length ? `<div class="alert alert-warn small">${sansProduit.length} ligne(s) de la fiche ne sont reliées à aucun produit : leurs cases restent vides.
          ${peutBase ? `<div class="inline" style="margin-top:8px"><button class="btn btn-sm" id="creer-produits">Créer les ${sansProduit.length} produit(s) manquant(s) dans le PNLP</button></div>` : ''}</div>` : ''}
        ${peutBase && !parAsc ? `<label class="check small"><input type="checkbox" id="mode-liens" ${modeLiens ? 'checked' : ''}> Choisir le produit de l’application sur chaque ligne</label>` : ''}
        </div>
        <div class="table-box defile"><table class="tbl fiche">
          <thead><tr><th class="fixe">Désignation</th><th>Code</th><th>Unité</th>
            ${cols.map((c) => `<th class="r${c[3] ? ' col-' + c[3] : ''}">${esc(c[0])}${c[1] ? `<span class="lettre">${esc(c[1])}</span>` : ''}</th>`).join('')}
            <th class="r col-q">${esc(titreQ)}<span class="lettre">${esc(formuleQ)}</span></th>${parAsc ? '' : '<th>Commentaires</th>'}</tr></thead>
          <tbody>${lignes.map((r) => `<tr class="${r.niveau ? 'niv-' + r.niveau : ''}" data-ligne="${esc(r.k)}">
            <td class="fixe"><div>${esc(r.designation)}</div>${lien(r)}${r.niveau && NIVEAU[r.niveau] ? `<span class="badge ${r.niveau === 'urgent' ? 'b-out' : r.niveau === 'bas' ? 'b-low' : 'b-exp'}">${NIVEAU[r.niveau]}</span>` : ''}</td>
            <td class="num small">${esc(r.code || '')}</td><td class="small">${esc(r.unite)}</td>
            ${cols.map((c) => cellule(r, c)).join('')}${quantite(r)}
            ${parAsc ? '' : `<td>${peutSaisir && r.produit_id ? `<input class="in" data-com="${esc(r.k)}" value="${esc(r.commentaire)}" maxlength="300" aria-label="Commentaire — ${esc(r.designation)}">` : esc(r.commentaire)}</td>`}
          </tr>`).join('') || `<tr><td colspan="${cols.length + 5}">Aucune ligne.</td></tr>`}</tbody>
        </table></div>
        <div class="card-pad stack">
        <div class="small muted">MSD (mois de stock disponible) sous ${dec(f.niveaux.urgence)} : commande urgente${nb('urgent') ? ` (${nb('urgent')})` : ''} ·
          sous ${dec(f.niveaux.min)} : sous le minimum${nb('bas') ? ` (${nb('bas')})` : ''} · au-dessus de ${dec(f.niveaux.max)} : surstock${nb('sur') ? ` (${nb('sur')})` : ''}.
          ${fiche === 'ESPC' ? 'La quantité dispensée (C) comprend les remises aux ASC (colonne grise).' : ''}
          ${fiche === 'IDE' ? 'L : somme des quantités à allouer à chaque ASC (fiches ASC).' : ''}</div>
        <div class="grid-tdr">
          <div><label class="lbl" for="tdr-r">Nombre de TDR réalisés</label><input class="in num" inputmode="numeric" id="tdr-r" value="${ent.tdr_realises ?? ''}" ${peutSaisir ? '' : 'disabled'}></div>
          <div><label class="lbl" for="tdr-p">Nombre de TDR positifs</label><input class="in num" inputmode="numeric" id="tdr-p" value="${ent.tdr_positifs ?? ''}" ${peutSaisir ? '' : 'disabled'}></div>
          ${fiche === 'ASC' ? '' : `
          <div><label class="lbl" for="ge-r">Nombre de gouttes épaisses réalisées</label><input class="in num" inputmode="numeric" id="ge-r" value="${ent.ge_realisees ?? ''}" ${peutSaisir ? '' : 'disabled'}></div>
          <div><label class="lbl" for="ge-p">Nombre de gouttes épaisses positives</label><input class="in num" inputmode="numeric" id="ge-p" value="${ent.ge_positives ?? ''}" ${peutSaisir ? '' : 'disabled'}></div>`}
        </div>
        ${parAsc ? '' : `<div><label class="lbl" for="commentaire">Commentaire</label><textarea class="in" id="commentaire" rows="2" maxlength="1000" ${peutSaisir ? '' : 'disabled'}>${esc(ent.commentaire || '')}</textarea></div>`}
        ${peutSaisir ? `<div class="inline" style="justify-content:space-between;align-items:center">
          <span class="small muted">${ent.maj_le ? 'Enregistrée le ' + fmtDateHeure(ent.maj_le) + (ent.maj_par ? ' par ' + esc(ent.maj_par) : '') : 'Pas encore enregistrée ce mois.'}</span>
          <button class="btn btn-p" id="fiche-enregistrer">${parAsc ? 'Enregistrer le rapport de ' + esc(f.asc.nom) : 'Enregistrer la fiche'}</button></div>` : ''}
        </div>
      </section>`;

    const ascSel = box.querySelector('#fiche-asc');
    if (ascSel) ascSel.onchange = () => { ascId = ascSel.value ? Number(ascSel.value) : null; dessiner().catch(erreur); };
    const ml = box.querySelector('#mode-liens');
    if (ml) ml.onchange = () => { modeLiens = ml.checked; dessiner().catch(erreur); };
    box.querySelectorAll('[data-lier]').forEach((s) => s.onchange = async () => {
      const [produit, programme] = s.value ? s.value.split(':').map(Number) : [null, null];
      try {
        await rpc(sb, 'lier_ligne_fiche', { p_ligne: Number(s.dataset.lier), p_produit: produit, p_programme: programme });
        toast(produit ? 'Ligne reliée au produit.' : 'Ligne déliée.');
        await dessiner();
      } catch (e) { erreur(e); await dessiner(); }
    });
    const creer = box.querySelector('#creer-produits');
    if (creer) creer.onclick = async () => {
      creer.disabled = true;
      try {
        const n = await rpc(sb, 'creer_produits_fiche', { p_lignes: null });
        toast(n + ' produit(s) créé(s) dans le PNLP et relié(s) à la fiche.');
        await dessiner();
      } catch (e) { erreur(e); creer.disabled = false; }
    };

    // Saisie d'un ASC : le stock disponible et la quantité se recalculent pendant la frappe
    if (parAsc) {
      box.querySelectorAll('[data-si], [data-c], [data-d]').forEach((i) => i.oninput = () => {
        const k = i.dataset.si ?? i.dataset.c ?? i.dataset.d;
        const r = lignes.find((x) => x.k === k);
        const val = (champ) => entier(box.querySelector(`[data-${champ}="${k}"]`)?.value);
        const a = val('si') ?? r.a;
        const c = val('c') ?? 0;
        const e = a + r.b - c - (val('d') ?? 0);
        const td = box.querySelector(`[data-e="${k}"]`);
        if (td) { td.textContent = fmt(e); td.classList.toggle('neg', e < 0); }
        const kq = box.querySelector(`[data-kq="${k}"]`);
        if (kq) kq.innerHTML = `<b>${fmt(Math.max(0, Math.ceil((c + r.m1 + r.m2) / 3 * f.niveaux.max - e)))}</b>`;
      });
    }

    const enr = box.querySelector('#fiche-enregistrer');
    if (enr) enr.onclick = async () => {
      const v = (id) => box.querySelector(id)?.value.trim() ?? '';
      enr.disabled = true;
      try {
        if (parAsc) {
          const saisies = {};
          for (const r of lignes) {
            if (!box.querySelector(`[data-c="${r.k}"]`)) continue;
            const x = (champ) => box.querySelector(`[data-${champ}="${r.k}"]`).value.trim();
            saisies[r.k] = { si: x('si'), c: x('c'), d: x('d'), f: x('f') };
          }
          await rpc(sb, 'saisir_asc', { p: { asc_id: ascId, mois: mois + '-01', tdr_realises: v('#tdr-r'), tdr_positifs: v('#tdr-p'), lignes: saisies } });
          toast('Rapport de ' + f.asc.nom + ' enregistré.');
        } else {
          const corr = {};
          for (const r of lignes) {
            const iq = box.querySelector(`[data-q="${r.k}"]`);
            const ic = box.querySelector(`[data-com="${r.k}"]`);
            if (!iq && !ic) continue;
            const qv = iq ? entier(iq.value) : null;
            const com = ic ? ic.value.trim() : '';
            // Seule une quantité différente du calcul est gardée : le calcul suit le stock
            const qc = qv !== null && qv !== r.qcalc ? qv : null;
            if (qc !== null || com) corr[r.k] = { q: qc, com };
          }
          await rpc(sb, 'enregistrer_fiche', { p: { fiche, mois: mois + '-01', tdr_realises: v('#tdr-r'), tdr_positifs: v('#tdr-p'),
            ge_realisees: v('#ge-r'), ge_positives: v('#ge-p'), commentaire: v('#commentaire'), lignes: corr } });
          toast('Fiche ' + fiche + ' enregistrée.');
        }
        await dessiner();
      } catch (e) { erreur(e); enr.disabled = false; }
    };

    box.querySelector('#fiche-imprimer').onclick = () => imprimer(documentFiche(f, fiche, cols, ph, mois), { paysage: true });
    box.querySelector('#fiche-csv').onclick = () => {
      const l = [[TITRE[fiche] + (parAsc ? ' · ASC ' + f.asc.nom : ''), nomMois(mois)], ['Région sanitaire', ph.region || ''], ['District sanitaire', ph.district || ''], ['Établissement', ph.etablissement || ''], [],
        ['Code', 'Désignation', 'Unité', ...cols.map((c) => c[0] + (c[1] ? ' (' + c[1] + ')' : '')), titreQ + ' (' + formuleQ + ')', 'Commentaires', 'Produit de l’application']];
      lignes.forEach((r) => {
        const lie = !!r.produit_id;
        l.push([r.code || '', r.designation, r.unite,
          ...cols.map((c) => (lie ? brut(c, r) : '')), lie ? (r.q ?? '') : '', r.commentaire || '', lie ? r.produit + ' · ' + r.origine : '']);
      });
      l.push([], ['TDR réalisés', ent.tdr_realises ?? ''], ['TDR positifs', ent.tdr_positifs ?? '']);
      if (fiche !== 'ASC') l.push(['Gouttes épaisses réalisées', ent.ge_realisees ?? ''], ['Gouttes épaisses positives', ent.ge_positives ?? '']);
      if (!parAsc) l.push(['Commentaire', ent.commentaire || '']);
      telecharger('fiche-' + fiche + (parAsc ? '-asc-' + ascId : '') + '-' + mois + '.csv', csv(l));
    };
  }

  // Produits proposés pour relier une ligne : chaque produit actif, dans chacune de ses origines
  async function choixProduits() {
    const [produits, origines] = await Promise.all([
      q(sb.from('produits').select('id, designation, actif').eq('actif', true).order('designation')),
      q(sb.from('produits_programmes').select('produit_id, programme_id'))
    ]);
    const sigle = new Map(ctx.programmes.map((g) => [g.id, g.sigle]));
    const nom = new Map(produits.map((p) => [p.id, p.designation]));
    return origines.filter((o) => nom.has(o.produit_id) && sigle.has(o.programme_id))
      .map((o) => ({ v: o.produit_id + ':' + o.programme_id, t: nom.get(o.produit_id) + ' — ' + sigle.get(o.programme_id), pnlp: sigle.get(o.programme_id) === 'PNLP' }))
      .sort((x, y) => (y.pnlp - x.pnlp) || x.t.localeCompare(y.t, 'fr'));
  }

  await dessiner();
}

// Valeur d'une colonne pour Excel : nombre sans espace, signe moins simple, virgule décimale (Excel en français)
const brut = (c, r) => String(c[2](r)).replace(/\s/g, '').replace('−', '-');

// Largeur des colonnes imprimées (en %) : la fiche tient sur une page A4 paysage, quelle que soit l'imprimante
function largeurs(nbChiffres, commentaires) {
  const fixes = [4.5, 21, 6.5];
  const reste = 100 - fixes.reduce((a, b) => a + b, 0) - (commentaires ? 10 : 0);
  const chiffre = Math.floor((reste / (nbChiffres + 1)) * 100) / 100;
  return [...fixes, ...Array(nbChiffres + 1).fill(chiffre), ...(commentaires ? [10] : [])];
}

// La fiche imprimée, comme le formulaire papier (A4 paysage)
function documentFiche(f, fiche, cols, ph, mois) {
  const [titreQ, formuleQ] = QUANTITE[fiche];
  const ent = f.entete || {};
  const parAsc = !!f.asc;
  const caseVal = (v) => `<span class="fd-case">${v === null || v === undefined ? '&nbsp;' : esc(v)}</span>`;
  return `<div class="doc fiche-doc">
    <div class="fd-tete">
      <div class="fd-ident">
        <div>Région Sanitaire : <b>${esc(ph.region || '')}</b></div>
        <div>District Sanitaire : <b>${esc(ph.district || '')}</b></div>
        <div>Établissement : <b>${esc(ph.etablissement || '')}</b></div>
        ${parAsc ? `<div>ASC : <b>${esc(f.asc.nom)}${f.asc.localite ? ' · ' + esc(f.asc.localite) : ''}</b></div>` : ''}
      </div>
      <div class="fd-titre">
        <div class="t">${esc(TITRE[fiche])}</div>
        <div>${fiche === 'ASC' ? `Nombre de ASC ${caseVal(parAsc ? 1 : f.nombre_asc)} &nbsp; ` : ''}Urgent ${caseVal(f.urgent ? 'X' : '')} &nbsp; Mois de : <b>${esc(nomMois(mois))}</b></div>
        <div>Date : <b>${fmtDate(new Date().toISOString())}</b></div>
      </div>
      <div class="fd-niveaux">
        <div>Niveau de stock Maximum : ${caseVal(dec(f.niveaux.max))}</div>
        <div>Niveau de stock Minimum : ${caseVal(dec(f.niveaux.min))}</div>
        <div>Point de Commande Urgente : ${caseVal(dec(f.niveaux.urgence))}</div>
      </div>
    </div>
    <table class="ft fd">
      <colgroup>${largeurs(cols.length, !parAsc).map((l) => `<col style="width:${l}%">`).join('')}</colgroup>
      <thead><tr><th>CODE</th><th>DESIGNATION</th><th>Unité</th>${cols.map((c) => `<th class="${c[3] ? 'col-' + c[3] : ''}">${esc(c[0])}</th>`).join('')}<th>${esc(titreQ)}</th>${parAsc ? '' : '<th>Commentaires</th>'}</tr>
        <tr class="lettres"><th></th><th></th><th></th>${cols.map((c) => `<th class="${c[3] ? 'col-' + c[3] : ''}">${esc(c[1])}</th>`).join('')}<th>${esc(formuleQ)}</th>${parAsc ? '' : '<th></th>'}</tr></thead>
      <tbody>${f.lignes.map((r) => {
        const lie = !!r.produit_id;
        return `<tr><td class="n">${esc(r.code || '')}</td><td>${esc(r.designation)}</td><td style="text-align:center">${esc(r.unite)}</td>
          ${cols.map((c) => `<td class="n${c[3] ? ' col-' + c[3] : ''}${lie && c[3] === 'msd' && r.niveau === 'urgent' ? ' rup' : ''}">${lie ? c[2](r) : ''}</td>`).join('')}
          <td class="n${lie && r.niveau === 'urgent' ? ' rup' : ''}">${lie && r.q !== null && r.q !== undefined ? fmt(r.q) : ''}</td>${parAsc ? '' : `<td>${esc(r.commentaire || '')}</td>`}</tr>`;
      }).join('')}</tbody>
    </table>
    <div class="fd-pied">
      <div>Nombre de TDR réalisés ${caseVal(ent.tdr_realises)}</div>
      <div>Nombre de TDR Positifs ${caseVal(ent.tdr_positifs)}</div>
      ${fiche === 'ASC' ? '' : `<div>Nombre de Gouttes Epaisses réalisées ${caseVal(ent.ge_realisees)}</div><div>Nombre de Goutte Epaisse positive ${caseVal(ent.ge_positives)}</div>`}
    </div>
    <div class="fd-commentaire">Commentaire : ${esc(ent.commentaire || '')}</div>
    <div class="fd-signatures">
      <div>Nom, Signature, Cachet, Contacts du gestionnaire de la pharmacie du centre</div>
      <div>Nom, Signature, Cachet, Contacts du Responsable du centre</div>
    </div>
  </div>`;
}

// ═════════ Agents de santé communautaires : liste, remises du centre, remises du mois ═════════
export async function renderAsc(box, ctx, { mois }) {
  const { sb } = ctx;
  const peut = ctx.peut('programmes');
  const debut = new Date(mois + '-01T00:00:00');
  const fin = new Date(new Date(debut).setMonth(debut.getMonth() + 1));

  async function dessiner() {
    const [agents, lignes, stock, remises] = await Promise.all([
      q(sb.from('agents_asc').select('*').order('nom')),
      q(sb.from('fiches_lignes').select('id, designation, unite, produit_id, programme_id, sur_asc').eq('sur_asc', true).order('ordre')),
      q(sb.from('v_stock').select('produit_id, programme_id, quantite')),
      q(sb.from('mouvements').select('id, created_at, quantite, asc_id, produit_id, programme_id').not('asc_id', 'is', null)
        .gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('created_at', { ascending: false }).limit(300))
    ]);
    const dispo = (l) => stock.find((s) => s.produit_id === l.produit_id && s.programme_id === l.programme_id)?.quantite ?? 0;
    const reliees = lignes.filter((l) => l.produit_id);
    const nomAsc = new Map(agents.map((a) => [a.id, a.nom]));
    const nomLigne = (m) => lignes.find((l) => l.produit_id === m.produit_id && l.programme_id === m.programme_id)?.designation || 'Produit n° ' + m.produit_id;
    const remisMois = (id) => remises.filter((m) => m.asc_id === id).reduce((s, m) => s - m.quantite, 0);
    const actifs = agents.filter((a) => a.actif);
    const enCours = mois === isoMois();

    box.innerHTML = `
      <div class="row">
        <section class="card" style="flex:1 1 420px">
          <div class="card-head"><h2>Agents de santé communautaires</h2>${peut ? '<button class="btn btn-sm btn-p" id="asc-ajouter">Ajouter un ASC</button>' : ''}</div>
          <div class="table-box"><table class="tbl"><thead><tr><th>Nom</th><th>Localité</th><th>Téléphone</th><th class="r">Reçu en ${esc(nomMois(mois).toLowerCase())}</th>${peut ? '<th></th>' : ''}</tr></thead>
            <tbody>${agents.map((a) => `<tr class="${a.actif ? '' : 'off'}"><td>${esc(a.nom)}${a.actif ? '' : ' <span class="badge b-neutre">désactivé</span>'}</td><td>${esc(a.localite || '')}</td>
              <td class="num">${esc(a.telephone || '')}</td><td class="num r">${fmt(remisMois(a.id))}</td>
              ${peut ? `<td class="keep"><button class="btn btn-sm" data-asc="${a.id}">Modifier</button></td>` : ''}</tr>`).join('')
              || `<tr><td colspan="5" class="muted">Aucun ASC. Ajoutez les agents de santé communautaires que le centre approvisionne.</td></tr>`}</tbody></table></div>
        </section>
        <section class="card" style="flex:1 1 520px">
          <div class="card-head"><h2>Remettre aux ASC</h2></div>
          ${!enCours ? '<div class="card-pad"><div class="alert alert-warn small">Une remise se fait aujourd’hui : revenez au mois en cours pour remettre des produits.</div></div>' : ''}
          ${enCours && peut ? `
          <div class="card-pad"><label class="lbl" for="remise-asc">ASC qui reçoit</label><select class="in" id="remise-asc"><option value="">— Choisir —</option>
            ${actifs.map((a) => `<option value="${a.id}">${esc(a.nom)}${a.localite ? ' · ' + esc(a.localite) : ''}</option>`).join('')}</select></div>
          <div class="table-box"><table class="tbl"><thead><tr><th>Produit (fiche ASC)</th><th class="r">En stock</th><th class="r">À remettre</th></tr></thead>
            <tbody>${reliees.map((l) => `<tr><td>${esc(l.designation)}<div class="small muted">${esc(l.unite)}</div></td><td class="num r">${fmt(dispo(l))}</td>
              <td class="r"><input class="in num" style="max-width:110px" inputmode="numeric" data-rq="${l.id}" ${dispo(l) > 0 ? '' : 'disabled'} aria-label="Quantité à remettre — ${esc(l.designation)}"></td></tr>`).join('')
              || '<tr><td colspan="3" class="muted">Aucune ligne de la fiche ASC n’est reliée à un produit.</td></tr>'}</tbody></table></div>
          <div class="card-pad"><button class="btn btn-p" id="remise-valider">Remettre à l’ASC</button></div>` : ''}
          ${enCours && !peut ? '<p class="card-pad muted">Vous n’avez pas le droit de distribuer.</p>' : ''}
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2>Remises de ${esc(nomMois(mois).toLowerCase())}</h2><span class="small muted">${remises.length} sortie(s) de stock</span></div>
        <div class="table-box"><table class="tbl"><thead><tr><th>Date</th><th>ASC</th><th>Produit</th><th class="r">Quantité</th></tr></thead>
          <tbody>${remises.map((m) => `<tr><td class="num small">${fmtDateHeure(m.created_at)}</td><td>${esc(nomAsc.get(m.asc_id) || '?')}</td><td>${esc(nomLigne(m))}</td><td class="num r">${fmt(-m.quantite)}</td></tr>`).join('')
            || '<tr><td colspan="4" class="muted">Aucune remise ce mois.</td></tr>'}</tbody></table></div>
      </section>`;

    const aj = box.querySelector('#asc-ajouter');
    if (aj) aj.onclick = () => ficheAsc(null);
    box.querySelectorAll('[data-asc]').forEach((b) => b.onclick = () => ficheAsc(agents.find((a) => a.id === Number(b.dataset.asc))));
    const val = box.querySelector('#remise-valider');
    if (val) val.onclick = async () => {
      const asc = Number(box.querySelector('#remise-asc').value);
      if (!asc) return toast('Choisissez l’ASC qui reçoit.', 'warn');
      const l = [];
      for (const i of box.querySelectorAll('[data-rq]')) {
        const n = entier(i.value);
        if (!i.value.trim()) continue;
        const ligne = reliees.find((x) => x.id === Number(i.dataset.rq));
        if (n === null || n <= 0) return toast('Quantité invalide pour ' + ligne.designation + '.', 'warn');
        if (n > dispo(ligne)) return toast('Stock insuffisant pour ' + ligne.designation + ' : ' + fmt(dispo(ligne)) + ' en stock.', 'warn');
        l.push({ produit_id: ligne.produit_id, programme_id: ligne.programme_id, quantite: n });
      }
      if (!l.length) return toast('Indiquez au moins une quantité.', 'warn');
      val.disabled = true;
      try {
        const r = await rpc(sb, 'remettre_asc', { p: { asc_id: asc, lignes: l } });
        toast('Remis à ' + nomAsc.get(asc) + ' : ' + fmt(r.unites) + ' unité(s).');
        await dessiner();
      } catch (e) { erreur(e); val.disabled = false; }
    };
  }

  function ficheAsc(a) {
    const m = modal(a ? 'Modifier l’ASC' : 'Nouvel ASC', `
      <div><label class="lbl" for="asc-nom">Nom et prénoms</label><input class="in" id="asc-nom" value="${esc(a?.nom || '')}" autocomplete="off"></div>
      <div class="grid-2">
        <div><label class="lbl" for="asc-loc">Localité (village, quartier)</label><input class="in" id="asc-loc" value="${esc(a?.localite || '')}"></div>
        <div><label class="lbl" for="asc-tel">Téléphone</label><input class="in num" id="asc-tel" inputmode="tel" value="${esc(a?.telephone || '')}"></div>
      </div>
      ${a ? `<label class="check"><input type="checkbox" id="asc-actif" ${a.actif ? 'checked' : ''}> ASC actif (décochez s’il ne travaille plus : son historique est gardé)</label>` : ''}
      <button class="btn btn-p" id="asc-ok">Enregistrer</button>`);
    m.el.querySelector('#asc-ok').onclick = async () => {
      const nom = m.el.querySelector('#asc-nom').value.trim();
      if (!nom) return toast('Le nom de l’ASC est obligatoire.', 'warn');
      try {
        await rpc(sb, 'enregistrer_asc', { p: { id: a?.id ?? null, nom, localite: m.el.querySelector('#asc-loc').value, telephone: m.el.querySelector('#asc-tel').value,
          actif: a ? m.el.querySelector('#asc-actif').checked : true } });
        m.fermer();
        toast('ASC enregistré.');
        await dessiner();
      } catch (e) { erreur(e); }
    };
  }

  await dessiner();
}
