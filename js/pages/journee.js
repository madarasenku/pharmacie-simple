// Ma journée : ventes du jour, annulations, réimpression et fermeture de caisse.
import { esc, fmt, fmtF, fmtHeure, fmtDateHeure, q, rpc, erreur, toast, modal, imprimer, isoJour, entier, nombre } from '../util.js';
import { ticketHtml } from './comptoir.js';

const MODES = { especes: 'Espèces', momo: 'Mobile Money', credit: 'Crédit', gratuit: 'Gratuit' };

export async function render(el, ctx) {
  const { sb } = ctx;
  let jour = isoJour();

  async function dessiner() {
    const debut = new Date(jour + 'T00:00:00');
    const fin = new Date(debut.getTime() + 86400000);
    const [ventes, caisse, caissesJour] = await Promise.all([
      q(sb.from('ventes').select('*, clients(nom), ventes_lignes(quantite, prix_unitaire, cout_unitaire, produit_id, produits(designation, prix_vente))')
        .gte('created_at', debut.toISOString()).lt('created_at', fin.toISOString()).order('created_at', { ascending: false })),
      q(sb.from('caisses').select('*').is('fermee_le', null).maybeSingle()),
      q(sb.from('caisses').select('*').gte('ouverte_le', debut.toISOString()).lt('ouverte_le', fin.toISOString()).not('fermee_le', 'is', null).order('fermee_le', { ascending: false }))
    ]);
    const resume = caisse ? await rpc(sb, 'resume_caisse', { p_caisse: caisse.id }) : null;

    const valides = ventes.filter((v) => !v.annulee);
    const vv = valides.filter((v) => v.mode_paiement !== 'gratuit');
    const ca = vv.reduce((s, v) => s + Number(v.total), 0);
    const benef = vv.reduce((s, v) => s + v.ventes_lignes.reduce((t, l) => t + l.quantite * (l.prix_unitaire - l.cout_unitaire), 0), 0);
    const credit = vv.filter((v) => v.mode_paiement === 'credit').reduce((s, v) => s + Number(v.total), 0);
    const distrib = valides.filter((v) => v.mode_paiement === 'gratuit').length;
    const nomOrigine = (id) => { const p = ctx.programmes.find((x) => x.id === id); return p ? (p.est_vente ? 'Vente' : p.sigle) : '?'; };

    el.innerHTML = `
      <div class="page-head"><div><h1>Ma journée</h1><div class="small muted">Ventes, distributions et caisse.</div></div>
        <div><label class="lbl" for="jour">Jour</label><input class="in" type="date" id="jour" value="${jour}" max="${isoJour()}"></div></div>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Ventes</div><div class="v">${vv.length}</div><div class="s">${ventes.length - valides.length} annulée(s)</div></div>
        <div class="card kpi"><div class="t">Chiffre d'affaires</div><div class="v">${fmt(ca)}</div><div class="s">FCFA (crédit compris)</div></div>
        ${ctx.peut('rapports') ? `<div class="card kpi"><div class="t">Bénéfice estimé</div><div class="v" style="color:#1A6438">${fmt(benef)}</div><div class="s">vente − achat</div></div>` : ''}
        <div class="card kpi"><div class="t">Vendu à crédit</div><div class="v" style="color:var(--rouge)">${fmt(credit)}</div><div class="s"><a href="#/credits">Voir les crédits</a></div></div>
        <div class="card kpi"><div class="t">Distributions gratuites</div><div class="v" style="color:var(--violet)">${distrib}</div><div class="s">programmes</div></div>
      </section>
      <div class="row">
        <section class="col-main card">
          <div class="card-head"><h2>Ventes et distributions</h2></div>
          <div class="table-box"><table class="tbl">
            <thead><tr><th>Heure</th><th>N°</th><th>Articles</th><th>Paiement</th><th class="r">Montant</th><th></th></tr></thead>
            <tbody>${ventes.map((v) => `<tr class="${v.annulee ? 'off' : ''}">
              <td class="num">${fmtHeure(v.created_at)}</td><td class="num small">${esc(v.numero)}</td>
              <td>${esc(v.ventes_lignes.map((l) => l.produits?.designation + ' × ' + l.quantite).join(', '))}${v.patient_nom ? `<br><span class="small muted">${esc(v.patient_nom)}</span>` : ''}</td>
              <td><span class="badge ${v.mode_paiement === 'gratuit' ? 'b-prog' : 'b-ok'}">${esc(v.mode_paiement === 'gratuit' ? nomOrigine(v.programme_id) : MODES[v.mode_paiement])}</span>${v.clients ? `<br><span class="small">${esc(v.clients.nom)}</span>` : ''}</td>
              <td class="num r" style="font-weight:600">${v.mode_paiement === 'gratuit' ? '0' : fmt(v.total)}</td>
              <td class="keep"><div class="inline" style="flex-wrap:nowrap">
                ${v.annulee ? `<span class="badge b-out" title="${esc(v.motif_annulation || '')}">Annulée</span>` : `<button class="btn btn-sm" data-reimp="${v.id}">Reçu</button>${ctx.peut('annuler') ? `<button class="btn btn-sm btn-danger" data-annuler="${v.id}">Annuler</button>` : ''}`}
              </div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucune vente ce jour.</td></tr>'}</tbody>
          </table></div>
          ${ctx.peut('annuler') ? '' : '<div class="small muted" style="padding:10px 14px">Pour annuler une vente, demandez au gérant.</div>'}
        </section>

        <section class="col-side">
          <div class="card card-pad stack">
            <h2>Caisse</h2>
            ${caisse ? `
              <div class="small muted">Ouverte le ${fmtDateHeure(caisse.ouverte_le)}</div>
              <dl class="grid-2" style="margin:0;grid-template-columns:1fr auto">
                <dt class="muted">Fond de caisse</dt><dd class="num r" style="margin:0">${fmt(resume.fond)}</dd>
                <dt class="muted">Ventes en espèces</dt><dd class="num r" style="margin:0">${fmt(resume.especes)}</dd>
                <dt class="muted">Remboursements de crédit</dt><dd class="num r" style="margin:0">${fmt(resume.remboursements)}</dd>
                <dt class="muted">Mobile Money (hors tiroir)</dt><dd class="num r" style="margin:0">${fmt(resume.momo)}</dd>
                <dt style="font-weight:700">Espèces attendues</dt><dd class="num r" style="margin:0;font-weight:700">${fmt(Number(resume.fond) + Number(resume.especes) + Number(resume.remboursements))}</dd>
              </dl>
              <div><label class="lbl" for="compte">Espèces comptées dans le tiroir</label><input class="in num" id="compte" inputmode="numeric"></div>
              <div class="alert hidden" id="ecart"></div>
              <button class="btn btn-p btn-big" id="fermer">Fermer la caisse</button>` : `
              <div class="alert alert-warn">La caisse est fermée.</div>
              <div><label class="lbl" for="fond">Fond de caisse (F)</label><input class="in num" id="fond" inputmode="numeric"></div>
              <button class="btn btn-p" id="ouvrir">Ouvrir la caisse</button>`}
            ${caissesJour.map((c) => `<div class="small" style="border-top:1px solid #EDF1EF;padding-top:8px">Fermée à ${fmtHeure(c.fermee_le)} · attendu ${fmtF(c.especes_attendues)} · compté ${fmtF(c.especes_comptees)} ·
              <strong style="color:${Number(c.ecart) === 0 ? '#1A6438' : 'var(--rouge)'}">écart ${fmtF(c.ecart)}</strong></div>`).join('')}
          </div>
        </section>
      </div>`;

    el.querySelector('#jour').onchange = (e) => { jour = e.target.value || isoJour(); dessiner(); };
    el.querySelectorAll('[data-annuler]').forEach((b) => b.onclick = () => annuler(ventes.find((v) => v.id === Number(b.dataset.annuler))));
    el.querySelectorAll('[data-reimp]').forEach((b) => b.onclick = () => {
      const v = ventes.find((x) => x.id === Number(b.dataset.reimp));
      const prog = ctx.programmes.find((p) => p.id === v.programme_id);
      const parProduit = new Map();
      for (const l of v.ventes_lignes) {
        const k = l.produit_id + ':' + l.prix_unitaire;
        const x = parProduit.get(k) || { p: { designation: l.produits?.designation }, n: 0, prix: Number(l.prix_unitaire) };
        x.n += l.quantite;
        parProduit.set(k, x);
      }
      const html = ticketHtml(ctx, { numero: v.numero, total: v.total, programme: prog, mode: v.mode_paiement, recu: v.montant_recu, lignes: [...parProduit.values()],
        patient: { nom: v.patient_nom, age: v.patient_age, unite: v.patient_age_unite, tranche: v.patient_tranche, sexe: v.patient_sexe }, client: v.clients?.nom, date: v.created_at });
      const m = modal('Reçu ' + v.numero, `<div style="border:1px solid var(--bord);border-radius:10px;padding:8px">${html}</div><button class="btn btn-p" id="imp">Imprimer</button>`);
      m.el.querySelector('#imp').onclick = () => imprimer(html);
    });

    const compte = el.querySelector('#compte');
    if (compte) {
      const attendu = Number(resume.fond) + Number(resume.especes) + Number(resume.remboursements);
      compte.oninput = () => {
        const z = el.querySelector('#ecart');
        const n = nombre(compte.value);
        if (n === null) return z.classList.add('hidden');
        const e = n - attendu;
        z.className = 'alert ' + (e === 0 ? 'alert-ok' : e < 0 ? 'alert-err' : 'alert-warn');
        z.textContent = e === 0 ? 'La caisse est juste.' : e < 0 ? 'Il manque ' + fmtF(-e) : 'Il y a ' + fmtF(e) + ' en trop';
      };
      el.querySelector('#fermer').onclick = async () => {
        const n = nombre(compte.value);
        if (n === null) return toast('Saisissez les espèces comptées.', 'warn');
        try {
          const r = await rpc(sb, 'fermer_caisse', { p_especes_comptees: n });
          toast('Caisse fermée. Écart : ' + fmtF(r.ecart), Number(r.ecart) === 0 ? 'ok' : 'warn');
          ctx.majCaisse();
          dessiner();
        } catch (e) { erreur(e); }
      };
    }
    const ouv = el.querySelector('#ouvrir');
    if (ouv) ouv.onclick = async () => {
      try {
        await rpc(sb, 'ouvrir_caisse', { p_fond: entier(el.querySelector('#fond').value) || 0 });
        toast('Caisse ouverte.');
        ctx.majCaisse();
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  function annuler(v) {
    const m = modal('Annuler la vente ' + v.numero, `
      <p style="margin:0">Les produits retournent en stock et le montant (${fmtF(v.total)}) est retiré de la caisse. L'annulation est notée dans le journal.</p>
      <div><label class="lbl" for="motif">Motif</label><select class="in" id="motif"><option>Erreur de produit</option><option>Erreur de quantité</option><option>Le client a rendu les médicaments</option><option>Autre</option></select></div>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Ne pas annuler</button><button class="btn btn-p" id="ok" style="background:var(--rouge);border-color:var(--rouge)">Annuler la vente</button></div>`);
    m.el.querySelector('#ok').onclick = async () => {
      try {
        await rpc(sb, 'annuler_vente', { p_vente_id: v.id, p_motif: m.el.querySelector('#motif').value });
        toast('Vente annulée, stock remis.');
        m.fermer();
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  await dessiner();
}
