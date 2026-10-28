// Crédits : qui doit combien, historique et remboursements.
import { esc, fmt, fmtF, fmtDate, q, rpc, erreur, toast, modal, entier, nombre } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  let choisi = null;
  let voirTous = false;

  async function dessiner() {
    const dettes = await q(sb.from('v_dettes').select('*').order('du', { ascending: false }));
    const liste = dettes.filter((c) => voirTous || Number(c.du) > 0);
    const total = dettes.reduce((s, c) => s + Math.max(0, Number(c.du)), 0);
    const retard = dettes.filter((c) => Number(c.du) > 0 && c.premier_credit && (Date.now() - new Date(c.premier_credit)) > 30 * 86400000);
    if (!choisi && liste.length) choisi = liste[0].client_id;
    const cl = dettes.find((c) => c.client_id === choisi);
    let hist = [];
    if (cl) {
      const [ventes, paiements] = await Promise.all([
        q(sb.from('ventes').select('id, numero, total, created_at, annulee, ventes_lignes(quantite, produits(designation))').eq('client_id', cl.client_id).eq('mode_paiement', 'credit').order('created_at')),
        q(sb.from('credits_paiements').select('*').eq('client_id', cl.client_id).order('created_at'))
      ]);
      hist = [
        ...ventes.map((v) => ({ date: v.created_at, libelle: 'Crédit ' + v.numero + ' · ' + v.ventes_lignes.map((l) => l.produits?.designation + ' × ' + l.quantite).join(', '), montant: Number(v.total), annulee: v.annulee })),
        ...paiements.map((p) => ({ date: p.created_at, libelle: 'Remboursement', montant: -Number(p.montant) }))
      ].sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    el.innerHTML = `
      <div class="page-head"><div><h1>Qui me doit combien ?</h1><div class="small muted">Une vente à crédit se fait au Comptoir (paiement « Crédit »). Les remboursements entrent dans la caisse du jour.</div></div>
        <button class="btn btn-p" id="nouveau">+ Nouveau client</button></div>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Total à recevoir</div><div class="v" style="color:var(--rouge)">${fmt(total)}</div><div class="s">FCFA</div></div>
        <div class="card kpi"><div class="t">Clients avec une dette</div><div class="v">${dettes.filter((c) => Number(c.du) > 0).length}</div><div class="s">personnes</div></div>
        <div class="card kpi"><div class="t">En retard (+30 jours)</div><div class="v" style="color:var(--orange)">${retard.length}</div><div class="s">à relancer</div></div>
      </section>
      <div class="row">
        <section class="col-main card">
          <div class="card-head"><h2>Clients</h2><label class="check small"><input type="checkbox" id="tous" ${voirTous ? 'checked' : ''}> Afficher aussi les clients à jour</label></div>
          <div class="table-box"><table class="tbl"><thead><tr><th>Client</th><th>Téléphone</th><th>Depuis</th><th class="r">Reste dû</th><th>État</th></tr></thead>
            <tbody>${liste.map((c) => {
              const enRetard = retard.includes(c);
              return `<tr class="clic ${c.client_id === choisi ? 'sel' : ''}" data-client="${c.client_id}"><td>${esc(c.nom)}</td><td class="num">${esc(c.telephone || '')}</td>
                <td class="num">${fmtDate(c.premier_credit)}</td><td class="num r" style="font-weight:700">${fmt(c.du)}</td>
                <td><span class="badge ${Number(c.du) <= 0 ? 'b-ok' : enRetard ? 'b-out' : 'b-low'}">${Number(c.du) <= 0 ? 'À jour' : enRetard ? 'En retard' : 'En cours'}</span></td></tr>`;
            }).join('') || '<tr><td colspan="5" class="muted">Aucun crédit en cours.</td></tr>'}</tbody></table></div>
        </section>
        <section class="col-side">
          ${cl ? `<div class="card card-pad stack">
            <div><div class="small muted">Client</div><h2>${esc(cl.nom)}</h2>
              <div class="small">Reste dû : <strong class="num" style="color:var(--rouge)">${fmtF(cl.du)}</strong> · plafond ${fmtF(cl.plafond)}</div></div>
            <div>${hist.map((h) => `<div class="inline small" style="justify-content:space-between;border-bottom:1px solid #EDF1EF;padding:6px 0;flex-wrap:nowrap;${h.annulee ? 'text-decoration:line-through;color:#8A9591' : ''}">
              <span><span class="num muted">${fmtDate(h.date)}</span> · ${esc(h.libelle)}</span>
              <strong class="num" style="color:${h.montant > 0 ? 'var(--rouge)' : '#1A6438'}">${h.montant > 0 ? '+' : '−'}${fmt(Math.abs(h.montant))}</strong></div>`).join('') || '<div class="muted">Aucun mouvement.</div>'}</div>
            ${Number(cl.du) > 0 ? `<div class="inline" style="align-items:flex-end;flex-wrap:nowrap">
              <div style="flex:1"><label class="lbl" for="montant">Montant remboursé</label><input class="in num" id="montant" inputmode="numeric" value="${fmt(cl.du).replace(/\s/g, '')}"></div>
              <button class="btn btn-p" id="rembourser">Encaisser</button></div>` : ''}
            <div class="inline">
              ${cl.telephone && Number(cl.du) > 0 ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(cl.telephone.replace(/\D/g, ''))}?text=${encodeURIComponent('Bonjour ' + cl.nom + ', petit rappel : il reste ' + fmtF(cl.du) + ' à régler à la pharmacie ' + (ctx.pharmacie.nom || '') + '. Merci.')}">Relancer par WhatsApp</a>` : ''}
              <button class="btn btn-sm" id="modifier">Modifier le client</button>
            </div>
          </div>` : '<div class="card card-pad muted">Choisissez un client.</div>'}
        </section>
      </div>`;

    el.querySelector('#tous').onchange = (e) => { voirTous = e.target.checked; dessiner(); };
    el.querySelectorAll('[data-client]').forEach((tr) => tr.onclick = () => { choisi = Number(tr.dataset.client); dessiner(); });
    el.querySelector('#nouveau').onclick = () => fiche(null);
    const mod = el.querySelector('#modifier');
    if (mod) mod.onclick = () => fiche(cl);
    const rb = el.querySelector('#rembourser');
    if (rb) rb.onclick = async () => {
      const montant = nombre(el.querySelector('#montant').value);
      if (!montant || montant <= 0) return toast('Montant invalide.', 'warn');
      try {
        await rpc(sb, 'rembourser_credit', { p_client: cl.client_id, p_montant: montant });
        toast('Remboursement de ' + fmtF(montant) + ' enregistré.');
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  function fiche(c) {
    const m = modal(c ? 'Modifier ' + c.nom : 'Nouveau client', `
      <div><label class="lbl" for="f-nom">Nom</label><input class="in" id="f-nom" value="${esc(c?.nom || '')}"></div>
      <div><label class="lbl" for="f-tel">Téléphone</label><input class="in" id="f-tel" inputmode="tel" value="${esc(c?.telephone || '')}"></div>
      <div><label class="lbl" for="f-pl">Plafond de crédit (F)</label><input class="in num" id="f-pl" inputmode="numeric" value="${c ? Number(c.plafond) : 10000}"></div>
      <button class="btn btn-p" id="f-ok">Enregistrer</button>`);
    m.el.querySelector('#f-ok').onclick = async () => {
      const ligne = { nom: m.el.querySelector('#f-nom').value.trim(), telephone: m.el.querySelector('#f-tel').value.trim() || null, plafond: entier(m.el.querySelector('#f-pl').value) ?? 10000 };
      if (!ligne.nom) return toast('Le nom est obligatoire.', 'warn');
      try {
        if (c) await q(sb.from('clients').update(ligne).eq('id', c.client_id));
        else choisi = (await q(sb.from('clients').insert(ligne).select().single())).id;
        m.fermer();
        voirTous = voirTous || !c;
        dessiner();
      } catch (e) { erreur(e); }
    };
  }

  await dessiner();
}
