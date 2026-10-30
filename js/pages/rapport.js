// Rapport « produits commandes recouvrables » du district, rempli depuis le stock REC (produits recouvrables),
// puis suivi des commandes envoyées (ce qui a été reçu, ce qui reste à recevoir).
import { esc, fmt, fmtF, fmtDate, fmtPeremption, q, rpc, tout, isoJour, isoMois, nomMois, imprimer, csv, telecharger, entier, erreur, toast, modal, confirmer } from '../util.js';

const STATUTS = {
  envoyee: ['Envoyée', 'b-exp'],
  partielle: ['Reçue en partie', 'b-low'],
  soldee: ['Reçue', 'b-ok'],
  annulee: ['Annulée', 'b-neutre']
};

export async function render(el, ctx) {
  const { sb } = ctx;
  const vente = ctx.vente;
  if (!vente) {
    el.innerHTML = '<div class="alert alert-warn">Aucune origine « Vente » n’est configurée.</div>';
    return;
  }
  let mois = isoMois();
  let seulementCommande = false;
  let voirCalcul = true;
  let lignes = [];
  let commandes = [];
  let perimesRayon = []; // mois en cours : lots déjà périmés encore sur l'étagère



  const qte = (r) => r.quantite_commandee;
  const montant = (r) => qte(r) * Number(r.prix_unitaire);

  async function charger() {
    [lignes, commandes, perimesRayon] = await Promise.all([
      rpc(sb, 'rapport_mensuel', { p_programme: vente.id, p_debut: mois + '-01' }),
      tout(() => sb.from('commandes').select('*, commandes_lignes(produit_id, quantite, prix_unitaire, recu, produits(designation))')
        .eq('programme_id', vente.id).order('created_at', { ascending: false }).order('id', { ascending: false })),
      mois === isoMois()
        ? q(sb.from('lots').select('id, produit_id, numero, peremption, quantite').eq('programme_id', vente.id).gt('quantite', 0).lt('peremption', isoJour()).order('peremption'))
        : Promise.resolve([])
    ]);
  }

  function document_(pourImpression) {
    const ph = ctx.pharmacie;
    const visibles = lignes.filter((r) => !seulementCommande || qte(r) > 0);
    const total = visibles.reduce((s, r) => s + montant(r), 0);
    const calc = voirCalcul && !pourImpression;
    return `<div class="doc" ${pourImpression ? '' : 'style="min-width:1100px"'}>
      <div style="display:flex;justify-content:space-between;gap:24px;align-items:flex-start;font-size:12px;line-height:1.6">
        <div><div><strong>Région sanitaire :</strong> ${esc(ph.region || '')}</div><div><strong>District sanitaire :</strong> ${esc(ph.district || '')}</div><div><strong>Établissement sanitaire :</strong> ${esc(ph.etablissement || '')}</div></div>
        <div style="text-align:center;flex:1;font-size:17px;font-weight:700">RAPPORTS PRODUITS COMMANDES RECOUVRABLES</div>
        <div style="text-align:right"><div><strong>PÉRIODE :</strong> ${esc(nomMois(mois))}</div><div><strong>DATE :</strong> ${new Date().toLocaleDateString('fr-FR')}</div></div>
      </div>
      <table class="ft" style="margin-top:14px">
        <thead>
          <tr><th rowspan="2" style="width:30%">DÉSIGNATION</th><th colspan="6">SUIVI DU STOCK</th>${calc ? '<th rowspan="2" class="calc">CMM<br>(3 mois)</th>' : ''}<th colspan="3">BESOINS EXPRIMÉS</th></tr>
          <tr><th>Stock initial<br>(A)</th><th>Qté reçue<br>(B)</th><th>Quantité dispensée dans le mois</th><th>Quantité des périmés</th><th>Stock disponible<br>(SD)</th><th>Nombre de jours de rupture</th>
            <th>Quantité commandée<br>(2CMM − SD)</th><th>Prix unitaire</th><th>MONTANT</th></tr>
        </thead>
        <tbody>
          ${visibles.map((r) => `<tr class="${qte(r) > 0 && !pourImpression ? 'cmd' : ''}">
            <td>${esc(r.designation)}</td><td class="n">${fmt(r.stock_initial)}</td><td class="n">${fmt(r.recu)}</td><td class="n">${fmt(r.dispense)}</td>
            <td class="n">${fmt(r.perimes)}</td><td class="n" style="font-weight:700">${fmt(r.stock_disponible)}</td><td class="n ${r.jours_rupture ? 'rup' : ''}">${r.jours_rupture}</td>
            ${calc ? `<td class="n calc">${String(r.cmm).replace('.', ',')}</td>` : ''}
            <td class="n">${pourImpression ? fmt(qte(r)) : `<label class="sr" for="q-${r.produit_id}">Quantité commandée</label><input id="q-${r.produit_id}" data-q="${r.produit_id}" inputmode="numeric" value="${qte(r)}"
              ${r.corrigee ? `style="background:#FFF0CC" title="Corrigée à la main (calcul : ${r.quantite_calculee})"` : ''}>`}</td>
            <td class="n">${fmt(r.prix_unitaire)}</td><td class="n" style="font-weight:700">${fmt(montant(r))}</td></tr>`).join('')}
          <tr><td colspan="${calc ? 10 : 9}" style="text-align:right;font-weight:700">TOTAL</td><td class="n" style="font-weight:700;font-size:14px" id="total">${fmt(total)}</td></tr>
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:12px"><strong>NB :</strong> La dernière commande urgente est passée au plus tard chaque 25 du mois en cours.</div>
      <div style="display:flex;justify-content:space-between;margin-top:26px;font-size:12px">
        <div>Signature du gestionnaire de la pharmacie du District<div style="height:56px"></div></div>
        <div style="text-align:right">Le responsable du centre de santé<div style="height:56px"></div></div>
      </div>
    </div>`;
  }

  function sectionCommandes() {
    const ouvertes = commandes.filter((c) => c.statut === 'envoyee' || c.statut === 'partielle');
    const autres = commandes.filter((c) => !(c.statut === 'envoyee' || c.statut === 'partielle')).slice(0, 12);
    const carte = (c) => {
      const [txt, badge] = STATUTS[c.statut] || [c.statut, 'b-neutre'];
      const lignesC = c.commandes_lignes || [];
      const reste = lignesC.reduce((s, l) => s + Math.max(0, l.quantite - l.recu), 0);
      return `<tr class="clic" data-commande="${c.id}"><td class="num small">${esc(c.numero)}</td><td>${esc(nomMois(String(c.mois).slice(0, 7)))}</td>
        <td class="small muted">${fmtDate(c.created_at)}</td><td class="num r">${lignesC.length}</td><td class="num r">${fmt(c.total)}</td>
        <td class="num r">${c.statut === 'annulee' ? '—' : fmt(reste)}</td><td><span class="badge ${badge}">${txt}</span></td></tr>`;
    };
    return `<section class="card">
      <div class="card-head"><div><h2>Commandes au district</h2><div class="small muted">Enregistrez la commande le jour où vous l’envoyez ; à la livraison, choisissez-la à l’Entrée de stock : le reste à recevoir se calcule tout seul.</div></div></div>
      <div class="table-box"><table class="tbl"><thead><tr><th>N°</th><th>Période</th><th>Envoyée le</th><th class="r">Produits</th><th class="r">Montant</th><th class="r">Reste à recevoir</th><th>État</th></tr></thead>
        <tbody>${[...ouvertes, ...autres].map(carte).join('') || '<tr><td colspan="7" class="muted">Aucune commande enregistrée.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function dessiner() {
    const aCmd = lignes.filter((r) => qte(r) > 0);
    const total = aCmd.reduce((s, r) => s + montant(r), 0);
    const nbCorrigees = lignes.filter((r) => r.corrigee).length;
    const jour = new Date().getDate();
    const dejaCeMois = commandes.filter((c) => String(c.mois).slice(0, 7) === mois && c.statut !== 'annulee');
    el.innerHTML = `
      <div class="page-head"><div><h1>Rapport produits commandes recouvrables</h1>
        <div class="small muted">Rempli automatiquement depuis le stock ${esc(vente.sigle)} (produits recouvrables). Vous pouvez corriger la quantité commandée avant d'imprimer : la correction est enregistrée pour tous les postes (case jaune).</div></div>
        <div class="inline" style="align-items:flex-end">
          <div><label class="lbl" for="mois">Période</label><input class="in" type="month" id="mois" value="${mois}" max="${isoMois()}"></div>
          <button class="btn" id="csv">Exporter Excel</button>
          <button class="btn btn-p" id="imprimer">Imprimer (A4 paysage)</button>
        </div></div>
      <div class="alert ${mois === isoMois() && jour > 20 && jour <= 25 ? 'alert-err' : 'alert-warn'}">Rappel : la dernière commande urgente se passe au plus tard le 25 du mois. ${aCmd.length} produit(s) à commander pour ${fmt(total)} F.
        ${mois === isoMois() ? ' Mois en cours : les chiffres sont arrêtés à aujourd’hui.' : ''}</div>
      ${perimesRayon.length ? `<div class="signal-perimes"><div class="alert alert-err"><strong>${perimesRayon.length} lot(s) périmé(s) encore en rayon</strong> :
        ${perimesRayon.slice(0, 8).map((l) => `${esc(lignes.find((r) => r.produit_id === l.produit_id)?.designation || 'produit ' + l.produit_id)} (${fmt(l.quantite)}${l.numero ? ', lot ' + esc(l.numero) : ''}, périmé ${fmtPeremption(l.peremption)})`).join(' ; ')}${perimesRayon.length > 8 ? '…' : ''}.
        Retirez-les dans <a href="#/stock">Mon stock</a> (correction, motif « Périmé jeté ») avant d’imprimer : ils seront alors déclarés en « Quantité des périmés ».
        La quantité à commander les exclut déjà, pour ne pas commander trop peu.</div></div>` : ''}
      <div class="inline">
        <button class="chip ${!seulementCommande ? 'on' : ''}" data-f="0">Tous les produits</button>
        <button class="chip ${seulementCommande ? 'on' : ''}" data-f="1">Seulement à commander</button>
        <label class="check"><input type="checkbox" id="calc" ${voirCalcul ? 'checked' : ''}> Afficher le calcul (CMM), à l'écran seulement</label>
        ${nbCorrigees ? `<button class="link" id="reset">Revenir au calcul pour les ${nbCorrigees} case(s) corrigée(s)</button>` : ''}
      </div>
      <div class="table-box card">${document_(false)}</div>
      <details class="small muted"><summary>Comment les colonnes sont calculées</summary>
        <p>A = stock à la fin du mois précédent. B = entrées du mois + stock retrouvé à l’inventaire. Dispensée = ventes du mois moins les ventes annulées.
        Périmés = lots périmés retirés + pertes (casse, manquants d’inventaire). SD = A + B − dispensée − périmés.
        CMM = consommation moyenne des 3 derniers mois (jusqu’à aujourd’hui pour le mois en cours). Quantité commandée = 2 × CMM − stock utilisable
        (le SD sans les lots déjà périmés encore en rayon). Jours de rupture : seulement pour les produits déjà reçus au moins une fois.</p></details>
      <div class="inline" style="justify-content:flex-end">
        ${dejaCeMois.length ? `<span class="small muted">Déjà enregistrée pour ce mois : ${dejaCeMois.map((c) => esc(c.numero)).join(', ')}</span>` : ''}
        <button class="btn btn-p" id="envoyer" ${aCmd.length ? '' : 'disabled'}>Enregistrer la commande envoyée au district</button>
      </div>
      ${sectionCommandes()}`;

    el.querySelector('#mois').onchange = async (e) => {
      mois = e.target.value || isoMois();
      try { await charger(); dessiner(); } catch (err) { erreur(err); }
    };
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { seulementCommande = b.dataset.f === '1'; dessiner(); });
    el.querySelector('#calc').onchange = (e) => { voirCalcul = e.target.checked; dessiner(); };
    const rs = el.querySelector('#reset');
    if (rs) rs.onclick = async () => {
      if (!(await confirmer('Revenir au calcul ?', 'Les quantités corrigées à la main pour ce mois seront remplacées par le calcul 2 × CMM − SD.', 'Revenir au calcul'))) return;
      try {
        for (const r of lignes.filter((x) => x.corrigee)) {
          await rpc(sb, 'corriger_quantite_rapport', { p_programme: vente.id, p_mois: mois + '-01', p_produit: r.produit_id, p_quantite: null });
        }
        await charger();
        dessiner();
      } catch (err) { erreur(err); }
    };
    el.querySelectorAll('[data-q]').forEach((i) => i.onchange = async () => {
      const id = Number(i.dataset.q);
      const r = lignes.find((x) => x.produit_id === id);
      const v = entier(i.value);
      if (i.value.trim() !== '' && (v === null || v < 0)) { toast('Quantité invalide.', 'warn'); i.value = qte(r); return; }
      // Vide ou égale au calcul : on revient au calcul
      const valeur = v === null || v === r.quantite_calculee ? null : v;
      try {
        await rpc(sb, 'corriger_quantite_rapport', { p_programme: vente.id, p_mois: mois + '-01', p_produit: id, p_quantite: valeur });
        r.quantite_commandee = valeur === null ? r.quantite_calculee : valeur;
        r.corrigee = valeur !== null;
        r.montant = r.quantite_commandee * Number(r.prix_unitaire);
        dessiner();
        const suivant = el.querySelector(`#q-${id}`)?.closest('tr')?.nextElementSibling?.querySelector('[data-q]');
        if (suivant) suivant.focus();
      } catch (err) { erreur(err); i.value = qte(r); }
    });
    el.querySelector('#imprimer').onclick = () => imprimer(document_(true), { paysage: true });
    el.querySelector('#csv').onclick = () => {
      const l = [['Désignation', 'Stock initial (A)', 'Qté reçue (B)', 'Qté dispensée', 'Qté périmés', 'Stock disponible (SD)', 'Jours de rupture', 'CMM', 'Qté calculée', 'Qté commandée', 'Prix unitaire', 'Montant']];
      lignes.filter((r) => !seulementCommande || qte(r) > 0).forEach((r) => l.push([r.designation, r.stock_initial, r.recu, r.dispense, r.perimes, r.stock_disponible, r.jours_rupture, r.cmm, r.quantite_calculee, qte(r), r.prix_unitaire, montant(r)]));
      telecharger('commandes-recouvrables-' + mois + '.csv', csv(l));
    };
    el.querySelector('#envoyer').onclick = () => enregistrerCommande(aCmd, total, dejaCeMois).catch(erreur);
    el.querySelectorAll('[data-commande]').forEach((tr) => tr.onclick = () => detailCommande(commandes.find((c) => c.id === Number(tr.dataset.commande))));
  }

  async function enregistrerCommande(aCmd, total, dejaCeMois) {
    if (dejaCeMois.length && !(await confirmer('Une commande existe déjà pour ce mois',
      `${dejaCeMois.map((c) => c.numero).join(', ')} est déjà enregistrée pour ${nomMois(mois)}. Enregistrer une commande supplémentaire ?`, 'Oui, une autre commande'))) return;
    const m = modal('Enregistrer la commande envoyée', `
      <p style="margin:0">${aCmd.length} produit(s) pour <strong>${fmtF(total)}</strong> (période ${esc(nomMois(mois))}).</p>
      <div><label class="lbl" for="note">Note (facultatif)</label><input class="in" id="note" placeholder="ex. envoyée par WhatsApp au gestionnaire"></div>
      <div class="inline" style="justify-content:flex-end"><button class="btn" data-fermer>Annuler</button><button class="btn btn-p" id="ok">Enregistrer</button></div>`);
    m.el.querySelector('#ok').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await rpc(sb, 'enregistrer_commande', { p: {
          programme_id: vente.id, mois: mois + '-01', note: m.el.querySelector('#note').value,
          lignes: aCmd.map((x) => ({ produit_id: x.produit_id, quantite: qte(x), prix_unitaire: Number(x.prix_unitaire) }))
        } });
        m.fermer();
        toast('Commande ' + r.numero + ' enregistrée.');
        await charger();
        dessiner();
      } catch (err) { e.target.disabled = false; erreur(err); }
    };
  }

  function bonDeCommande(c) {
    const ph = ctx.pharmacie;
    return `<div class="doc">
      <div style="display:flex;justify-content:space-between;font-size:12px"><div><strong>${esc(ph.etablissement || '')}</strong><br>District sanitaire : ${esc(ph.district || '')}</div>
        <div style="text-align:right">Commande ${esc(c.numero)}<br>du ${fmtDate(c.created_at)}</div></div>
      <div style="text-align:center;font-size:16px;font-weight:700;margin-top:10px">SUIVI DE COMMANDE — ${esc(nomMois(String(c.mois).slice(0, 7)).toUpperCase())}</div>
      <table class="ft" style="margin-top:12px"><thead><tr><th>Désignation</th><th>Commandé</th><th>Reçu</th><th>Reste</th><th>Prix unitaire</th><th>Montant</th></tr></thead>
        <tbody>${(c.commandes_lignes || []).map((l) => `<tr><td>${esc(l.produits?.designation)}</td><td class="n">${fmt(l.quantite)}</td><td class="n">${fmt(l.recu)}</td>
          <td class="n">${fmt(Math.max(0, l.quantite - l.recu))}</td><td class="n">${fmt(l.prix_unitaire)}</td><td class="n">${fmt(l.quantite * l.prix_unitaire)}</td></tr>`).join('')}
          <tr><td colspan="5" style="text-align:right;font-weight:700">TOTAL</td><td class="n" style="font-weight:700">${fmt(c.total)}</td></tr></tbody></table>
      ${c.note ? `<div style="margin-top:8px;font-size:12px">Note : ${esc(c.note)}</div>` : ''}
    </div>`;
  }

  function detailCommande(c) {
    if (!c) return;
    const [txt, badge] = STATUTS[c.statut] || [c.statut, 'b-neutre'];
    const lignesC = (c.commandes_lignes || []).slice().sort((a, b) => String(a.produits?.designation).localeCompare(String(b.produits?.designation)));
    const m = modal('Commande ' + c.numero, `
      <div class="inline"><span class="badge ${badge}">${txt}</span><span class="small muted">Période ${esc(nomMois(String(c.mois).slice(0, 7)))} · enregistrée le ${fmtDate(c.created_at)}</span></div>
      ${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}
      <div class="table-box"><table class="tbl"><thead><tr><th>Produit</th><th class="r">Commandé</th><th class="r">Reçu</th><th class="r">Reste</th></tr></thead>
        <tbody>${lignesC.map((l) => `<tr><td>${esc(l.produits?.designation)}</td><td class="num r">${fmt(l.quantite)}</td><td class="num r">${fmt(l.recu)}</td>
          <td class="num r" style="font-weight:700;color:${l.recu >= l.quantite ? '#1A6438' : 'var(--orange)'}">${fmt(Math.max(0, l.quantite - l.recu))}</td></tr>`).join('')}</tbody></table></div>
      <div class="inline" style="justify-content:flex-end">
        ${c.statut === 'envoyee' ? '<button class="btn btn-danger" id="annuler">Annuler la commande</button>' : ''}
        ${c.statut === 'partielle' ? '<button class="btn" id="clore">Le reste ne viendra pas : clore</button>' : ''}
        ${c.statut === 'envoyee' || c.statut === 'partielle' ? '<a class="btn" href="#/entree">Réceptionner à l’Entrée</a>' : ''}
        <button class="btn btn-p" id="imp">Imprimer</button>
      </div>`, { large: true });
    m.el.querySelector('#imp').onclick = () => imprimer(bonDeCommande(c));
    const an = m.el.querySelector('#annuler');
    if (an) an.onclick = async () => {
      if (!(await confirmer('Annuler cette commande ?', 'Elle restera visible comme « Annulée ». À faire seulement si elle n’a jamais été envoyée ou si le district l’a refusée.', 'Annuler la commande'))) return;
      try { await rpc(sb, 'annuler_commande', { p_commande: c.id }); m.fermer(); toast('Commande annulée.'); await charger(); dessiner(); } catch (e) { erreur(e); }
    };
    const cl = m.el.querySelector('#clore');
    if (cl) cl.onclick = async () => {
      if (!(await confirmer('Clore la commande ?', 'Le reste non livré ne sera plus attendu. Pensez à le recommander le mois prochain si besoin.', 'Clore'))) return;
      try { await rpc(sb, 'clore_commande', { p_commande: c.id }); m.fermer(); toast('Commande close.'); await charger(); dessiner(); } catch (e) { erreur(e); }
    };
  }

  // Anciennes corrections gardées dans ce navigateur (version 1.0) : envoyées une fois au serveur, puis effacées
  async function reprendreAnciennesCorrections() {
    let cles = [];
    try { cles = Object.keys(localStorage).filter((k) => /^rapport-district-\d{4}-\d{2}$/.test(k)); } catch (_) { return; }
    for (const k of cles) {
      try {
        const corr = JSON.parse(localStorage.getItem(k) || '{}');
        for (const [produit, quantite] of Object.entries(corr)) {
          await rpc(sb, 'corriger_quantite_rapport', { p_programme: vente.id, p_mois: k.slice(-7) + '-01', p_produit: Number(produit), p_quantite: Math.max(0, Number(quantite) || 0) });
        }
        localStorage.removeItem(k);
      } catch (_) { /* on réessaiera à la prochaine ouverture */ }
    }
  }

  await reprendreAnciennesCorrections();
  await charger();
  dessiner();
}
