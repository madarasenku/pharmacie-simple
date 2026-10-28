// Base : programmes et produits (prix, code-barres, rattachement aux programmes).
import { esc, fmt, q, erreur, toast, modal, correspond, entier, nombre, csv, telecharger } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  let recherche = '';
  let voirInactifs = false;
  let produits = [];
  let liens = new Set();

  async function charger() {
    await ctx.rechargerContexte();
    const [p, l] = await Promise.all([
      q(sb.from('produits').select('*').order('designation')),
      q(sb.from('produits_programmes').select('produit_id, programme_id'))
    ]);
    produits = p;
    liens = new Set(l.map((x) => x.produit_id + ':' + x.programme_id));
  }

  function dessiner() {
    const progs = ctx.programmes;
    const liste = produits.filter((p) => (voirInactifs || p.actif) && correspond(p, recherche));
    const sansPrix = produits.filter((p) => p.actif && liens.has(p.id + ':' + ctx.vente?.id) && !Number(p.prix_vente)).length;

    el.innerHTML = `
      <div class="page-head"><div><h1>Base : programmes et produits</h1>
        <div class="small muted">Créez les programmes une fois, puis cochez pour chaque produit la vente et le ou les programmes qui le fournissent.</div></div></div>

      <section class="card">
        <div class="card-head"><h2>Programmes</h2><button class="btn btn-v" id="nv-prog">+ Nouveau programme</button></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Nom</th><th>Sigle</th><th>Rapport</th><th>Catégories de bénéficiaires</th><th>Envoyer à</th><th class="r">Produits</th><th>État</th><th></th></tr></thead>
          <tbody>${progs.map((g) => `<tr><td><strong>${esc(g.nom)}</strong>${g.est_vente ? ' <span class="badge b-ok">Vente</span>' : ''}</td><td class="num">${esc(g.sigle)}</td>
            <td>${esc(g.frequence)}</td><td class="small">${esc((g.categories || []).join(', '))}</td><td class="small">${esc(g.destinataire || '')}</td>
            <td class="num r">${produits.filter((p) => liens.has(p.id + ':' + g.id)).length}</td>
            <td><span class="badge ${g.actif ? 'b-ok' : 'b-low'}">${g.actif ? 'Actif' : 'Inactif'}</span></td>
            <td><button class="btn btn-sm" data-prog="${g.id}">Modifier</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h2>Produits (${liste.length})</h2>${sansPrix ? `<div class="small" style="color:var(--orange)">${sansPrix} produit(s) vendus sans prix de vente</div>` : ''}</div>
          <div class="inline">
            <label class="sr" for="rech">Chercher</label><input class="in" id="rech" type="search" placeholder="Chercher un produit" value="${esc(recherche)}" style="max-width:280px">
            <label class="check small"><input type="checkbox" id="inactifs" ${voirInactifs ? 'checked' : ''}> Inactifs</label>
            <button class="btn" id="export">Exporter</button>
            <button class="btn btn-p" id="nv-prod">+ Nouveau produit</button>
          </div>
        </div>
        <div class="small muted" style="padding:8px 18px">Les prix et le minimum se modifient directement dans le tableau (enregistrement automatique).</div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th>Produit</th><th>Code-barres</th><th class="r">Prix achat</th><th class="r">Prix vente</th><th class="r">Min.</th>
            ${progs.map((g) => `<th class="${g.est_vente ? '' : 'prog-col'}" style="text-align:center" title="${esc(g.nom)}">${esc(g.est_vente ? 'Vente' : g.sigle)}</th>`).join('')}<th></th></tr></thead>
          <tbody>${liste.map((p) => `<tr style="${p.actif ? '' : 'opacity:.55'}">
            <td style="min-width:240px">${esc(p.designation)}${p.presentation ? `<br><span class="small muted">${esc(p.presentation)}</span>` : ''}</td>
            <td class="num small">${esc(p.code_barres || '—')}</td>
            <td class="r"><input class="in num r" style="width:90px" data-champ="prix_achat" data-id="${p.id}" value="${Number(p.prix_achat)}" aria-label="Prix d'achat ${esc(p.designation)}"></td>
            <td class="r"><input class="in num r" style="width:90px;${Number(p.prix_vente) ? '' : 'background:#FFF0CC'}" data-champ="prix_vente" data-id="${p.id}" value="${Number(p.prix_vente)}" aria-label="Prix de vente ${esc(p.designation)}"></td>
            <td class="r"><input class="in num r" style="width:70px" data-champ="stock_min" data-id="${p.id}" value="${p.stock_min}" aria-label="Stock minimum ${esc(p.designation)}"></td>
            ${progs.map((g) => `<td style="text-align:center"><input type="checkbox" style="width:22px;height:22px;accent-color:${g.est_vente ? 'var(--vert)' : 'var(--violet)'}" data-lien="${p.id}:${g.id}" ${liens.has(p.id + ':' + g.id) ? 'checked' : ''} aria-label="${esc(p.designation)} : ${esc(g.nom)}"></td>`).join('')}
            <td><button class="btn btn-sm" data-prod="${p.id}">Modifier</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>`;

    const r = el.querySelector('#rech');
    r.oninput = () => {
      recherche = r.value;
      const pos = r.selectionStart;
      dessiner();
      const n = el.querySelector('#rech');
      n.focus();
      n.setSelectionRange(pos, pos);
    };
    el.querySelector('#inactifs').onchange = (e) => { voirInactifs = e.target.checked; dessiner(); };
    el.querySelector('#nv-prog').onclick = () => ficheProgramme(null);
    el.querySelector('#nv-prod').onclick = () => ficheProduit(null);
    el.querySelectorAll('[data-prog]').forEach((b) => b.onclick = () => ficheProgramme(ctx.programmes.find((g) => g.id === Number(b.dataset.prog))));
    el.querySelectorAll('[data-prod]').forEach((b) => b.onclick = () => ficheProduit(produits.find((p) => p.id === Number(b.dataset.prod))));
    el.querySelectorAll('[data-champ]').forEach((i) => i.onchange = async () => {
      const id = Number(i.dataset.id);
      const champ = i.dataset.champ;
      const v = champ === 'stock_min' ? entier(i.value) : nombre(i.value);
      if (v === null || v < 0) { toast('Valeur invalide.', 'warn'); return; }
      try {
        await q(sb.from('produits').update({ [champ]: v }).eq('id', id));
        const p = produits.find((x) => x.id === id);
        p[champ] = v;
        i.style.background = champ === 'prix_vente' && !v ? '#FFF0CC' : '#E0F1E8';
        setTimeout(() => { if (i.isConnected && !(champ === 'prix_vente' && !v)) i.style.background = ''; }, 900);
      } catch (e) { erreur(e); }
    });
    el.querySelectorAll('[data-lien]').forEach((c) => c.onchange = async () => {
      const [produit_id, programme_id] = c.dataset.lien.split(':').map(Number);
      try {
        if (c.checked) {
          await q(sb.from('produits_programmes').insert({ produit_id, programme_id }));
          liens.add(c.dataset.lien);
        } else {
          await q(sb.from('produits_programmes').delete().eq('produit_id', produit_id).eq('programme_id', programme_id));
          liens.delete(c.dataset.lien);
        }
      } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    el.querySelector('#export').onclick = () => {
      const l = [['Désignation', 'Présentation', 'Code-barres', 'Prix achat', 'Prix vente', 'Minimum', ...ctx.programmes.map((g) => g.sigle), 'Actif']];
      produits.forEach((p) => l.push([p.designation, p.presentation, p.code_barres, p.prix_achat, p.prix_vente, p.stock_min, ...ctx.programmes.map((g) => liens.has(p.id + ':' + g.id) ? 'oui' : ''), p.actif ? 'oui' : 'non']));
      telecharger('produits.csv', csv(l));
    };
  }

  function ficheProgramme(g) {
    const m = modal(g ? 'Modifier ' + g.nom : 'Nouveau programme', `
      <div><label class="lbl" for="g-nom">Nom</label><input class="in" id="g-nom" value="${esc(g?.nom || '')}" placeholder="Ex. : Tuberculose"></div>
      <div class="grid-2">
        <div><label class="lbl" for="g-sigle">Sigle</label><input class="in" id="g-sigle" value="${esc(g?.sigle || '')}" placeholder="Ex. : PNT" ${g?.est_vente ? 'disabled' : ''}></div>
        <div><label class="lbl" for="g-freq">Rapport</label><select class="in" id="g-freq"><option value="mensuel">Mensuel</option><option value="trimestriel" ${g?.frequence === 'trimestriel' ? 'selected' : ''}>Trimestriel</option></select></div>
      </div>
      <div><label class="lbl" for="g-cat">Catégories de bénéficiaires (séparées par des virgules)</label><input class="in" id="g-cat" value="${esc((g?.categories || []).join(', '))}" placeholder="Ex. : Enfant < 5 ans, Femme enceinte"></div>
      <div><label class="lbl" for="g-dest">Envoyer le rapport à</label><input class="in" id="g-dest" value="${esc(g?.destinataire || '')}" placeholder="District / coordination du programme"></div>
      ${g && !g.est_vente ? `<label class="check"><input type="checkbox" id="g-actif" ${g.actif ? 'checked' : ''}> Programme actif</label>` : ''}
      <button class="btn btn-p" id="g-ok">Enregistrer</button>`);
    m.el.querySelector('#g-ok').onclick = async () => {
      const nom = m.el.querySelector('#g-nom').value.trim();
      const sigle = (m.el.querySelector('#g-sigle').value.trim() || nom.slice(0, 4)).toUpperCase();
      if (!nom) return toast('Le nom est obligatoire.', 'warn');
      const ligne = {
        nom, frequence: m.el.querySelector('#g-freq').value,
        categories: m.el.querySelector('#g-cat').value.split(',').map((s) => s.trim()).filter(Boolean),
        destinataire: m.el.querySelector('#g-dest').value.trim() || null
      };
      if (!g?.est_vente) ligne.sigle = sigle;
      const actif = m.el.querySelector('#g-actif');
      if (actif) ligne.actif = actif.checked;
      try {
        if (g) await q(sb.from('programmes').update(ligne).eq('id', g.id));
        else await q(sb.from('programmes').insert({ ...ligne, code: sigle + '-' + Date.now().toString(36), ordre: 100 }));
        m.fermer();
        toast('Programme enregistré.');
        await charger();
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  function ficheProduit(p) {
    const m = modal(p ? 'Modifier le produit' : 'Nouveau produit', `
      <div><label class="lbl" for="p-nom">Désignation</label><input class="in" id="p-nom" value="${esc(p?.designation || '')}"></div>
      <div class="grid-2">
        <div><label class="lbl" for="p-pres">Présentation</label><input class="in" id="p-pres" value="${esc(p?.presentation || '')}"></div>
        <div><label class="lbl" for="p-code">Code-barres</label><input class="in num" id="p-code" value="${esc(p?.code_barres || '')}" placeholder="Scannez ici"></div>
        <div><label class="lbl" for="p-pa">Prix d'achat (F)</label><input class="in num" id="p-pa" inputmode="decimal" value="${p ? Number(p.prix_achat) : 0}"></div>
        <div><label class="lbl" for="p-pv">Prix de vente (F)</label><input class="in num" id="p-pv" inputmode="decimal" value="${p ? Number(p.prix_vente) : 0}"></div>
        <div><label class="lbl" for="p-min">Stock minimum</label><input class="in num" id="p-min" inputmode="numeric" value="${p ? p.stock_min : 0}"></div>
      </div>
      ${p ? '' : `<fieldset style="border:0;margin:0;padding:0"><legend class="lbl">Ce produit est</legend><div class="inline">
        ${ctx.programmes.filter((g) => g.actif).map((g) => `<label class="check"><input type="checkbox" data-np="${g.id}" ${g.est_vente ? 'checked' : ''}> ${esc(g.est_vente ? 'Vendu' : g.nom)}</label>`).join('')}</div></fieldset>`}
      ${p ? `<label class="check"><input type="checkbox" id="p-actif" ${p.actif ? 'checked' : ''}> Produit actif (décochez pour le masquer sans perdre son historique)</label>` : ''}
      <button class="btn btn-p" id="p-ok">Enregistrer</button>`);
    m.el.querySelector('#p-ok').onclick = async () => {
      const ligne = {
        designation: m.el.querySelector('#p-nom').value.trim(),
        presentation: m.el.querySelector('#p-pres').value.trim() || null,
        code_barres: m.el.querySelector('#p-code').value.trim() || null,
        prix_achat: nombre(m.el.querySelector('#p-pa').value) || 0,
        prix_vente: nombre(m.el.querySelector('#p-pv').value) || 0,
        stock_min: entier(m.el.querySelector('#p-min').value) || 0
      };
      if (!ligne.designation) return toast('La désignation est obligatoire.', 'warn');
      const actif = m.el.querySelector('#p-actif');
      if (actif) ligne.actif = actif.checked;
      try {
        if (p) await q(sb.from('produits').update(ligne).eq('id', p.id));
        else {
          const n = await q(sb.from('produits').insert(ligne).select().single());
          const progs = [...m.el.querySelectorAll('[data-np]')].filter((c) => c.checked).map((c) => ({ produit_id: n.id, programme_id: Number(c.dataset.np) }));
          if (progs.length) await q(sb.from('produits_programmes').insert(progs));
        }
        m.fermer();
        toast('Produit enregistré.');
        await charger();
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  await charger();
  dessiner();
}
