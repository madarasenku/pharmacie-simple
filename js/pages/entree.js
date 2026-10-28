// Entrée de stock : achat pour la vente ou dotation d'un programme.
import { esc, fmt, fmtF, fmtHeure, fmtPeremption, q, rpc, erreur, toast, chargerCatalogue, correspond, entier, nombre, isoJour } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  let catalogue = [];
  let choisi = null;
  let codeInconnu = '';
  let recherche = '';
  let entrees = [];

  async function charger() {
    const debut = new Date(isoJour() + 'T00:00:00').toISOString();
    [catalogue, entrees] = await Promise.all([
      chargerCatalogue(sb),
      q(sb.from('mouvements').select('id, quantite, prix_unitaire, fournisseur, reference, created_at, programme_id, produits(designation), lots(numero, peremption)')
        .eq('type', 'entree').gte('created_at', debut).order('created_at', { ascending: false }))
    ]);
    if (choisi) choisi = catalogue.find((p) => p.id === choisi.id) || null;
  }

  const nomOrigine = (id) => {
    const p = ctx.programmes.find((x) => x.id === id);
    return p ? (p.est_vente ? 'Vente' : p.sigle) : '?';
  };

  function dessiner() {
    const resultats = recherche && !choisi ? catalogue.filter((p) => correspond(p, recherche)).slice(0, 12) : [];
    const origines = choisi
      ? [...ctx.programmes.filter((o) => o.actif && choisi.origines[o.id]), ...ctx.programmes.filter((o) => o.actif && !choisi.origines[o.id])]
      : [];
    const totalAchats = entrees.filter((e) => e.prix_unitaire).reduce((s, e) => s + e.quantite * e.prix_unitaire, 0);

    el.innerHTML = `
      <div class="page-head"><div><h1>J'ai reçu des médicaments</h1>
        <div class="muted small">Scannez ou cherchez le produit, puis indiquez d'où vient la livraison, la quantité, le lot et la péremption.</div></div></div>
      <div class="row">
        <section class="col-main">
          <div class="card card-pad stack">
            <div><label class="lbl" for="code">1. Scanner le code-barres ou chercher le produit</label>
              <input class="in scan num" id="code" autocomplete="off" placeholder="Scannez ou tapez, puis Entrée" value="${esc(recherche)}"></div>
            ${resultats.length ? `<div class="stack" style="gap:6px">${resultats.map((p) => `<button class="btn" style="justify-content:space-between;text-align:left" data-choix="${p.id}">
              <span>${esc(p.designation)}</span><span class="small muted">${p.code_barres ? esc(p.code_barres) : ''}</span></button>`).join('')}</div>` : ''}
            ${codeInconnu ? formulaireNouveau() : ''}
            ${choisi ? `
              <div class="alert alert-ok" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-weight:400">
                <div><strong style="color:var(--vert-fonce);font-size:16px">${esc(choisi.designation)}</strong><br>
                <span class="small">${Object.entries(choisi.origines).map(([id, o]) => esc(nomOrigine(Number(id))) + ' : ' + o.quantite).join(' · ') || 'Aucune origine'}</span></div>
                <button class="link" id="changer">Changer de produit</button>
              </div>
              ${!choisi.code_barres && codeScanne(recherche) && ctx.peut('base') ? `<button class="btn btn-sm" id="lier-code">Associer le code ${esc(recherche)} à ce produit</button>` : ''}
            ` : ''}
          </div>

          ${choisi ? `
          <div class="card card-pad stack">
            <h2>2. Origine, quantité, lot et prix</h2>
            <div><label class="lbl" for="origine">D'où vient cette livraison ?</label>
              <select class="in" id="origine">${origines.map((o) => `<option value="${o.id}">${esc(o.est_vente ? 'Achat pour la vente' : 'Dotation ' + o.nom + ' (' + o.sigle + ')')}${choisi.origines[o.id] ? '' : ' — nouveau pour ce produit'}</option>`).join('')}</select></div>
            <div class="grid-3">
              <div><label class="lbl" for="qte">Quantité reçue</label><input class="in num" id="qte" inputmode="numeric"></div>
              <div><label class="lbl" for="lot">N° de lot</label><input class="in num" id="lot"></div>
              <div><label class="lbl" for="per">Date de péremption</label><input class="in" id="per" type="date"></div>
            </div>
            <div class="grid-3" id="zone-prix">
              <div><label class="lbl" for="pa">Prix d'achat unitaire (F)</label><input class="in num" id="pa" inputmode="decimal" value="${choisi.prix_achat || ''}"></div>
              <div><label class="lbl" for="pv">Prix de vente unitaire (F)</label><input class="in num" id="pv" inputmode="decimal" value="${choisi.prix_vente || ''}" ${ctx.peut('prix') ? '' : 'disabled title="Seul le gérant change les prix"'}></div>
              <div style="min-height:48px;display:flex;flex-direction:column;justify-content:flex-end"><span class="small muted">Marge par unité</span><span class="num" id="marge" style="font-size:18px;font-weight:600"></span></div>
            </div>
            <div class="grid-2">
              <div><label class="lbl" for="four">Fournisseur</label><input class="in" id="four" value="Pharmacie du district"></div>
              <div><label class="lbl" for="ref">N° bon de livraison / facture</label><input class="in num" id="ref"></div>
            </div>
            <button class="btn btn-p btn-big" id="ajouter">Ajouter au stock</button>
          </div>` : ''}
        </section>

        <section class="col-side">
          <div class="card">
            <div class="card-head"><h2>Entrées d'aujourd'hui</h2><span class="small muted num">${fmtF(totalAchats)} d'achats</span></div>
            <div class="table-box"><table class="tbl">
              <thead><tr><th>Heure</th><th>Produit</th><th>Origine</th><th>Lot · pér.</th><th class="r">Qté</th></tr></thead>
              <tbody>${entrees.map((e) => `<tr><td class="num">${fmtHeure(e.created_at)}</td><td>${esc(e.produits?.designation)}</td>
                <td><span class="badge ${ctx.programmes.find((p) => p.id === e.programme_id)?.est_vente ? 'b-ok' : 'b-prog'}">${esc(nomOrigine(e.programme_id))}</span></td>
                <td class="num small">${esc(e.lots?.numero || '—')} · ${fmtPeremption(e.lots?.peremption)}</td>
                <td class="num r" style="color:#1A6438;font-weight:600">+${fmt(e.quantite)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune entrée aujourd’hui.</td></tr>'}</tbody>
            </table></div>
          </div>
        </section>
      </div>`;
    brancher();
  }

  const codeScanne = (t) => /^\d{6,}$/.test(String(t).trim());

  function formulaireNouveau() {
    return `<div class="stack" style="padding:16px;border-radius:12px;background:#FFF6DE;border:1px solid #F0D58A">
      <div><strong style="color:var(--orange)">Code inconnu : ${esc(codeInconnu)}</strong>
      <div class="small">Créez ce produit une seule fois. Au prochain scan, il sera reconnu (ici et au comptoir).</div></div>
      <div><label class="lbl" for="n-nom">Désignation</label><input class="in" id="n-nom" placeholder="Ex. : CIPROFLOXACINE 500 MG CP"></div>
      <div class="grid-2">
        <div><label class="lbl" for="n-pres">Présentation</label><input class="in" id="n-pres" placeholder="Boîte, plaquette, flacon…"></div>
        <div><label class="lbl" for="n-min">Stock minimum (alerte)</label><input class="in num" id="n-min" inputmode="numeric" value="0"></div>
      </div>
      <fieldset style="border:0;margin:0;padding:0"><legend class="lbl">Ce produit est (plusieurs choix possibles)</legend>
        <div class="inline">${ctx.programmes.filter((o) => o.actif).map((o) => `<label class="check"><input type="checkbox" data-n-prog="${o.id}" ${o.est_vente ? 'checked' : ''}> ${esc(o.est_vente ? 'Vendu' : o.nom)}</label>`).join('')}</div>
      </fieldset>
      <div class="inline"><button class="btn btn-p" id="creer">Créer le produit</button><button class="link" id="annuler-nouveau">Annuler</button></div>
    </div>`;
  }

  function choisir(p) {
    choisi = p;
    codeInconnu = '';
    dessiner();
    el.querySelector('#qte')?.focus();
  }

  function brancher() {
    const code = el.querySelector('#code');
    code.oninput = () => {
      recherche = code.value;
      choisi = null;
      codeInconnu = '';
      const pos = code.selectionStart;
      dessiner();
      const c = el.querySelector('#code');
      c.focus();
      c.setSelectionRange(pos, pos);
    };
    code.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const t = code.value.trim();
      if (!t) return;
      const p = catalogue.find((x) => x.code_barres === t);
      if (p) return choisir(p);
      const res = catalogue.filter((x) => correspond(x, t));
      if (res.length === 1) return choisir(res[0]);
      if (codeScanne(t) && !res.length) {
        if (!ctx.peut('entree')) return toast('Code inconnu.', 'warn');
        codeInconnu = t;
        dessiner();
        el.querySelector('#n-nom')?.focus();
      }
    };
    el.querySelectorAll('[data-choix]').forEach((b) => b.onclick = () => choisir(catalogue.find((p) => p.id === Number(b.dataset.choix))));
    const ch = el.querySelector('#changer');
    if (ch) ch.onclick = () => { choisi = null; recherche = ''; dessiner(); el.querySelector('#code').focus(); };
    const an = el.querySelector('#annuler-nouveau');
    if (an) an.onclick = () => { codeInconnu = ''; dessiner(); };

    const lc = el.querySelector('#lier-code');
    if (lc) lc.onclick = async () => {
      try {
        await q(sb.from('produits').update({ code_barres: recherche.trim() }).eq('id', choisi.id));
        toast('Code-barres associé.');
        await charger();
        dessiner();
      } catch (e) { erreur(e); }
    };

    const cr = el.querySelector('#creer');
    if (cr) cr.onclick = async () => {
      const nom = el.querySelector('#n-nom').value.trim();
      const progs = [...el.querySelectorAll('[data-n-prog]')].filter((c) => c.checked).map((c) => Number(c.dataset.nProg));
      if (!nom) return toast('La désignation est obligatoire.', 'warn');
      if (!progs.length) return toast('Cochez au moins une origine.', 'warn');
      cr.disabled = true;
      try {
        const p = await q(sb.from('produits').insert({
          designation: nom.toUpperCase(), code_barres: codeInconnu,
          presentation: el.querySelector('#n-pres').value.trim() || null,
          stock_min: entier(el.querySelector('#n-min').value) || 0
        }).select().single());
        await q(sb.from('produits_programmes').insert(progs.map((id) => ({ produit_id: p.id, programme_id: id }))));
        toast('Produit créé.');
        await charger();
        recherche = codeInconnu;
        choisir(catalogue.find((x) => x.id === p.id));
      } catch (e) { cr.disabled = false; erreur(e); }
    };

    const og = el.querySelector('#origine');
    if (og) {
      const majPrix = () => {
        const estVente = ctx.programmes.find((p) => p.id === Number(og.value))?.est_vente;
        el.querySelector('#zone-prix').classList.toggle('hidden', !estVente);
        el.querySelector('#four').value = estVente ? 'Pharmacie du district' : 'Dotation ' + (ctx.programmes.find((p) => p.id === Number(og.value))?.sigle || '');
      };
      og.onchange = majPrix;
      majPrix();
      const marge = () => {
        const pa = nombre(el.querySelector('#pa').value) || 0;
        const pv = nombre(el.querySelector('#pv').value) || 0;
        const m = pv - pa;
        const z = el.querySelector('#marge');
        z.textContent = fmtF(m) + (pa ? ' (' + Math.round((m / pa) * 100) + ' %)' : '');
        z.style.color = m < 0 ? 'var(--rouge)' : '#1A6438';
      };
      el.querySelector('#pa').oninput = marge;
      el.querySelector('#pv').oninput = marge;
      marge();
      el.querySelector('#ajouter').onclick = ajouterAuStock;
    }
  }

  async function ajouterAuStock() {
    const bouton = el.querySelector('#ajouter');
    const origine = Number(el.querySelector('#origine').value);
    const estVente = ctx.programmes.find((p) => p.id === origine)?.est_vente;
    const qte = entier(el.querySelector('#qte').value);
    if (!qte || qte <= 0) return toast('Indiquez la quantité reçue.', 'warn');
    const per = el.querySelector('#per').value;
    if (per && new Date(per) < new Date()) return toast('Cette date de péremption est déjà passée.', 'warn');
    bouton.disabled = true;
    try {
      await rpc(sb, 'enregistrer_entree', { p: {
        produit_id: choisi.id, programme_id: origine, quantite: qte,
        numero_lot: el.querySelector('#lot').value.trim(), peremption: per || null,
        prix_achat: estVente ? nombre(el.querySelector('#pa').value) : null,
        prix_vente: estVente && ctx.peut('prix') ? nombre(el.querySelector('#pv').value) : null,
        fournisseur: el.querySelector('#four').value.trim(), reference: el.querySelector('#ref').value.trim()
      } });
      toast(qte + ' × ' + choisi.designation + ' ajouté(s) au stock.');
      choisi = null;
      recherche = '';
      await charger();
      dessiner();
      el.querySelector('#code').focus();
    } catch (e) { bouton.disabled = false; erreur(e); }
  }

  await charger();
  dessiner();
  el.querySelector('#code').focus();
}
