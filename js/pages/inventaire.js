// Inventaire : on compte ce qui est réellement sur les étagères, origine par origine.
// - lot connu : la quantité comptée remplace la quantité du système (l'écart devient une correction) ;
// - produit trouvé sans stock enregistré : il devient le stock de départ (une entrée, pour que le rapport reste juste).
// Le comptage est gardé sur l'appareil (brouillon) : on peut s'interrompre et reprendre plus tard.
import { esc, fmt, fmtF, fmtPeremption, fmtDate, tout, rpc, erreur, toast, modal, confirmer, imprimer, chargerCatalogue, correspond, entier, local, joursAvant } from '../util.js';

const cleBrouillon = (origine) => 'inventaire_' + origine;
const brouillonVide = () => ({ debut: new Date().toISOString(), comptes: {}, nouveaux: [] });

export async function render(el, ctx) {
  const { sb } = ctx;
  const origines = ctx.programmes.filter((p) => p.actif);
  if (!origines.length) {
    el.innerHTML = '<div class="alert alert-warn">Aucune origine active : créez-en une dans la Base.</div>';
    return;
  }
  let origine = (ctx.vente && ctx.vente.actif ? ctx.vente : origines[0]).id;
  let catalogue = [];
  let lots = [];
  let brouillon = brouillonVide();
  let recherche = '';
  let filtre = 'tout';
  let aVerifier = new Set(); // lots dont le stock a bougé pendant le comptage
  let aveugle = false;

  const nomOrigine = (id) => { const o = origines.find((x) => x.id === id); return o ? (o.est_vente ? 'Vente' : o.sigle) : '?'; };
  const enregistrer = () => {
    if (!local.ecrire(cleBrouillon(origine), brouillon)) toast('Le brouillon ne peut pas être gardé sur cet appareil (stockage indisponible).', 'warn');
  };

  async function charger() {
    [catalogue, lots] = await Promise.all([
      chargerCatalogue(sb),
      tout(() => sb.from('lots').select('id, produit_id, numero, peremption, quantite')
        .eq('programme_id', origine).gt('quantite', 0).order('produit_id').order('peremption', { nullsFirst: false }).order('id'))
    ]);
    brouillon = local.lire(cleBrouillon(origine)) || brouillonVide();
    // Un lot vidé depuis (vendu en entier) n'est plus à compter
    const ids = new Set(lots.map((l) => String(l.id)));
    for (const id of Object.keys(brouillon.comptes)) if (!ids.has(id)) delete brouillon.comptes[id];
  }

  // Lignes de la feuille : lots connus + produits de l'origine sans stock
  function lignesProduits() {
    const parProduit = new Map();
    for (const l of lots) {
      if (!parProduit.has(l.produit_id)) parProduit.set(l.produit_id, []);
      parProduit.get(l.produit_id).push(l);
    }
    return catalogue
      .filter((p) => p.actif && (p.origines[origine] || parProduit.has(p.id) || brouillon.nouveaux.some((n) => n.produit_id === p.id)))
      .map((p) => ({ p, lots: parProduit.get(p.id) || [], nouveaux: brouillon.nouveaux.filter((n) => n.produit_id === p.id) }));
  }

  function bilan() {
    const lignes = lignesProduits();
    const nbLots = lots.length;
    const comptes = Object.entries(brouillon.comptes);
    const ecarts = comptes.map(([id, c]) => {
      const lot = lots.find((l) => l.id === Number(id));
      const p = catalogue.find((x) => x.id === lot?.produit_id);
      return { lot, p, attendu: c.attendu, reel: c.reel, ecart: c.reel - c.attendu };
    }).filter((x) => x.lot && x.ecart !== 0);
    const nouveaux = brouillon.nouveaux.filter((n) => n.quantite > 0);
    const valeur = (x) => x.ecart * Number(x.p?.prix_achat || 0);
    return {
      lignes, nbLots, nbComptes: comptes.length, ecarts, nouveaux,
      manque: ecarts.filter((x) => x.ecart < 0).reduce((s, x) => s - valeur(x), 0),
      surplus: ecarts.filter((x) => x.ecart > 0).reduce((s, x) => s + valeur(x), 0),
      valeurDepart: nouveaux.reduce((s, n) => s + n.quantite * Number(catalogue.find((p) => p.id === n.produit_id)?.prix_achat || 0), 0)
    };
  }

  function ligneLot(p, l) {
    const c = brouillon.comptes[l.id];
    const ecart = c ? c.reel - c.attendu : null;
    const perime = l.peremption && joursAvant(l.peremption) < 0;
    return `<tr class="${aVerifier.has(l.id) ? 'sel' : ''}">
      <td>${esc(p.designation)}${aVerifier.has(l.id) ? '<br><span class="badge b-low">Le stock a changé pendant le comptage : recomptez</span>' : ''}</td>
      <td class="num small">${esc(l.numero || '—')}</td>
      <td class="num small">${fmtPeremption(l.peremption)}${perime ? ' <span class="badge b-out" title="S’il a été jeté, comptez 0">Périmé</span>' : ''}</td>
      <td class="num r">${aveugle ? '<span class="muted">—</span>' : fmt(l.quantite)}</td>
      <td><label class="sr" for="c-${l.id}">Quantité comptée</label>
        <input class="in num" id="c-${l.id}" data-compte="${l.id}" inputmode="numeric" style="width:96px" value="${c ? c.reel : ''}" placeholder="compté"></td>
      <td class="num r" data-ecart="${l.id}" style="font-weight:700;color:${ecart > 0 ? '#1A6438' : ecart < 0 ? 'var(--rouge)' : 'inherit'}">${ecart === null || aveugle ? '' : (ecart > 0 ? '+' : '') + fmt(ecart)}</td>
      <td></td></tr>`;
  }

  function ligneNouveau(p, n) {
    return `<tr style="background:#F7F3FD">
      <td>${esc(p.designation)}<br><span class="small" style="color:var(--violet)">Stock de départ / lot non enregistré</span></td>
      <td><label class="sr" for="nn-${n.cle}">Numéro de lot</label><input class="in" id="nn-${n.cle}" data-nv="${n.cle}" data-champ="numero" value="${esc(n.numero)}" placeholder="lot" style="width:110px"></td>
      <td><label class="sr" for="np-${n.cle}">Péremption</label><input class="in" type="date" id="np-${n.cle}" data-nv="${n.cle}" data-champ="peremption" value="${esc(n.peremption)}" style="width:150px"></td>
      <td class="num r muted">0</td>
      <td><label class="sr" for="nq-${n.cle}">Quantité comptée</label><input class="in num" id="nq-${n.cle}" data-nv="${n.cle}" data-champ="quantite" inputmode="numeric" value="${n.quantite || ''}" placeholder="compté" style="width:96px"></td>
      <td class="num r" style="font-weight:700;color:#1A6438">${n.quantite ? '+' + fmt(n.quantite) : ''}</td>
      <td><button class="btn btn-sm btn-danger" data-retirer-nv="${n.cle}" aria-label="Retirer cette ligne">Retirer</button></td></tr>`;
  }

  function htmlBilan(b) {
    return `
          <div class="card card-pad stack" style="position:sticky;top:12px">
            <h2>Bilan — ${esc(nomOrigine(origine))}</h2>
            <div><div class="small muted">Lots comptés</div><div class="num" style="font-size:22px;font-weight:700">${b.nbComptes} / ${b.nbLots} <span class="small muted">(${b.nbLots ? Math.round((b.nbComptes / b.nbLots) * 100) : 100} %)</span></div></div>
            <dl class="grid-2" style="margin:0;grid-template-columns:1fr auto">
              <dt class="muted">Lignes avec écart</dt><dd class="num r" style="margin:0">${b.ecarts.length}</dd>
              <dt class="muted">Manquants (valeur d’achat)</dt><dd class="num r" style="margin:0;color:var(--rouge)">${fmtF(b.manque)}</dd>
              <dt class="muted">Surplus (valeur d’achat)</dt><dd class="num r" style="margin:0;color:#1A6438">${fmtF(b.surplus)}</dd>
              <dt class="muted">Stock de départ ajouté</dt><dd class="num r" style="margin:0">${b.nouveaux.length} lot(s) · ${fmtF(b.valeurDepart)}</dd>
            </dl>
            <div><label class="lbl" for="reference">Référence</label><input class="in" id="reference" value="${esc(brouillon.reference || 'Inventaire du ' + new Date().toLocaleDateString('fr-FR'))}"></div>
            <button class="btn btn-p btn-big" id="valider" ${b.nbComptes || b.nouveaux.length ? '' : 'disabled'}>Valider l’inventaire</button>
            <div class="small muted">Rien n’est modifié avant la validation. Chaque écart est noté dans l’historique du produit et dans le journal.</div>
          </div>`;
  }

  function dessiner() {
    const b = bilan();
    const visibles = b.lignes.filter(({ p, lots: ls, nouveaux }) => {
      if (!correspond(p, recherche)) return false;
      if (filtre === 'restants') return ls.some((l) => !brouillon.comptes[l.id]) || (!ls.length && !nouveaux.length);
      if (filtre === 'ecarts') return ls.some((l) => { const c = brouillon.comptes[l.id]; return c && c.reel !== c.attendu; }) || nouveaux.some((n) => n.quantite > 0);
      if (filtre === 'sans') return !ls.length;
      return true;
    });

    el.innerHTML = `
      <div class="page-head"><div><h1>Inventaire</h1>
        <div class="small muted">Comptez ce qui est réellement sur les étagères. Les écarts deviennent des corrections ; un produit trouvé sans stock enregistré devient votre stock de départ. Les lots que vous ne comptez pas ne sont pas modifiés.</div></div>
        <div class="inline"><button class="btn" id="feuille">Imprimer la feuille de comptage</button></div></div>
      <div class="origines" role="group" aria-label="Origine à compter">
        ${origines.map((o) => `<button class="org ${o.id === origine ? (o.est_vente ? 'on' : 'on-v') : ''}" data-origine="${o.id}"><strong>${esc(o.est_vente ? 'Vente' : o.sigle)}</strong><span class="small">${esc(o.est_vente ? 'stock payant' : o.nom)}</span></button>`).join('')}
      </div>
      ${Object.keys(brouillon.comptes).length || brouillon.nouveaux.length ? `<div class="alert alert-ok">Comptage en cours depuis le ${fmtDate(brouillon.debut)} — il est gardé sur cet appareil jusqu’à la validation.
        <button class="link" id="recommencer">Tout effacer et recommencer</button></div>` : ''}
      <div class="alert alert-warn">Conseil : comptez quand il n’y a pas de vente en cours. Si une vente passe pendant le comptage, l’application le détecte et vous demande de recompter la ligne concernée.</div>
      <div class="row">
        <section class="col-main">
          <div class="inline">
            <div style="flex:1 1 260px"><label class="sr" for="rech">Chercher</label><input class="in" id="rech" type="search" placeholder="Chercher un produit ou un code-barres" value="${esc(recherche)}"></div>
            ${[['tout', 'Tout'], ['restants', 'Pas encore comptés'], ['ecarts', 'Avec écart'], ['sans', 'Sans stock enregistré']]
              .map(([k, l]) => `<button class="chip ${filtre === k ? 'on' : ''}" data-filtre="${k}">${l}</button>`).join('')}
            <label class="check"><input type="checkbox" id="aveugle" ${aveugle ? 'checked' : ''}> Comptage à l’aveugle (cacher le stock du système)</label>
          </div>
          <div class="card"><div class="table-box"><table class="tbl">
            <thead><tr><th>Produit</th><th>Lot</th><th>Péremption</th><th class="r">Système</th><th>Compté</th><th class="r">Écart</th><th></th></tr></thead>
            <tbody>${visibles.map(({ p, lots: ls, nouveaux }) => `
              ${ls.map((l) => ligneLot(p, l)).join('')}
              ${nouveaux.map((n) => ligneNouveau(p, n)).join('')}
              ${!ls.length && !nouveaux.length ? `<tr><td>${esc(p.designation)}</td><td colspan="2" class="small muted">Aucun stock enregistré</td><td class="num r muted">0</td>
                <td colspan="3"><button class="btn btn-sm" data-ajout="${p.id}">J’en ai trouvé : saisir</button></td></tr>`
                : `<tr><td colspan="7" style="padding:4px 12px 10px"><button class="link small" data-ajout="${p.id}">+ autre lot de ${esc(p.designation)}</button></td></tr>`}`).join('')
              || '<tr><td colspan="7" class="muted">Aucun produit.</td></tr>'}</tbody>
          </table></div></div>
          <div><button class="btn" id="ajout-produit">+ Ajouter un produit qui n’est pas dans la liste</button></div>
        </section>
        <section class="col-side">${htmlBilan(b)}        </section>
      </div>`;

    brancher();
  }

  function majEcart(id) {
    const c = brouillon.comptes[id];
    const z = el.querySelector(`[data-ecart="${id}"]`);
    if (!z) return;
    const e = c ? c.reel - c.attendu : null;
    z.textContent = e === null || aveugle ? '' : (e > 0 ? '+' : '') + fmt(e);
    z.style.color = e > 0 ? '#1A6438' : e < 0 ? 'var(--rouge)' : 'inherit';
  }

  function brancher() {
    el.querySelectorAll('[data-origine]').forEach((x) => x.onclick = async () => {
      origine = Number(x.dataset.origine);
      aVerifier = new Set();
      try { await charger(); dessiner(); } catch (e) { erreur(e); }
    });
    el.querySelectorAll('[data-filtre]').forEach((x) => x.onclick = () => { filtre = x.dataset.filtre; dessiner(); });
    const r = el.querySelector('#rech');
    r.oninput = () => {
      recherche = r.value;
      const pos = r.selectionStart;
      dessiner();
      const n = el.querySelector('#rech');
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    el.querySelector('#aveugle').onchange = (e) => { aveugle = e.target.checked; dessiner(); };
    brancherBilan();

    // Saisie d'un comptage : enregistré tout de suite, sans redessiner (on garde le curseur)
    el.querySelectorAll('[data-compte]').forEach((i) => {
      i.onchange = () => {
        const id = Number(i.dataset.compte);
        const lot = lots.find((l) => l.id === id);
        const v = entier(i.value);
        if (i.value.trim() === '') delete brouillon.comptes[id];
        else if (v === null || v < 0) { toast('Quantité comptée invalide.', 'warn'); i.value = brouillon.comptes[id]?.reel ?? ''; return; }
        else brouillon.comptes[id] = { reel: v, attendu: brouillon.comptes[id]?.attendu ?? lot.quantite };
        aVerifier.delete(id);
        enregistrer();
        majEcart(id);
        majBilan();
      };
      // Entrée : passer à la ligne suivante, comme sur une feuille
      i.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        i.onchange();
        const champs = [...el.querySelectorAll('[data-compte], [data-nv][data-champ="quantite"]')];
        const suivant = champs[champs.indexOf(i) + 1];
        if (suivant) suivant.focus();
      };
    });

    el.querySelectorAll('[data-nv]').forEach((i) => i.onchange = () => {
      const n = brouillon.nouveaux.find((x) => x.cle === i.dataset.nv);
      if (!n) return;
      if (i.dataset.champ === 'quantite') {
        const v = entier(i.value);
        if (i.value.trim() !== '' && (v === null || v < 0)) { toast('Quantité invalide.', 'warn'); i.value = n.quantite || ''; return; }
        n.quantite = v || 0;
      } else n[i.dataset.champ] = i.value.trim();
      enregistrer();
      majBilan();
    });
    el.querySelectorAll('[data-retirer-nv]').forEach((x) => x.onclick = () => {
      brouillon.nouveaux = brouillon.nouveaux.filter((n) => n.cle !== x.dataset.retirerNv);
      enregistrer();
      dessiner();
    });
    el.querySelectorAll('[data-ajout]').forEach((x) => x.onclick = () => ajouterNouveau(Number(x.dataset.ajout)));
    el.querySelector('#ajout-produit').onclick = choisirProduit;

    const rec = el.querySelector('#recommencer');
    if (rec) rec.onclick = async () => {
      if (!(await confirmer('Effacer le comptage en cours ?', 'Toutes les quantités saisies pour cette origine seront perdues.', 'Tout effacer'))) return;
      brouillon = brouillonVide();
      local.effacer(cleBrouillon(origine));
      aVerifier = new Set();
      dessiner();
    };
    el.querySelector('#feuille').onclick = imprimerFeuille;
  }

  function brancherBilan() {
    el.querySelector('#reference').oninput = (e) => { brouillon.reference = e.target.value; enregistrer(); };
    el.querySelector('#valider').onclick = () => valider().catch(erreur);
  }

  // Le bilan se met à jour sans redessiner la feuille (sinon on perdrait la saisie en cours)
  function majBilan() {
    const zone = el.querySelector('.col-side');
    if (!zone) return;
    zone.innerHTML = htmlBilan(bilan());
    brancherBilan();
  }

  function ajouterNouveau(produitId) {
    const n = { cle: Math.random().toString(36).slice(2, 10), produit_id: produitId, numero: '', peremption: '', quantite: 0 };
    brouillon.nouveaux.push(n);
    enregistrer();
    if (filtre === 'restants' || filtre === 'sans') filtre = 'tout';
    dessiner();
    const champ = el.querySelector('#nq-' + n.cle);
    if (champ) champ.focus();
  }

  function choisirProduit() {
    const m = modal('Ajouter un produit à l’inventaire', `
      <div class="small muted">Pour un produit trouvé sur l’étagère mais qui n’est pas encore rattaché à ${esc(nomOrigine(origine))}. Il y sera rattaché à la validation.</div>
      <div><label class="lbl" for="rp">Produit</label><input class="in" id="rp" type="search" placeholder="Nom ou code-barres" autocomplete="off"></div>
      <div class="stack" id="res" style="max-height:320px;overflow:auto"></div>
      <div class="small muted">Produit absent de la liste ? Créez-le d’abord dans la Base ou à l’Entrée.</div>`);
    const rp = m.el.querySelector('#rp');
    const res = m.el.querySelector('#res');
    const presents = new Set(lignesProduits().map((x) => x.p.id));
    const montrer = () => {
      const t = rp.value.trim();
      const liste = t ? catalogue.filter((p) => p.actif && !presents.has(p.id) && correspond(p, t)).slice(0, 30) : [];
      res.innerHTML = liste.map((p) => `<button class="btn" style="justify-content:flex-start" data-p="${p.id}">${esc(p.designation)}</button>`).join('')
        || (t ? '<div class="muted">Aucun produit trouvé (ou déjà dans la liste).</div>' : '');
      res.querySelectorAll('[data-p]').forEach((x) => x.onclick = () => { m.fermer(); ajouterNouveau(Number(x.dataset.p)); });
    };
    rp.oninput = montrer;
    rp.focus();
  }

  function imprimerFeuille() {
    const ph = ctx.pharmacie;
    const lignes = lignesProduits();
    const html = `<div class="doc">
      <div style="display:flex;justify-content:space-between;gap:16px;font-size:12px">
        <div><strong>${esc(ph.etablissement || ph.nom || 'Pharmacie')}</strong><br>${esc(ph.district ? 'District sanitaire de ' + ph.district : '')}</div>
        <div style="text-align:center;flex:1;font-size:16px;font-weight:700">FEUILLE DE COMPTAGE — ${esc(nomOrigine(origine).toUpperCase())}</div>
        <div style="text-align:right">Date : ____ / ____ / ________<br>Compté par : ____________________</div>
      </div>
      <table class="ft" style="margin-top:12px">
        <thead><tr><th style="width:38%">Produit</th><th>Lot</th><th>Péremption</th>${aveugle ? '' : '<th>Stock système</th>'}<th style="width:14%">Compté</th><th style="width:18%">Observation</th></tr></thead>
        <tbody>${lignes.map(({ p, lots: ls }) => (ls.length ? ls : [null]).map((l) => `<tr>
          <td>${esc(p.designation)}</td><td>${esc(l?.numero || '')}</td><td>${l ? fmtPeremption(l.peremption) : ''}</td>
          ${aveugle ? '' : `<td class="n">${l ? fmt(l.quantite) : '0'}</td>`}<td></td><td></td></tr>`).join('')).join('')}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:24px;font-size:12px"><div>Signature de la personne qui a compté</div><div>Visa du gérant</div></div>
    </div>`;
    imprimer(html);
  }

  async function valider() {
    const b = bilan();
    const sansPeremption = b.nouveaux.filter((n) => !n.peremption).length;
    const details = b.ecarts.slice(0, 12).map((x) => `<li>${esc(x.p?.designation)} ${x.lot.numero ? '(lot ' + esc(x.lot.numero) + ')' : ''} : ${fmt(x.attendu)} → <strong>${fmt(x.reel)}</strong></li>`).join('');
    const m = modal('Valider l’inventaire', `
      <p style="margin:0">${b.nbComptes} lot(s) compté(s) sur ${b.nbLots}, dont <strong>${b.ecarts.length}</strong> avec un écart. ${b.nouveaux.length} lot(s) ajouté(s) en stock de départ.</p>
      ${details ? `<ul class="small" style="margin:0;padding-left:18px">${details}${b.ecarts.length > 12 ? `<li>… et ${b.ecarts.length - 12} autre(s)</li>` : ''}</ul>` : ''}
      ${sansPeremption ? `<div class="alert alert-warn">${sansPeremption} lot(s) ajouté(s) sans date de péremption : ils seront vendus après ceux qui en ont une.</div>` : ''}
      <div class="small muted">Les lots non comptés ne changent pas. Cette opération est notée dans le journal.</div>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Revenir au comptage</button><button class="btn btn-p" id="ok">Valider</button></div>`);
    m.el.querySelector('#ok').onclick = async (e) => {
      e.target.disabled = true;
      const reference = el.querySelector('#reference')?.value || '';
      try {
        const r = await rpc(sb, 'valider_inventaire', { p: {
          reference,
          comptes: Object.entries(brouillon.comptes).map(([id, c]) => ({ lot_id: Number(id), reel: c.reel, attendu: c.attendu })),
          nouveaux: b.nouveaux.map((n) => ({ produit_id: n.produit_id, programme_id: origine, quantite: n.quantite, numero: n.numero, peremption: n.peremption || null }))
        } });
        m.fermer();
        const pv = procesVerbal(b, reference);
        local.effacer(cleBrouillon(origine));
        brouillon = brouillonVide();
        aVerifier = new Set();
        await charger();
        dessiner();
        const f = modal('Inventaire enregistré', `
          <div class="alert alert-ok">${r.corrections} correction(s) et ${r.lots_ajoutes} lot(s) de départ enregistrés.</div>
          <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Fermer</button><button class="btn btn-p" id="pv">Imprimer le procès-verbal</button></div>`);
        f.el.querySelector('#pv').onclick = () => imprimer(pv);
      } catch (err) {
        e.target.disabled = false;
        if (/a bougé/.test(err.message || '')) {
          m.fermer();
          await signalerMouvements();
        }
        erreur(err);
      }
    };
  }

  // Une vente ou une entrée est passée pendant le comptage : on recharge les lots et on signale les lignes à recompter
  async function signalerMouvements() {
    await charger();
    aVerifier = new Set();
    for (const [id, c] of Object.entries(brouillon.comptes)) {
      const lot = lots.find((l) => l.id === Number(id));
      if (!lot) continue;
      if (lot.quantite !== c.attendu) {
        aVerifier.add(lot.id);
        c.attendu = lot.quantite;
      }
    }
    enregistrer();
    filtre = 'tout';
    dessiner();
  }

  function procesVerbal(b, reference) {
    const ph = ctx.pharmacie;
    return `<div class="doc">
      <div style="text-align:center;font-size:16px;font-weight:700">PROCÈS-VERBAL D’INVENTAIRE — ${esc(nomOrigine(origine).toUpperCase())}</div>
      <div style="font-size:12px;margin-top:6px">${esc(ph.etablissement || ph.nom || '')} · ${esc(reference)} · validé le ${new Date().toLocaleDateString('fr-FR')} par ${esc(ctx.profil.nom)}</div>
      <table class="ft" style="margin-top:12px">
        <thead><tr><th>Produit</th><th>Lot</th><th>Système</th><th>Compté</th><th>Écart</th><th>Valeur de l’écart (achat)</th></tr></thead>
        <tbody>${b.ecarts.map((x) => `<tr><td>${esc(x.p?.designation)}</td><td>${esc(x.lot.numero || '')}</td><td class="n">${fmt(x.attendu)}</td><td class="n">${fmt(x.reel)}</td>
          <td class="n">${x.ecart > 0 ? '+' : ''}${fmt(x.ecart)}</td><td class="n">${fmt(x.ecart * Number(x.p?.prix_achat || 0))}</td></tr>`).join('')
          || '<tr><td colspan="6">Aucun écart.</td></tr>'}</tbody>
      </table>
      ${b.nouveaux.length ? `<div style="font-weight:700;margin-top:14px">Stock de départ ajouté</div>
      <table class="ft" style="margin-top:6px"><thead><tr><th>Produit</th><th>Lot</th><th>Péremption</th><th>Quantité</th></tr></thead>
        <tbody>${b.nouveaux.map((n) => `<tr><td>${esc(catalogue.find((p) => p.id === n.produit_id)?.designation)}</td><td>${esc(n.numero)}</td><td>${fmtPeremption(n.peremption)}</td><td class="n">${fmt(n.quantite)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div style="margin-top:10px;font-size:12px">Manquants : ${fmtF(b.manque)} · Surplus : ${fmtF(b.surplus)} · Stock de départ : ${fmtF(b.valeurDepart)}</div>
      <div style="display:flex;justify-content:space-between;margin-top:26px;font-size:12px"><div>Signature de la personne qui a compté</div><div>Visa du gérant</div></div>
    </div>`;
  }

  await charger();
  dessiner();
}

