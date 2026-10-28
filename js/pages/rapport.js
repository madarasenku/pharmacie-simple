// Rapport « produits commandes recouvrables » du district, rempli depuis le stock Vente.
import { esc, fmt, rpc, isoMois, nomMois, imprimer, csv, telecharger, entier } from '../util.js';

const CLE = (mois) => 'rapport-district-' + mois;

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
  let corrections = {};

  const lireCorrections = () => {
    try { corrections = JSON.parse(localStorage.getItem(CLE(mois)) || '{}'); } catch (_) { corrections = {}; }
  };
  const ecrireCorrections = () => {
    try { localStorage.setItem(CLE(mois), JSON.stringify(corrections)); } catch (_) { /* navigateur privé */ }
  };

  const qte = (r) => (corrections[r.produit_id] !== undefined ? corrections[r.produit_id] : r.quantite_commandee);
  const montant = (r) => qte(r) * Number(r.prix_unitaire);

  async function charger() {
    lignes = await rpc(sb, 'rapport_mensuel', { p_programme: vente.id, p_debut: mois + '-01' });
    lireCorrections();
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
            <td class="n">${pourImpression ? fmt(qte(r)) : `<label class="sr" for="q-${r.produit_id}">Quantité commandée</label><input id="q-${r.produit_id}" data-q="${r.produit_id}" inputmode="numeric" value="${qte(r)}" ${corrections[r.produit_id] !== undefined ? 'style="background:#FFF0CC"' : ''}>`}</td>
            <td class="n">${fmt(r.prix_unitaire)}</td><td class="n" style="font-weight:700" data-mt="${r.produit_id}">${fmt(montant(r))}</td></tr>`).join('')}
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

  function dessiner() {
    const aCmd = lignes.filter((r) => qte(r) > 0);
    const total = aCmd.reduce((s, r) => s + montant(r), 0);
    const jour = new Date().getDate();
    el.innerHTML = `
      <div class="page-head"><div><h1>Rapport produits commandes recouvrables</h1>
        <div class="small muted">Rempli automatiquement depuis le stock Vente. Vous pouvez corriger la quantité commandée avant d'imprimer (les cases corrigées sont en jaune).</div></div>
        <div class="inline" style="align-items:flex-end">
          <div><label class="lbl" for="mois">Période</label><input class="in" type="month" id="mois" value="${mois}" max="${isoMois()}"></div>
          <button class="btn" id="csv">Exporter Excel</button>
          <button class="btn btn-p" id="imprimer">Imprimer (A4 paysage)</button>
        </div></div>
      <div class="alert ${mois === isoMois() && jour > 20 && jour <= 25 ? 'alert-err' : 'alert-warn'}">Rappel : la dernière commande urgente se passe au plus tard le 25 du mois. ${aCmd.length} produit(s) à commander pour ${fmt(total)} F.</div>
      <div class="inline">
        <button class="chip ${!seulementCommande ? 'on' : ''}" data-f="0">Tous les produits</button>
        <button class="chip ${seulementCommande ? 'on' : ''}" data-f="1">Seulement à commander</button>
        <label class="check"><input type="checkbox" id="calc" ${voirCalcul ? 'checked' : ''}> Afficher le calcul (CMM), à l'écran seulement</label>
        ${Object.keys(corrections).length ? '<button class="link" id="reset">Annuler mes corrections</button>' : ''}
      </div>
      <div class="table-box card">${document_(false)}</div>`;

    el.querySelector('#mois').onchange = async (e) => { mois = e.target.value || isoMois(); await charger(); dessiner(); };
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { seulementCommande = b.dataset.f === '1'; dessiner(); });
    el.querySelector('#calc').onchange = (e) => { voirCalcul = e.target.checked; dessiner(); };
    const rs = el.querySelector('#reset');
    if (rs) rs.onclick = () => { corrections = {}; ecrireCorrections(); dessiner(); };
    el.querySelectorAll('[data-q]').forEach((i) => i.onchange = () => {
      const id = Number(i.dataset.q);
      const r = lignes.find((x) => x.produit_id === id);
      const v = entier(i.value);
      if (v === null || v === r.quantite_commandee) delete corrections[id]; else corrections[id] = Math.max(0, v);
      ecrireCorrections();
      dessiner();
    });
    el.querySelector('#imprimer').onclick = () => imprimer(document_(true), { paysage: true });
    el.querySelector('#csv').onclick = () => {
      const l = [['Désignation', 'Stock initial (A)', 'Qté reçue (B)', 'Qté dispensée', 'Qté périmés', 'Stock disponible (SD)', 'Jours de rupture', 'CMM', 'Qté commandée', 'Prix unitaire', 'Montant']];
      lignes.filter((r) => !seulementCommande || qte(r) > 0).forEach((r) => l.push([r.designation, r.stock_initial, r.recu, r.dispense, r.perimes, r.stock_disponible, r.jours_rupture, r.cmm, qte(r), r.prix_unitaire, montant(r)]));
      telecharger('commandes-recouvrables-' + mois + '.csv', csv(l));
    };
  }

  await charger();
  dessiner();
}
