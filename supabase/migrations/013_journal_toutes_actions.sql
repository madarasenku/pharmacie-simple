-- Pharmacie Simple — journal de TOUTES les actions (version 1.10.0).
-- Avant : seules les actions sensibles étaient notées (corrections, annulations, prix, caisse, commandes).
-- Maintenant chaque action laisse une ligne lisible (details.texte) : ventes et distributions, entrées de stock
-- (y compris le stock de départ d'un inventaire), produits, programmes, origines cochées, clients, réglages,
-- droits, comptes, corrections du rapport district, sauvegardes, connexions et déconnexions.
-- Tout passe par des déclencheurs : aucune fonction métier existante n'est réécrite. Rien ne s'efface.

create index if not exists journal_action_date_idx on public.journal (action, created_at desc);

-- Montant lisible : 1250 → « 1 250 F »
create or replace function public.fmt_f(n numeric) returns text
language sql immutable set search_path = public as $$
  select replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', ' ') || ' F'
$$;

-- Écrit une ligne du journal avec une phrase lisible (interne : jamais appelée par le site)
create or replace function public.journal_texte(p_action text, p_texte text, p_details jsonb default '{}'::jsonb, p_user uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into journal (user_id, action, details)
  values (coalesce(p_user, auth.uid()), p_action, coalesce(p_details, '{}'::jsonb) || jsonb_build_object('texte', left(p_texte, 600)));
$$;

-- ---------- Ventes et distributions (à la fin de la transaction : lignes et total sont alors connus) ----------
create or replace function public.journal_vente() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_articles text;
  v_nb int;
begin
  select ve.numero, ve.total, ve.mode_paiement, ve.saisie_hors_ligne, ve.created_by, g.sigle, c.nom as client into v
  from ventes ve join programmes g on g.id = ve.programme_id left join clients c on c.id = ve.client_id
  where ve.id = new.id;
  if not found then
    return null;
  end if;
  select coalesce(sum(x.q), 0), string_agg(x.designation || ' × ' || x.q, ', ' order by x.designation) into v_nb, v_articles
  from (select p.designation, sum(vl.quantite)::int as q from ventes_lignes vl join produits p on p.id = vl.produit_id
        where vl.vente_id = new.id group by p.designation) x;
  perform journal_texte(
    case when v.mode_paiement = 'gratuit' then 'distribution' else 'vente' end,
    coalesce(v.numero, '?') || ' · ' || v.sigle || ' · ' || coalesce(left(v_articles, 300), '')
      || case when v.mode_paiement = 'gratuit' then ''
              else ' · ' || fmt_f(v.total) || ' ' || case v.mode_paiement when 'especes' then 'en espèces' when 'momo' then 'par Mobile Money'
                                                                         when 'credit' then 'à crédit' || coalesce(' (' || v.client || ')', '') else v.mode_paiement end end
      || case when v.saisie_hors_ligne then ' · faite hors ligne' else '' end,
    jsonb_build_object('vente', v.numero, 'articles', v_nb),
    v.created_by);
  return null;
end;
$$;
create constraint trigger journal_vente after insert on public.ventes
  deferrable initially deferred for each row execute function public.journal_vente();

-- ---------- Entrées de stock (réception, dotation, stock de départ d'un inventaire) ----------
create or replace function public.journal_entree() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_produit text;
  v_origine text;
  v_lot text;
  v_per date;
  v_commande text;
begin
  select designation into v_produit from produits where id = new.produit_id;
  select sigle into v_origine from programmes where id = new.programme_id;
  select numero, peremption into v_lot, v_per from lots where id = new.lot_id;
  select numero into v_commande from commandes where id = new.commande_id;
  perform journal_texte('entree',
    coalesce(v_produit, '?') || ' · ' || coalesce(v_origine, '?') || ' · +' || new.quantite
      || case when coalesce(v_lot, '') <> '' then ' · lot ' || v_lot else '' end
      || case when v_per is not null then ' · périme ' || to_char(v_per, 'MM/YYYY') else '' end
      || case when new.prix_unitaire is not null then ' · ' || fmt_f(new.prix_unitaire) || ' l’unité' else '' end
      || coalesce(' · ' || nullif(new.fournisseur, ''), '')
      || coalesce(' · commande ' || v_commande, ''),
    jsonb_build_object('produit', new.produit_id, 'quantite', new.quantite));
  return null;
end;
$$;
create trigger journal_entree after insert on public.mouvements
  for each row when (new.type = 'entree') execute function public.journal_entree();

-- ---------- Base : produits, programmes, origines cochées, clients ----------
create or replace function public.journal_base() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch text[] := '{}';
  v_produit text;
  v_origine text;
begin
  if tg_table_name = 'produits' then
    if tg_op = 'INSERT' then
      perform journal_texte('produit_cree', new.designation || ' · achat ' || fmt_f(new.prix_achat) || ' · vente ' || fmt_f(new.prix_vente), jsonb_build_object('produit', new.id));
      return null;
    end if;
    if new.designation is distinct from old.designation then ch := ch || ('nom « ' || old.designation || ' » → « ' || new.designation || ' »'); end if;
    if new.prix_achat is distinct from old.prix_achat then ch := ch || ('prix d''achat ' || fmt_f(old.prix_achat) || ' → ' || fmt_f(new.prix_achat)); end if;
    if new.stock_min is distinct from old.stock_min then ch := ch || ('minimum ' || old.stock_min || ' → ' || new.stock_min); end if;
    if new.code_barres is distinct from old.code_barres then ch := ch || ('code-barres ' || coalesce(new.code_barres, 'retiré')); end if;
    if new.presentation is distinct from old.presentation then ch := ch || ('présentation ' || coalesce(new.presentation, 'retirée')); end if;
    if new.actif is distinct from old.actif then ch := ch || case when new.actif then 'réactivé' else 'désactivé' end; end if;
    -- le prix de vente a déjà son propre journal (déclencheur produits_journal_prix)
    if cardinality(ch) > 0 then
      perform journal_texte('produit_modifie', new.designation || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('produit', new.id));
    end if;

  elsif tg_table_name = 'programmes' then
    if tg_op = 'INSERT' then
      perform journal_texte('programme_cree', new.nom || ' (' || new.sigle || ') · '
        || case when new.est_vente then 'produits recouvrables' when new.recouvrable then 'recouvrable (payant)' else 'gratuit' end, jsonb_build_object('programme', new.id));
      return null;
    end if;
    if new.nom is distinct from old.nom then ch := ch || ('nom « ' || old.nom || ' » → « ' || new.nom || ' »'); end if;
    if new.sigle is distinct from old.sigle then ch := ch || ('sigle ' || old.sigle || ' → ' || new.sigle); end if;
    if new.recouvrable is distinct from old.recouvrable then ch := ch || case when new.recouvrable then 'devient recouvrable (payant)' else 'devient gratuit' end; end if;
    if new.frequence is distinct from old.frequence then ch := ch || ('rapport ' || new.frequence); end if;
    if new.categories is distinct from old.categories then ch := ch || ('catégories : ' || array_to_string(new.categories, ', ')); end if;
    if new.destinataire is distinct from old.destinataire then ch := ch || ('envoyer à ' || coalesce(new.destinataire, '—')); end if;
    if new.actif is distinct from old.actif then ch := ch || case when new.actif then 'réactivé' else 'désactivé' end; end if;
    if cardinality(ch) > 0 then
      perform journal_texte('programme_modifie', new.nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('programme', new.id));
    end if;

  elsif tg_table_name = 'produits_programmes' then
    if tg_op = 'INSERT' then
      select designation into v_produit from produits where id = new.produit_id;
      select sigle into v_origine from programmes where id = new.programme_id;
      perform journal_texte('origine_ajoutee', coalesce(v_produit, '?') || ' : coché ' || coalesce(v_origine, '?'), jsonb_build_object('produit', new.produit_id));
    else
      select designation into v_produit from produits where id = old.produit_id;
      select sigle into v_origine from programmes where id = old.programme_id;
      if v_produit is not null and v_origine is not null then
        perform journal_texte('origine_retiree', v_produit || ' : décoché ' || v_origine, jsonb_build_object('produit', old.produit_id));
      end if;
    end if;

  elsif tg_table_name = 'clients' then
    if tg_op = 'INSERT' then
      perform journal_texte('client_cree', new.nom || coalesce(' · ' || nullif(new.telephone, ''), '') || ' · plafond ' || fmt_f(new.plafond), jsonb_build_object('client', new.id));
      return null;
    end if;
    if new.nom is distinct from old.nom then ch := ch || ('nom « ' || old.nom || ' » → « ' || new.nom || ' »'); end if;
    if new.telephone is distinct from old.telephone then ch := ch || ('téléphone ' || coalesce(new.telephone, 'retiré')); end if;
    if new.plafond is distinct from old.plafond then ch := ch || ('plafond ' || fmt_f(old.plafond) || ' → ' || fmt_f(new.plafond)); end if;
    if cardinality(ch) > 0 then
      perform journal_texte('client_modifie', new.nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('client', new.id));
    end if;
  end if;
  return null;
end;
$$;
create trigger journal_produits after insert or update on public.produits for each row execute function public.journal_base();
create trigger journal_programmes after insert or update on public.programmes for each row execute function public.journal_base();
create trigger journal_produits_programmes after insert or delete on public.produits_programmes for each row execute function public.journal_base();
create trigger journal_clients after insert or update on public.clients for each row execute function public.journal_base();

-- ---------- Réglages, droits, sauvegardes ----------
create or replace function public.journal_parametres() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch text[] := '{}';
  k text;
  noms constant jsonb := '{"vendre": "vendre et encaisser", "entree": "entrée de stock", "credit": "vente à crédit", "programmes": "distribuer",
    "corriger": "corriger le stock", "annuler": "annuler une vente", "prix": "changer les prix", "rapports": "bénéfices et rapports", "base": "modifier la Base"}';
  avant jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    avant := old.valeur;
  end if;
  if new.cle = 'version_base' then
    return null;
  end if;
  if new.cle = 'derniere_sauvegarde' then
    perform journal_texte('sauvegarde', 'Sauvegarde complète téléchargée');
  elsif new.cle like 'droits_%' then
    for k in select jsonb_object_keys(new.valeur) loop
      if (avant ->> k) is distinct from (new.valeur ->> k) then
        ch := ch || (coalesce(noms ->> k, k) || case when (new.valeur ->> k)::boolean then ' : autorisé' else ' : retiré' end);
      end if;
    end loop;
    if cardinality(ch) > 0 then
      perform journal_texte('droits_modifies', 'Droits du rôle ' || replace(new.cle, 'droits_', '') || ' · ' || array_to_string(ch, ' · '));
    end if;
  else
    for k in select jsonb_object_keys(new.valeur) loop
      if (avant ->> k) is distinct from (new.valeur ->> k) then
        ch := ch || (k || ' : ' || coalesce(nullif(new.valeur ->> k, ''), '—'));
      end if;
    end loop;
    if cardinality(ch) > 0 then
      perform journal_texte('reglage_modifie', 'Réglage « ' || new.cle || ' » · ' || array_to_string(ch, ' · '));
    end if;
  end if;
  return null;
end;
$$;
create trigger journal_parametres after insert or update on public.parametres for each row execute function public.journal_parametres();

-- ---------- Comptes : rôle, activation, nom ----------
create or replace function public.journal_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch text[] := '{}';
  roles constant jsonb := '{"gerant": "gérant", "responsable": "responsable", "vendeur": "vendeur"}';
begin
  if new.role is distinct from old.role then ch := ch || ('rôle ' || coalesce(roles ->> old.role, old.role) || ' → ' || coalesce(roles ->> new.role, new.role)); end if;
  if new.actif is distinct from old.actif then ch := ch || case when new.actif then 'compte réactivé' else 'compte désactivé' end; end if;
  if new.nom is distinct from old.nom then ch := ch || ('nom « ' || old.nom || ' » → « ' || new.nom || ' »'); end if;
  if cardinality(ch) > 0 then
    perform journal_texte('compte_modifie', new.nom || ' · ' || array_to_string(ch, ' · '), jsonb_build_object('compte', new.id));
  end if;
  return null;
end;
$$;
create trigger journal_profil after update on public.profiles for each row execute function public.journal_profil();

-- ---------- Quantités corrigées à la main dans le rapport district ----------
create or replace function public.journal_rapport() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pid int;
  v_mois date;
  v_produit text;
begin
  if tg_op = 'DELETE' then
    v_pid := old.produit_id;
    v_mois := old.mois;
  else
    v_pid := new.produit_id;
    v_mois := new.mois;
  end if;
  select designation into v_produit from produits where id = v_pid;
  perform journal_texte('rapport_corrige', coalesce(v_produit, '?') || ' · ' || to_char(v_mois, 'MM/YYYY') || ' · '
    || case when tg_op = 'DELETE' then 'retour au calcul' else 'quantité commandée ' || new.quantite end,
    jsonb_build_object('produit', v_pid));
  return null;
end;
$$;
create trigger journal_rapport after insert or update or delete on public.rapports_corrections for each row execute function public.journal_rapport();

-- ---------- Connexions et déconnexions (appelée par le site) ----------
create or replace function public.journal_connexion(p_evenement text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_membre() then
    return;
  end if;
  if p_evenement not in ('connexion', 'deconnexion') then
    raise exception 'Évènement inconnu.';
  end if;
  -- Un double clic ne fait pas deux lignes
  if exists (select 1 from journal where user_id = auth.uid() and action = p_evenement and created_at > now() - interval '10 seconds') then
    return;
  end if;
  perform journal_texte(p_evenement, case when p_evenement = 'connexion' then 'Connexion' else 'Déconnexion' end);
end;
$$;

insert into public.parametres (cle, valeur) values ('version_base', '{"version": 13}')
on conflict (cle) do update set valeur = excluded.valeur;

-- Fonctions internes (déclencheurs) : jamais appelables depuis le site ; seule journal_connexion l'est
revoke execute on function public.fmt_f(numeric) from public, anon;
revoke execute on function public.journal_texte(text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.journal_vente() from public, anon, authenticated;
revoke execute on function public.journal_entree() from public, anon, authenticated;
revoke execute on function public.journal_base() from public, anon, authenticated;
revoke execute on function public.journal_parametres() from public, anon, authenticated;
revoke execute on function public.journal_profil() from public, anon, authenticated;
revoke execute on function public.journal_rapport() from public, anon, authenticated;
revoke execute on function public.journal_connexion(text) from public, anon;
grant execute on function public.journal_connexion(text) to authenticated;
