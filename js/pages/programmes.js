// Programmes : compte rendu mensuel par programme et bénéficiaires par tranche d'âge et sexe.
import { esc, fmt, fmtDateHeure, q, rpc, isoMois, nomMois, imprimer, csv, telecharger, TRANCHES } from '../util.js';

export async function render(el, ctx) {
  const { sb } = ctx;
  const progs = ctx.programmes.filter((p) => !p.est_vente && p.actif);
  if (!progs.length) {
    el.innerHTML = '<div class="alert alert-warn">Aucun programme. Créez-en un dans l’onglet Base.</div>';
    return;
  }
  let progId = progs[0].id;
  let mois = isoMois();

  async function dessiner() {
    const prog = progs.find((p) => p.id === progId);
    const debut = mois + '-01';
    const finMois = new Date(new Date(debut + 'T00:00:00').setMonth(new Date(debut + 'T00:00:00').getMonth() + 1));
    const [rapport, stats, recents] = await Promise.all([
      rpc(sb, 'rapport_mensuel', { p_programme: progId, p_debut: debut }),
      rpc(sb, 'stats_beneficiaires', { p_programme: progId, p_debut: debut }),
      q(sb.from('ventes').select('numero, created_at, patient_nom, patient_age, patient_age_unite, patient_tranche, patient_sexe, annulee, ventes_lignes(quantite, produits(designation))')
        .eq('programme_id', progId).gte('created_at', new Date(debut + 'T00:00:00').toISOString()).lt('created_at', finMois.toISOString())
        .order('created_at', { ascending: false }).limit(30))
    ]);
    const recu = rapport.reduce((s, r) => s + r.recu, 0);
    const donne = rapport.reduce((s, r) => s + r.dispense, 0);
    const benef = stats.reduce((s, r) => s + r.nombre, 0);
    const alertes = rapport.filter((r) => r.stock_disponible <= 0 || r.quantite_commandee > 0).length;
    const lignesTr = TRANCHES.concat(['Non précisée']).map((t) => {
      const c = (sx) => stats.filter((s) => s.tranche === t && s.sexe === sx).reduce((a, s) => a + s.nombre, 0);
      return { t, m: c('M'), f: c('F'), np: c('NP') };
    });
    const tot = lignesTr.reduce((a, r) => ({ m: a.m + r.m, f: a.f + r.f, np: a.np + r.np }), { m: 0, f: 0, np: 0 });

    const tableRapport = (pourImpression) => `
      <table class="${pourImpression ? 'ft' : 'tbl'}">
        <thead><tr><th>Produit</th><th class="r">Stock début</th><th class="r">Reçu</th><th class="r">Donné</th><th class="r">Périmés</th><th class="r">Stock fin</th><th class="r">Jours de rupture</th><th class="r">CMM</th><th class="r">Qté à demander (2CMM − SD)</th></tr></thead>
        <tbody>${rapport.map((r) => `<tr><td>${esc(r.designation)}</td><td class="num r n">${fmt(r.stock_initial)}</td><td class="num r n">${fmt(r.recu)}</td>
          <td class="num r n">${fmt(r.dispense)}</td><td class="num r n">${fmt(r.perimes)}</td><td class="num r n" style="font-weight:700">${fmt(r.stock_disponible)}</td>
          <td class="num r n" style="${r.jours_rupture ? 'color:var(--rouge);font-weight:700' : ''}">${r.jours_rupture}</td><td class="num r n">${String(r.cmm).replace('.', ',')}</td>
          <td class="num r n" style="font-weight:700">${fmt(r.quantite_commandee)}</td></tr>`).join('') || '<tr><td colspan="9">Aucun produit rattaché à ce programme (voir Base).</td></tr>'}</tbody>
      </table>`;
    const tableStats = (pourImpression) => `
      <table class="${pourImpression ? 'ft' : 'tbl'}"><thead><tr><th>Tranche d'âge</th><th class="r">M</th><th class="r">F</th><th class="r">Non précisé</th><th class="r">Total</th></tr></thead>
        <tbody>${lignesTr.map((r) => `<tr><td>${esc(r.t)}</td><td class="num r n">${r.m}</td><td class="num r n">${r.f}</td><td class="num r n">${r.np}</td><td class="num r n" style="font-weight:700">${r.m + r.f + r.np}</td></tr>`).join('')}
        <tr><td style="font-weight:700">Total</td><td class="num r n">${tot.m}</td><td class="num r n">${tot.f}</td><td class="num r n">${tot.np}</td><td class="num r n" style="font-weight:700">${tot.m + tot.f + tot.np}</td></tr></tbody></table>`;

    el.innerHTML = `
      <div class="page-head"><div><h1>Programmes</h1><div class="small muted">Compte rendu préparé automatiquement à partir des dotations reçues et des distributions.</div></div>
        <div class="inline" style="align-items:flex-end">
          <div><label class="lbl" for="mois">Mois</label><input class="in" type="month" id="mois" value="${mois}" max="${isoMois()}"></div>
          <button class="btn" id="csv">Exporter Excel</button><button class="btn btn-v" id="imprimer">Imprimer le compte rendu</button>
        </div></div>
      <div class="origines" role="group" aria-label="Programme">
        ${progs.map((p) => `<button class="org ${p.id === progId ? 'on-v' : ''}" data-prog="${p.id}"><span style="font-weight:700">${esc(p.nom)}</span><span class="small" style="opacity:.85">${esc(p.sigle)} · rapport ${esc(p.frequence)}</span></button>`).join('')}
      </div>
      <section class="grid-kpi">
        <div class="card kpi"><div class="t">Reçu ce mois</div><div class="v">${fmt(recu)}</div><div class="s">unités</div></div>
        <div class="card kpi"><div class="t">Donné ce mois</div><div class="v" style="color:var(--violet)">${fmt(donne)}</div><div class="s">unités</div></div>
        <div class="card kpi"><div class="t">Bénéficiaires</div><div class="v">${benef}</div><div class="s">passages</div></div>
        <div class="card kpi"><div class="t">Produits à demander</div><div class="v" style="color:var(--rouge)">${alertes}</div><div class="s">rupture ou sous le besoin</div></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Rapport ${esc(prog.sigle)} · ${esc(nomMois(mois))}</h2><a class="btn btn-sm" href="#/entree">Réceptionner une dotation</a></div>
        <div class="table-box">${tableRapport(false)}</div>
      </section>
      <div class="row">
        <section class="card" style="flex:1 1 420px"><div class="card-head"><h2>Bénéficiaires par tranche d'âge et sexe</h2></div><div class="table-box">${tableStats(false)}</div></section>
        <section class="card" style="flex:1 1 420px"><div class="card-head"><h2>Dernières distributions</h2><a class="btn btn-sm btn-v" href="#/comptoir">Distribuer</a></div>
          <div class="table-box"><table class="tbl"><tbody>${recents.map((v) => `<tr class="${v.annulee ? 'off' : ''}"><td class="num small">${fmtDateHeure(v.created_at)}</td>
            <td>${esc(v.patient_nom || 'Anonyme')}<br><span class="small muted">${esc([v.patient_age ? v.patient_age + ' ' + v.patient_age_unite : v.patient_tranche, v.patient_sexe !== 'NP' ? v.patient_sexe : ''].filter(Boolean).join(' · '))}</span></td>
            <td class="small">${esc(v.ventes_lignes.map((l) => l.produits?.designation + ' × ' + l.quantite).join(', '))}</td></tr>`).join('') || '<tr><td class="muted">Aucune distribution ce mois.</td></tr>'}</tbody></table></div></section>
      </div>`;

    el.querySelectorAll('[data-prog]').forEach((b) => b.onclick = () => { progId = Number(b.dataset.prog); dessiner(); });
    el.querySelector('#mois').onchange = (e) => { mois = e.target.value || isoMois(); dessiner(); };
    el.querySelector('#imprimer').onclick = () => {
      const ph = ctx.pharmacie;
      imprimer(`<div class="doc">
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:12px">
          <div><div><strong>Région sanitaire :</strong> ${esc(ph.region || '')}</div><div><strong>District sanitaire :</strong> ${esc(ph.district || '')}</div><div><strong>Établissement sanitaire :</strong> ${esc(ph.etablissement || '')}</div></div>
          <div style="text-align:center;font-weight:700;font-size:16px">COMPTE RENDU ${esc(prog.nom.toUpperCase())} (${esc(prog.sigle)})</div>
          <div style="text-align:right"><div><strong>PÉRIODE :</strong> ${esc(nomMois(mois))}</div><div><strong>DATE :</strong> ${new Date().toLocaleDateString('fr-FR')}</div></div>
        </div>
        <div style="margin-top:12px">${tableRapport(true)}</div>
        <h3 style="margin:14px 0 6px">Bénéficiaires par tranche d'âge et sexe</h3>
        <div style="max-width:520px">${tableStats(true)}</div>
        <div style="display:flex;justify-content:space-between;margin-top:28px;font-size:12px"><div>Le gestionnaire de la pharmacie<div style="height:50px"></div></div><div>Le responsable du centre de santé<div style="height:50px"></div></div></div>
      </div>`, { paysage: true });
    };
    el.querySelector('#csv').onclick = () => {
      const l = [['Produit', 'Stock début', 'Reçu', 'Donné', 'Périmés', 'Stock fin', 'Jours de rupture', 'CMM', 'Qté à demander']];
      rapport.forEach((r) => l.push([r.designation, r.stock_initial, r.recu, r.dispense, r.perimes, r.stock_disponible, r.jours_rupture, r.cmm, r.quantite_commandee]));
      l.push([], ['Tranche', 'M', 'F', 'Non précisé', 'Total']);
      lignesTr.forEach((r) => l.push([r.t, r.m, r.f, r.np, r.m + r.f + r.np]));
      telecharger('rapport-' + prog.sigle + '-' + mois + '.csv', csv(l));
    };
  }

  await dessiner();
}
