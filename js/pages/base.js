// Base : programmes et produits (prix, code-barres, rattachement aux programmes).
import { esc, fmt, q, qMaj, rpc, tout, erreur, toast, modal, correspond, entier, nombre, csv, telecharger } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  let recherche = '';
  let voirInactifs = false;
  let produits = [];
  let liens = new Set();
  let prixOrigine = new Map(); // « produit:programme » → prix propre à un programme recouvrable
  // Sélection pour supprimer plusieurs éléments d'un coup
  const choixProduits = new Set();
  const choixProgrammes = new Set();

  async function charger() {
    await ctx.rechargerContexte();
    const [p, l] = await Promise.all([
      tout(() => sb.from('produits').select('*').order('designation').order('id')),
      tout(() => sb.from('produits_programmes').select('produit_id, programme_id, prix_vente').order('produit_id').order('programme_id'))
    ]);
    produits = p;
    liens = new Set(l.map((x) => x.produit_id + ':' + x.programme_id));
    prixOrigine = new Map(l.filter((x) => x.prix_vente !== null && x.prix_vente !== undefined).map((x) => [x.produit_id + ':' + x.programme_id, Number(x.prix_vente)]));
  }

  function dessiner() {
    const progs = ctx.programmes;
    const liste = produits.filter((p) => (voirInactifs || p.actif) && correspond(p, recherche));
    const sansPrix = produits.filter((p) => p.actif && liens.has(p.id + ':' + ctx.vente?.id) && !Number(p.prix_vente)).length;

    el.innerHTML = `
      <div class="page-head"><div><h1>Base : programmes et produits</h1>
        <div class="small muted">Créez les programmes une fois, puis cochez pour chaque produit la vente et le ou les programmes qui le fournissent.</div></div></div>

      <section class="card">
        <div class="card-head"><h2>Programmes</h2><div class="inline">
          <button class="btn btn-danger ${choixProgrammes.size ? '' : 'hidden'}" id="suppr-prog">Supprimer (${choixProgrammes.size})</button>
          <button class="btn btn-v" id="nv-prog">+ Nouveau programme</button></div></div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th style="width:36px"><span class="sr">Choisir</span></th><th>Nom</th><th>Sigle</th><th>Type</th><th>Rapport</th><th>Catégories de bénéficiaires</th><th>Envoyer à</th><th class="r">Produits</th><th>État</th><th></th></tr></thead>
          <tbody>${progs.map((g) => `<tr><td>${g.est_vente ? '' : `<input type="checkbox" class="case" data-choix-prog="${g.id}" ${choixProgrammes.has(g.id) ? 'checked' : ''} aria-label="Choisir ${esc(g.nom)}">`}</td><td><strong>${esc(g.nom)}</strong>${g.est_vente ? ' <span class="badge b-ok">Vente</span>' : ''}</td><td class="num">${esc(g.sigle)}</td>
            <td><span class="badge ${g.est_vente ? 'b-ok' : g.recouvrable ? 'b-rec' : 'b-prog'}">${g.est_vente ? 'Vente' : g.recouvrable ? 'Recouvrable (payant)' : 'Gratuit'}</span></td>
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
            <button class="btn btn-danger ${choixProduits.size ? '' : 'hidden'}" id="suppr-prod">Supprimer la sélection (${choixProduits.size})</button>
            <button class="btn btn-p" id="nv-prod">+ Nouveau produit</button>
          </div>
        </div>
        <div class="small muted" style="padding:8px 18px">Les prix et le minimum se modifient directement dans le tableau (enregistrement automatique).</div>
        <div class="table-box"><table class="tbl">
          <thead><tr><th style="width:36px"><input type="checkbox" class="case" id="tout-choisir" aria-label="Choisir tous les produits affichés"></th><th>Produit</th><th>Code-barres</th><th class="r">Prix achat</th><th class="r">Prix vente</th>${progs.filter((g) => g.recouvrable).map((g) => `<th class="r" style="color:var(--bleu)" title="Prix de vente ${esc(g.nom)} (vide = prix de vente normal)">Prix ${esc(g.sigle)}</th>`).join('')}<th class="r">Min.</th>
            ${progs.map((g) => `<th class="${g.est_vente ? '' : 'prog-col'}" style="text-align:center" title="${esc(g.nom)}">${esc(g.est_vente ? 'Vente' : g.sigle)}</th>`).join('')}<th></th></tr></thead>
          <tbody>${liste.map((p) => `<tr style="${p.actif ? '' : 'opacity:.55'}">
            <td><input type="checkbox" class="case" data-choix-prod="${p.id}" ${choixProduits.has(p.id) ? 'checked' : ''} aria-label="Choisir ${esc(p.designation)}"></td>
            <td style="min-width:240px">${esc(p.designation)}${p.presentation ? `<br><span class="small muted">${esc(p.presentation)}</span>` : ''}</td>
            <td class="num small">${esc(p.code_barres || '—')}</td>
            <td class="r"><input class="in num r" style="width:90px" data-champ="prix_achat" data-id="${p.id}" value="${Number(p.prix_achat)}" aria-label="Prix d'achat ${esc(p.designation)}"></td>
            <td class="r"><input class="in num r" style="width:90px;${Number(p.prix_vente) ? '' : 'background:#FFF0CC'}" data-champ="prix_vente" data-id="${p.id}" value="${Number(p.prix_vente)}" aria-label="Prix de vente ${esc(p.designation)}"></td>
            ${progs.filter((g) => g.recouvrable).map((g) => liens.has(p.id + ':' + g.id)
              ? `<td class="r"><input class="in num r" style="width:90px" data-prix-origine="${p.id}:${g.id}" value="${prixOrigine.has(p.id + ':' + g.id) ? prixOrigine.get(p.id + ':' + g.id) : ''}" placeholder="${Number(p.prix_vente)}" aria-label="Prix ${esc(g.sigle)} ${esc(p.designation)}"></td>`
              : '<td class="r muted">—</td>').join('')}
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
        await qMaj(sb.from('produits').update({ [champ]: v }).eq('id', id).select('id'));
        const p = produits.find((x) => x.id === id);
        p[champ] = v;
        i.style.background = champ === 'prix_vente' && !v ? '#FFF0CC' : '#E0F1E8';
        setTimeout(() => { if (i.isConnected && !(champ === 'prix_vente' && !v)) i.style.background = ''; }, 900);
      } catch (e) { erreur(e); }
    });
    // Prix propre à un programme recouvrable (vide = on revient au prix de vente normal)
    el.querySelectorAll('[data-prix-origine]').forEach((i) => i.onchange = async () => {
      const [produit_id, programme_id] = i.dataset.prixOrigine.split(':').map(Number);
      const v = i.value.trim() === '' ? null : nombre(i.value);
      if (v !== null && (Number.isNaN(v) || v < 0)) { toast('Prix invalide.', 'warn'); return; }
      try {
        await qMaj(sb.from('produits_programmes').update({ prix_vente: v }).eq('produit_id', produit_id).eq('programme_id', programme_id).select('produit_id'));
        if (v === null) prixOrigine.delete(i.dataset.prixOrigine); else prixOrigine.set(i.dataset.prixOrigine, v);
        i.style.background = '#E0F1E8';
        setTimeout(() => { if (i.isConnected) i.style.background = ''; }, 900);
      } catch (e) { erreur(e); }
    });
    el.querySelectorAll('[data-lien]').forEach((c) => c.onchange = async () => {
      const [produit_id, programme_id] = c.dataset.lien.split(':').map(Number);
      try {
        if (c.checked) {
          await q(sb.from('produits_programmes').insert({ produit_id, programme_id }));
          liens.add(c.dataset.lien);
        } else {
          await qMaj(sb.from('produits_programmes').delete().eq('produit_id', produit_id).eq('programme_id', programme_id).select('produit_id'));
          liens.delete(c.dataset.lien);
        }
      } catch (e) { c.checked = !c.checked; erreur(e); }
    });
    // Sélection : on met à jour les boutons sans redessiner le tableau (on garde la position dans la liste)
    const majSelection = () => {
      const bp = el.querySelector('#suppr-prod');
      bp.classList.toggle('hidden', !choixProduits.size);
      bp.textContent = `Supprimer la sélection (${choixProduits.size})`;
      const bg = el.querySelector('#suppr-prog');
      bg.classList.toggle('hidden', !choixProgrammes.size);
      bg.textContent = `Supprimer (${choixProgrammes.size})`;
      const tc = el.querySelector('#tout-choisir');
      const nb = liste.filter((p) => choixProduits.has(p.id)).length;
      tc.checked = liste.length > 0 && nb === liste.length;
      tc.indeterminate = nb > 0 && nb < liste.length;
    };
    el.querySelectorAll('[data-choix-prod]').forEach((c) => c.onchange = () => {
      const id = Number(c.dataset.choixProd);
      if (c.checked) choixProduits.add(id); else choixProduits.delete(id);
      majSelection();
    });
    el.querySelectorAll('[data-choix-prog]').forEach((c) => c.onchange = () => {
      const id = Number(c.dataset.choixProg);
      if (c.checked) choixProgrammes.add(id); else choixProgrammes.delete(id);
      majSelection();
    });
    el.querySelector('#tout-choisir').onchange = (e) => {
      for (const p of liste) if (e.target.checked) choixProduits.add(p.id); else choixProduits.delete(p.id);
      el.querySelectorAll('[data-choix-prod]').forEach((c) => { c.checked = e.target.checked; });
      majSelection();
    };
    el.querySelector('#suppr-prod').onclick = () => supprimer('produits');
    el.querySelector('#suppr-prog').onclick = () => supprimer('programmes');
    majSelection();

    el.querySelector('#export').onclick = () => {
      const l = [['Désignation', 'Présentation', 'Code-barres', 'Prix achat', 'Prix vente', 'Minimum', ...ctx.programmes.map((g) => g.sigle), 'Actif']];
      produits.forEach((p) => l.push([p.designation, p.presentation, p.code_barres, p.prix_achat, p.prix_vente, p.stock_min, ...ctx.programmes.map((g) => liens.has(p.id + ':' + g.id) ? 'oui' : ''), p.actif ? 'oui' : 'non']));
      telecharger('produits.csv', csv(l));
    };
  }

  // Suppression d'un ou plusieurs éléments. Le serveur décide pour chacun :
  // jamais utilisé → effacé ; déjà utilisé → masqué (inactif) ; encore du stock → laissé tel quel.
  function supprimer(quoi) {
    const estProduit = quoi === 'produits';
    const ids = [...(estProduit ? choixProduits : choixProgrammes)];
    if (!ids.length) return;
    const noms = ids.map((id) => (estProduit ? produits.find((p) => p.id === id)?.designation : ctx.programmes.find((g) => g.id === id)?.nom)).filter(Boolean);
    const m = modal(`Supprimer ${ids.length} ${estProduit ? 'produit(s)' : 'programme(s)'}`, `
      <ul class="small" style="margin:0;padding-left:18px;max-height:220px;overflow:auto">${noms.slice(0, 30).map((n) => `<li>${esc(n)}</li>`).join('')}${noms.length > 30 ? `<li>… et ${noms.length - 30} autre(s)</li>` : ''}</ul>
      <div class="small" style="line-height:1.5">
        • Ceux qui n’ont <strong>jamais été utilisés</strong> sont effacés.<br>
        • Ceux qui ont déjà un <strong>historique</strong> (ventes, entrées, commandes) sont <strong>masqués</strong> au lieu d’être effacés, pour que vos rapports passés restent justes. Vous pourrez les réactiver.<br>
        • Ceux qui ont <strong>encore du stock</strong> ne sont pas touchés : mettez d’abord leur stock à zéro dans l’Inventaire.
        ${estProduit ? '' : '<br>• Les produits du programme ne sont pas supprimés : ils perdent seulement la case de ce programme.'}
      </div>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Annuler</button><button class="btn btn-p" id="ok" style="background:var(--rouge);border-color:var(--rouge)">Supprimer</button></div>`);
    m.el.querySelector('#ok').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await rpc(sb, estProduit ? 'supprimer_produits' : 'supprimer_programmes', { p_ids: ids });
        m.fermer();
        (estProduit ? choixProduits : choixProgrammes).clear();
        await charger();
        dessiner();
        const liste = (titre, tab, classe) => (tab.length ? `<div class="alert ${classe}" style="font-weight:400"><strong>${titre} (${tab.length})</strong><br>${tab.map(esc).join(', ')}</div>` : '');
        modal('Suppression terminée', `
          ${liste('Effacés', r.supprimes, 'alert-ok')}
          ${liste('Masqués car ils ont un historique (case « Inactifs » pour les revoir)', r.desactives, 'alert-warn')}
          ${liste('Non supprimés car ils ont encore du stock', r.refuses, 'alert-err')}
          ${!r.supprimes.length && !r.desactives.length && !r.refuses.length ? '<div class="muted">Rien n’a changé.</div>' : ''}
          <div class="inline" style="justify-content:flex-end"><button class="btn btn-p" data-fermer>OK</button></div>`);
      } catch (err) { e.target.disabled = false; erreur(err); }
    };
  }

  function ficheProgramme(g) {
    const m = modal(g ? 'Modifier ' + g.nom : 'Nouveau programme', `
      <div><label class="lbl" for="g-nom">Nom</label><input class="in" id="g-nom" value="${esc(g?.nom || '')}" placeholder="Ex. : Tuberculose"></div>
      <div class="grid-2">
        <div><label class="lbl" for="g-sigle">Sigle</label><input class="in" id="g-sigle" value="${esc(g?.sigle || '')}" placeholder="Ex. : PNT" ${g?.est_vente ? 'disabled' : ''}></div>
        <div><label class="lbl" for="g-freq">Rapport</label><select class="in" id="g-freq"><option value="mensuel">Mensuel</option><option value="trimestriel" ${g?.frequence === 'trimestriel' ? 'selected' : ''}>Trimestriel</option></select></div>
      </div>
      ${g?.est_vente ? '' : `<div><label class="lbl" for="g-type">Type</label><select class="in" id="g-type">
        <option value="gratuit">Gratuit : médicaments donnés aux patients</option>
        <option value="recouvrable" ${g?.recouvrable ? 'selected' : ''}>Recouvrable : médicaments vendus, avec leur propre prix et leur propre point</option></select></div>`}
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
      if (!g?.est_vente) {
        ligne.sigle = sigle;
        ligne.recouvrable = m.el.querySelector('#g-type').value === 'recouvrable';
      }
      const actif = m.el.querySelector('#g-actif');
      if (actif) ligne.actif = actif.checked;
      try {
        if (g) await qMaj(sb.from('programmes').update(ligne).eq('id', g.id).select('id'));
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
        if (p) await qMaj(sb.from('produits').update(ligne).eq('id', p.id).select('id'));
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
