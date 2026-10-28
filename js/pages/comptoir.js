// Comptoir : vendre (stock Vente) ou distribuer gratuitement (stock d'un programme).
import {
  esc, fmt, fmtF, fmtPeremption, q, rpc, erreur, toast, modal, imprimer, chargerCatalogue,
  correspond, trancheAge, TRANCHES, entier, fmtDateHeure
} from '../util.js';

const etatVide = () => ({
  panier: new Map(),
  patient: { nom: '', age: '', unite: 'ans', tranche: '', sexe: 'NP', enceinte: false },
  mode: 'especes', client: '', recu: '', categorie: '', ignorerSuggestion: false
});

let etat = null;

export async function render(el, ctx) {
  const { sb } = ctx;
  const origines = ctx.programmes.filter((p) => p.actif && (p.est_vente ? ctx.peut('vendre') : ctx.peut('programmes')));
  if (!origines.length) {
    el.innerHTML = '<div class="alert alert-warn">Aucune origine disponible pour votre compte.</div>';
    return;
  }
  if (!etat || !origines.some((o) => o.id === etat.origine)) {
    etat = { ...etatVide(), origine: origines[0].id, recherche: '' };
  }

  let catalogue = [];
  let caisse = null;
  let clients = [];

  async function charger() {
    [catalogue, caisse, clients] = await Promise.all([
      chargerCatalogue(sb),
      q(sb.from('caisses').select('id').is('fermee_le', null).maybeSingle()),
      ctx.peut('credit') ? q(sb.from('v_dettes').select('*').order('nom')) : Promise.resolve([])
    ]);
  }

  const prog = () => ctx.programmes.find((p) => p.id === etat.origine);
  const prodPar = (id) => catalogue.find((p) => p.id === id);
  const stockDe = (p, origine = etat.origine) => p.origines[origine]?.quantite ?? 0;
  const gratuite = ctx.programmes.find((p) => p.code === 'GRAT' && p.actif);

  function changerOrigine(id, garder = null) {
    etat.origine = id;
    etat.panier = new Map(garder || []);
    etat.ignorerSuggestion = false;
    dessiner();
  }

  function ajouter(p, n = 1) {
    const actuel = etat.panier.get(p.id) || 0;
    if (actuel + n > stockDe(p)) return toast('Stock insuffisant pour ' + p.designation + '.', 'warn');
    etat.panier.set(p.id, actuel + n);
    dessiner();
  }

  // Scan ou Entrée dans la recherche
  function scanner(texte) {
    const t = texte.trim();
    if (!t) return;
    let p = catalogue.find((x) => x.code_barres && x.code_barres === t);
    if (!p) {
      const res = catalogue.filter((x) => x.actif && x.origines[etat.origine] && correspond(x, t));
      if (res.length === 1) p = res[0];
      else return;
    }
    const dispo = origines.filter((o) => p.origines[o.id] && stockDe(p, o.id) > 0);
    etat.recherche = '';
    if (!dispo.length) return toast(p.designation + ' : aucun stock disponible.', 'warn');
    if (dispo.length === 1) {
      const o = dispo[0];
      if (o.id !== etat.origine) changerOrigine(o.id);
      return ajouter(p);
    }
    const m = modal(p.designation, `
      <p class="muted" style="margin:0">Ce produit existe dans plusieurs stocks. De quel stock le sortir ?</p>
      ${dispo.map((o) => `<button class="btn" style="justify-content:space-between" data-o="${o.id}">
        <span>${esc(o.est_vente ? 'Vente (payant)' : o.nom + ' (gratuit)')}</span><span class="num muted">stock ${stockDe(p, o.id)}</span></button>`).join('')}`);
    m.el.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.o);
      m.fermer();
      if (id !== etat.origine) {
        if (etat.panier.size) toast('Panier vidé : une vente et une distribution ne se mélangent pas.', 'warn');
        changerOrigine(id);
      }
      ajouter(p);
    });
  }

  function suggestion() {
    const pr = prog();
    if (!pr?.est_vente || !gratuite || etat.ignorerSuggestion || !ctx.peut('programmes')) return null;
    const tr = trancheAge(etat.patient.age, etat.patient.unite) || etat.patient.tranche;
    const jeune = tr === TRANCHES[0] || tr === TRANCHES[1];
    const enceinte = etat.patient.enceinte && etat.patient.sexe !== 'M';
    if (!jeune && !enceinte) return null;
    const ids = [...etat.panier.keys()].filter((id) => stockDe(prodPar(id), gratuite.id) > 0);
    if (!ids.length) return null;
    return { ids, texte: (jeune ? 'Enfant de ' + tr : 'Femme enceinte') + ' : ' + ids.length + ' médicament(s) du panier existent en ' + gratuite.nom + '.' + (ids.length < etat.panier.size ? ' Les autres resteront à vendre à part.' : '') };
  }

  function total() {
    if (!prog()?.est_vente) return 0;
    let t = 0;
    for (const [id, n] of etat.panier) t += n * Number(prodPar(id)?.prix_vente || 0);
    return t;
  }

  function dessiner() {
    const pr = prog();
    const estVente = pr.est_vente;
    const listeProduits = catalogue
      .filter((p) => p.actif && p.origines[pr.id] && correspond(p, etat.recherche))
      .sort((a, b) => (stockDe(b) > 0) - (stockDe(a) > 0) || a.designation.localeCompare(b.designation, 'fr'))
      .slice(0, 60);
    const lignes = [...etat.panier].map(([id, n]) => ({ p: prodPar(id), n })).filter((l) => l.p);
    const t = total();
    const tr = trancheAge(etat.patient.age, etat.patient.unite);
    const sug = suggestion();

    el.innerHTML = `
      <div class="stack">
        <div class="inline"><strong style="margin-right:6px">Ce patient est servi en :</strong>
          <div class="origines" role="group" aria-label="Origine des médicaments">
            ${origines.map((o) => `<button type="button" class="org ${o.id === pr.id ? (o.est_vente ? 'on' : 'on-v') : ''}" data-origine="${o.id}">
              <span style="font-weight:700">${esc(o.est_vente ? 'Vente' : o.sigle)}</span>
              <span class="small" style="opacity:.85">${esc(o.est_vente ? 'Payant' : o.nom + ' · gratuit')}</span></button>`).join('')}
          </div>
        </div>
        ${estVente && !caisse ? `
          <div class="card card-pad inline" style="background:var(--orange-clair);border-color:#F0D58A">
            <strong style="color:var(--orange)">La caisse est fermée.</strong>
            <label class="sr" for="fond">Fond de caisse</label>
            <input class="in num" id="fond" inputmode="numeric" placeholder="Fond de caisse (F)" style="max-width:220px">
            <button class="btn btn-p" id="ouvrir-caisse">Ouvrir la caisse</button>
          </div>` : ''}
      </div>

      <div class="row">
        <section class="col-main">
          <div>
            <label class="lbl" for="recherche">Chercher ou scanner un médicament</label>
            <input class="in scan" id="recherche" type="search" autocomplete="off" placeholder="Nom ou code-barres, puis Entrée" value="${esc(etat.recherche)}">
          </div>
          <div class="inline" style="justify-content:space-between"><h2>${esc(estVente ? 'Médicaments en vente' : 'Médicaments du programme ' + pr.nom)}</h2>
            <span class="small muted">${listeProduits.length >= 60 ? '60 premiers résultats · affinez la recherche' : 'Touchez un produit pour l’ajouter'}</span></div>
          <div class="tiles">
            ${listeProduits.map((p) => {
              const reste = stockDe(p) - (etat.panier.get(p.id) || 0);
              const o = p.origines[pr.id];
              let badge = estVente ? 'b-ok' : 'b-prog';
              let txt = (estVente ? 'Stock ' : pr.sigle + ' ') + reste;
              if (stockDe(p) <= 0) { badge = 'b-out'; txt = 'Rupture'; }
              else if (reste < p.stock_min) { badge = 'b-low'; txt = 'Reste ' + reste; }
              return `<button type="button" class="tile" data-ajout="${p.id}" ${reste <= 0 ? 'disabled' : ''}>
                <span class="nom">${esc(p.designation)}</span>
                ${o?.prochaine ? `<span class="small muted">Pér. ${fmtPeremption(o.prochaine)}</span>` : ''}
                <span class="bas"><span class="num" style="font-weight:600;${estVente ? '' : 'color:var(--violet)'}">${estVente ? fmtF(p.prix_vente) : 'Gratuit'}</span>
                <span class="badge ${badge}">${esc(txt)}</span></span></button>`;
            }).join('') || '<div class="muted">Aucun produit trouvé.</div>'}
          </div>
        </section>

        <section class="col-side">
          <div class="card" style="display:flex;flex-direction:column">
            <div class="card-head ${estVente ? '' : 'cart-head-prog'}"><h2>${esc(estVente ? 'Vente en cours' : 'Distribution · ' + pr.nom)}</h2>
              <span class="small">${lignes.reduce((s, l) => s + l.n, 0)} article(s)</span></div>
            ${sug ? `
              <div style="margin:14px 18px 0;padding:14px;border-radius:12px;background:#F6F2FC;border:1px solid #D5C6EE" class="stack">
                <strong style="color:var(--violet)">Ce patient a peut-être droit à la ${esc(gratuite.nom)}</strong>
                <span class="small">${esc(sug.texte)}</span>
                <div class="inline"><button class="btn btn-v" id="vers-grat">Passer en ${esc(gratuite.nom)}</button>
                  <button class="link" id="ignorer-sug">Non, vendre normalement</button></div>
              </div>` : ''}
            ${lignes.length ? lignes.map(({ p, n }) => `
              <div class="cart-line">
                <div style="flex:1 1 150px;min-width:0">
                  <div style="font-weight:600">${esc(p.designation)}</div>
                  <div class="small muted num">${estVente ? fmtF(p.prix_vente) : 'Gratuit'} × ${n}</div>
                  <button class="link small" style="color:var(--rouge)" data-retirer="${p.id}">Retirer</button>
                </div>
                <div class="inline"><button class="qb" aria-label="Diminuer" data-moins="${p.id}">−</button>
                  <span class="num" style="min-width:28px;text-align:center;font-size:18px;font-weight:600">${n}</span>
                  <button class="qb" aria-label="Augmenter" data-plus="${p.id}">+</button></div>
                <div class="num r" style="min-width:80px;font-weight:600">${estVente ? fmtF(n * p.prix_vente) : '0 F'}</div>
              </div>`).join('') : '<div class="muted" style="padding:30px 18px;text-align:center">Aucun article. Cherchez, scannez ou touchez un produit.</div>'}

            <div style="padding:14px 18px 0">
              <details class="patient" ${etat.patientOuvert ?? !estVente ? 'open' : ''}>
                <summary>Patient&nbsp;<span class="muted" style="font-weight:400">(facultatif)</span></summary>
                <div class="grid-2" style="padding-bottom:12px">
                  <div class="span-2"><label class="lbl" for="p-nom">Nom</label><input class="in" id="p-nom" data-p="nom" placeholder="Laisser vide si inconnu" value="${esc(etat.patient.nom)}"></div>
                  <div><label class="lbl" for="p-age">Âge</label>
                    <div class="inline" style="flex-wrap:nowrap"><input class="in num" id="p-age" data-p="age" inputmode="decimal" value="${esc(etat.patient.age)}">
                    <select class="in" data-p="unite" aria-label="Unité de l'âge" style="width:92px"><option value="ans" ${etat.patient.unite === 'ans' ? 'selected' : ''}>ans</option><option value="mois" ${etat.patient.unite === 'mois' ? 'selected' : ''}>mois</option></select></div></div>
                  <div><label class="lbl" for="p-tr">Tranche d'âge</label>
                    <select class="in" id="p-tr" data-p="tranche" ${tr ? 'disabled' : ''}>
                      <option value="">Non précisée</option>
                      ${TRANCHES.map((t2) => `<option ${(tr || etat.patient.tranche) === t2 ? 'selected' : ''}>${esc(t2)}</option>`).join('')}
                    </select></div>
                  <div class="span-2"><span class="lbl">Sexe</span><div class="inline" role="group" aria-label="Sexe">
                    ${[['M', 'M'], ['F', 'F'], ['NP', 'Non précisé']].map(([v, l]) => `<button type="button" class="chip ${etat.patient.sexe === v ? 'on' : ''}" data-sexe="${v}" style="flex:1">${l}</button>`).join('')}</div></div>
                  ${etat.patient.sexe !== 'M' ? `<label class="check span-2"><input type="checkbox" data-p="enceinte" ${etat.patient.enceinte ? 'checked' : ''}> Femme enceinte</label>` : ''}
                  ${!estVente && pr.categories?.length ? `<div class="span-2"><label class="lbl" for="cat">Catégorie</label><select class="in" id="cat"><option value="">—</option>${pr.categories.map((c) => `<option ${etat.categorie === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>` : ''}
                </div>
              </details>
            </div>

            <div style="padding:14px 18px 18px" class="stack">
              <div class="inline" style="justify-content:space-between"><span style="font-size:17px;font-weight:600">${estVente ? 'Total' : 'À payer'}</span>
                <span class="total" style="color:${estVente ? 'var(--vert-fonce)' : 'var(--violet)'}">${fmtF(t)}</span></div>
              ${estVente ? `
                <div class="inline" role="group" aria-label="Mode de paiement">
                  ${[['especes', 'Espèces'], ['momo', 'Mobile Money']].concat(ctx.peut('credit') ? [['credit', 'Crédit']] : [])
                    .map(([v, l]) => `<button type="button" class="chip ${etat.mode === v ? 'on' : ''}" data-mode="${v}" style="flex:1">${l}</button>`).join('')}
                </div>
                ${etat.mode === 'credit' ? `
                  <div class="stack" style="padding:12px;border-radius:10px;background:#FFF6DE">
                    <label class="lbl" for="client" style="margin:0">Client</label>
                    <select class="in" id="client"><option value="">Choisir…</option>
                      ${clients.map((c) => `<option value="${c.client_id}" ${String(etat.client) === String(c.client_id) ? 'selected' : ''}>${esc(c.nom)} · doit ${fmtF(c.du)} · plafond ${fmtF(c.plafond)}</option>`).join('')}
                    </select>
                    <button type="button" class="link" id="nouveau-client" style="align-self:flex-start">+ Nouveau client</button>
                  </div>` : `
                  <div class="grid-2">
                    <div><label class="lbl" for="recu">Montant reçu</label><input class="in num" id="recu" inputmode="numeric" value="${esc(etat.recu)}"></div>
                    <div><span class="lbl">Monnaie à rendre</span><div class="num" id="monnaie" style="min-height:48px;display:flex;align-items:center;font-size:22px;font-weight:600"></div></div>
                  </div>`}` : `<div class="alert alert-prog" style="font-weight:400">Rien à encaisser. Les médicaments sortent du <strong>stock ${esc(pr.sigle)}</strong> et comptent dans son compte rendu.</div>`}
              <button class="btn btn-big ${estVente ? 'btn-p' : 'btn-v'}" id="valider" ${lignes.length ? '' : 'disabled'}>
                ${estVente ? (etat.mode === 'credit' ? 'Enregistrer à crédit · ' + fmtF(t) : 'Encaisser ' + fmtF(t)) : 'Enregistrer la distribution gratuite'}</button>
            </div>
          </div>
        </section>
      </div>`;

    brancher();
  }

  function majMonnaie() {
    const zone = el.querySelector('#monnaie');
    if (!zone) return;
    const recu = entier(etat.recu);
    const t = total();
    if (recu === null || !etat.panier.size) { zone.textContent = '—'; zone.style.color = ''; return; }
    const m = recu - t;
    zone.textContent = m >= 0 ? fmtF(m) : 'Manque ' + fmtF(-m);
    zone.style.color = m < 0 ? 'var(--rouge)' : '';
  }

  function brancher() {
    el.querySelectorAll('[data-origine]').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.origine);
      if (id === etat.origine) return;
      if (etat.panier.size) toast('Panier vidé : une vente et une distribution ne se mélangent pas.', 'warn');
      changerOrigine(id);
    });
    const r = el.querySelector('#recherche');
    r.oninput = () => {
      etat.recherche = r.value;
      const pos = r.selectionStart;
      dessiner();
      const n = el.querySelector('#recherche');
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    r.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); scanner(r.value); } };
    el.querySelectorAll('[data-ajout]').forEach((b) => b.onclick = () => ajouter(prodPar(Number(b.dataset.ajout))));
    el.querySelectorAll('[data-plus]').forEach((b) => b.onclick = () => ajouter(prodPar(Number(b.dataset.plus))));
    el.querySelectorAll('[data-moins]').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.moins);
      const n = etat.panier.get(id) - 1;
      if (n > 0) etat.panier.set(id, n); else etat.panier.delete(id);
      dessiner();
    });
    el.querySelectorAll('[data-retirer]').forEach((b) => b.onclick = () => { etat.panier.delete(Number(b.dataset.retirer)); dessiner(); });

    el.querySelector('details.patient').ontoggle = (e) => { etat.patientOuvert = e.target.open; };
    el.querySelectorAll('[data-p]').forEach((i) => {
      const k = i.dataset.p;
      if (k === 'nom') { i.oninput = () => { etat.patient.nom = i.value; }; return; }
      if (i.tagName === 'INPUT' && i.type !== 'checkbox') i.oninput = () => { etat.patient[k] = i.value; };
      // L'âge, la tranche et la grossesse changent la suggestion : on redessine
      i.onchange = () => { etat.patient[k] = i.type === 'checkbox' ? i.checked : i.value; dessiner(); };
    });
    el.querySelectorAll('[data-sexe]').forEach((b) => b.onclick = () => {
      etat.patient.sexe = b.dataset.sexe;
      if (b.dataset.sexe === 'M') etat.patient.enceinte = false;
      dessiner();
    });
    const cat = el.querySelector('#cat');
    if (cat) cat.onchange = () => { etat.categorie = cat.value; };
    el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { etat.mode = b.dataset.mode; dessiner(); });
    const recu = el.querySelector('#recu');
    if (recu) recu.oninput = () => { etat.recu = recu.value; majMonnaie(); };
    majMonnaie();
    const cl = el.querySelector('#client');
    if (cl) cl.onchange = () => { etat.client = cl.value; };
    const nc = el.querySelector('#nouveau-client');
    if (nc) nc.onclick = nouveauClient;

    const vg = el.querySelector('#vers-grat');
    if (vg) vg.onclick = () => {
      const sug = suggestion();
      const garder = sug.ids.map((id) => [id, Math.min(etat.panier.get(id), stockDe(prodPar(id), gratuite.id))]);
      changerOrigine(gratuite.id, garder);
    };
    const ig = el.querySelector('#ignorer-sug');
    if (ig) ig.onclick = () => { etat.ignorerSuggestion = true; dessiner(); };

    const oc = el.querySelector('#ouvrir-caisse');
    if (oc) oc.onclick = async () => {
      try {
        await rpc(sb, 'ouvrir_caisse', { p_fond: entier(el.querySelector('#fond').value) || 0 });
        toast('Caisse ouverte.');
        await charger();
        ctx.majCaisse();
        dessiner();
      } catch (e) { erreur(e); }
    };
    el.querySelector('#valider').onclick = valider;
  }

  function nouveauClient() {
    const m = modal('Nouveau client', `
      <div><label class="lbl" for="nc-nom">Nom</label><input class="in" id="nc-nom"></div>
      <div><label class="lbl" for="nc-tel">Téléphone</label><input class="in" id="nc-tel" inputmode="tel"></div>
      <div><label class="lbl" for="nc-pl">Plafond de crédit (F)</label><input class="in num" id="nc-pl" inputmode="numeric" value="10000"></div>
      <button class="btn btn-p" id="nc-ok">Créer</button>`);
    m.el.querySelector('#nc-ok').onclick = async () => {
      const nom = m.el.querySelector('#nc-nom').value.trim();
      if (!nom) return toast('Le nom est obligatoire.', 'warn');
      try {
        const c = await q(sb.from('clients').insert({ nom, telephone: m.el.querySelector('#nc-tel').value.trim() || null, plafond: entier(m.el.querySelector('#nc-pl').value) ?? 10000 }).select().single());
        clients = await q(sb.from('v_dettes').select('*').order('nom'));
        etat.client = c.id;
        m.fermer();
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  async function valider() {
    const pr = prog();
    const bouton = el.querySelector('#valider');
    if (pr.est_vente && etat.mode === 'credit' && !etat.client) return toast('Choisissez le client.', 'warn');
    if (pr.est_vente && etat.mode !== 'credit') {
      const recu = entier(etat.recu);
      if (recu !== null && recu < total()) return toast('Le montant reçu est inférieur au total.', 'warn');
    }
    bouton.disabled = true;
    const tr = trancheAge(etat.patient.age, etat.patient.unite);
    const lignesPanier = [...etat.panier].map(([id, n]) => ({ p: prodPar(id), n }));
    const charge = {
      programme_id: pr.id,
      mode: pr.est_vente ? etat.mode : 'gratuit',
      client_id: etat.mode === 'credit' ? etat.client : null,
      montant_recu: pr.est_vente && etat.mode !== 'credit' ? entier(etat.recu) : null,
      categorie: etat.categorie || null,
      patient: {
        nom: etat.patient.nom, age: etat.patient.age, unite: etat.patient.unite,
        tranche: tr || etat.patient.tranche, sexe: etat.patient.sexe, enceinte: etat.patient.enceinte
      },
      lignes: lignesPanier.map(({ p, n }) => ({ produit_id: p.id, quantite: n }))
    };
    try {
      const res = await rpc(sb, 'enregistrer_vente', { p: charge });
      const clientNom = clients.find((c) => String(c.client_id) === String(etat.client))?.nom;
      const ticket = ticketHtml(ctx, { ...res, programme: pr, mode: charge.mode, recu: charge.montant_recu, lignes: lignesPanier, patient: charge.patient, client: clientNom, date: new Date() });
      etat = { ...etatVide(), origine: etat.origine, recherche: '' };
      await charger();
      dessiner();
      const m = modal(pr.est_vente ? 'Vente enregistrée' : 'Distribution enregistrée', `
        <div class="alert ${pr.est_vente ? 'alert-ok' : 'alert-prog'}">${esc(res.numero)} · ${pr.est_vente ? fmtF(res.total) : 'gratuit'}</div>
        <div style="border:1px solid var(--bord);border-radius:10px;padding:8px">${ticket}</div>
        <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Nouvelle vente</button><button class="btn btn-p" id="imp">Imprimer le ${pr.est_vente ? 'reçu' : 'ticket'}</button></div>`);
      m.el.querySelector('#imp').onclick = () => imprimer(ticket);
    } catch (e) {
      bouton.disabled = false;
      erreur(e);
    }
  }

  await charger();
  dessiner();
  el.querySelector('#recherche')?.focus();
}

export function ticketHtml(ctx, v) {
  const ph = ctx.pharmacie;
  const estVente = v.programme.est_vente;
  const lignes = v.lignes.map(({ p, n, prix }) => {
    const pu = prix ?? p.prix_vente;
    return `<div>${esc(p.designation)}</div><div class="ligne"><span>&nbsp;&nbsp;${n} × ${estVente ? fmt(pu) : '0'}</span><span>${estVente ? fmt(n * pu) : '0'}</span></div>`;
  }).join('');
  const patient = [v.patient?.nom, v.patient?.age ? v.patient.age + ' ' + v.patient.unite : v.patient?.tranche, v.patient?.sexe && v.patient.sexe !== 'NP' ? v.patient.sexe : ''].filter(Boolean).join(' · ');
  return `<div class="ticket">
    <div class="c" style="font-weight:700;font-size:14px">${esc(ph.nom || 'Pharmacie')}</div>
    ${ph.adresse || ph.telephone ? `<div class="c">${esc([ph.adresse, ph.telephone].filter(Boolean).join(' · '))}</div>` : ''}
    ${estVente ? '' : `<div class="c" style="font-weight:700">PROGRAMME ${esc(v.programme.nom.toUpperCase())} (${esc(v.programme.sigle)})</div><div class="c">Médicaments GRATUITS · ne pas payer</div>`}
    <div class="sep"></div>
    <div class="ligne"><span>${estVente ? 'Reçu' : 'Ticket'} N°</span><span>${esc(v.numero)}</span></div>
    <div class="ligne"><span>Date</span><span>${esc(fmtDateHeure(v.date))}</span></div>
    ${patient ? `<div class="ligne"><span>Patient</span><span>${esc(patient)}</span></div>` : ''}
    ${v.client ? `<div class="ligne"><span>Client (crédit)</span><span>${esc(v.client)}</span></div>` : ''}
    <div class="sep"></div>
    ${lignes}
    <div class="sep"></div>
    <div class="ligne" style="font-weight:700;font-size:14px"><span>${estVente ? 'TOTAL' : 'Montant à payer'}</span><span>${estVente ? fmt(v.total) : '0'} F</span></div>
    ${estVente && v.mode === 'credit' ? '<div class="ligne"><span>Paiement</span><span>À crédit</span></div>' : ''}
    ${estVente && v.mode === 'momo' ? '<div class="ligne"><span>Paiement</span><span>Mobile Money</span></div>' : ''}
    ${estVente && v.mode === 'especes' && v.recu ? `<div class="ligne"><span>Espèces reçues</span><span>${fmt(v.recu)}</span></div><div class="ligne"><span>Monnaie rendue</span><span>${fmt(v.recu - v.total)}</span></div>` : ''}
    <div class="sep"></div>
    <div class="c">${estVente ? 'Merci de votre confiance.' : 'Signature / empreinte :'}</div>
    ${estVente ? '' : '<div style="height:36px;border-bottom:1px solid #555"></div>'}
  </div>`;
}
