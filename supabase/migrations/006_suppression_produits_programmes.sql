-- Pharmacie Simple — suppression de produits et de programmes, un ou plusieurs à la fois.
--
-- Règle : on n'efface jamais l'historique.
--   • jamais utilisé (ni stock, ni vente, ni commande)  → supprimé pour de bon ;
--   • déjà utilisé mais plus de stock                  → désactivé (masqué partout, réactivable) ;
--   • encore du stock                                  → refusé : mettre à zéro par l'Inventaire d'abord.
-- L'origine « Vente » ne se supprime jamais.

create or replace function public.supprimer_produits(p_ids int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
  v_nom text;
  v_supprimes text[] := '{}';
  v_desactives text[] := '{}';
  v_refuses text[] := '{}';
begin
  perform exiger('base');
  foreach v_id in array coalesce(p_ids, '{}'::int[]) loop
    select designation into v_nom from produits where id = v_id for update;
    if not found then
      continue;
    end if;
    if exists (select 1 from lots where produit_id = v_id and quantite > 0) then
      v_refuses := array_append(v_refuses, v_nom);
    elsif exists (select 1 from lots where produit_id = v_id)
       or exists (select 1 from mouvements where produit_id = v_id)
       or exists (select 1 from ventes_lignes where produit_id = v_id)
       or exists (select 1 from commandes_lignes where produit_id = v_id)
       or exists (select 1 from rapports_corrections where produit_id = v_id) then
      update produits set actif = false where id = v_id;
      v_desactives := array_append(v_desactives, v_nom);
    else
      -- ses rattachements aux origines partent avec lui (cascade)
      delete from produits where id = v_id;
      v_supprimes := array_append(v_supprimes, v_nom);
    end if;
  end loop;
  if cardinality(v_supprimes) + cardinality(v_desactives) > 0 then
    perform journaliser('produits_supprimes', jsonb_build_object('supprimes', v_supprimes, 'desactives', v_desactives));
  end if;
  return jsonb_build_object('supprimes', to_jsonb(v_supprimes), 'desactives', to_jsonb(v_desactives), 'refuses', to_jsonb(v_refuses));
end;
$$;

create or replace function public.supprimer_programmes(p_ids int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
  v_prog programmes%rowtype;
  v_supprimes text[] := '{}';
  v_desactives text[] := '{}';
  v_refuses text[] := '{}';
begin
  perform exiger('base');
  foreach v_id in array coalesce(p_ids, '{}'::int[]) loop
    select * into v_prog from programmes where id = v_id for update;
    if not found then
      continue;
    end if;
    if v_prog.est_vente
       or exists (select 1 from lots where programme_id = v_id and quantite > 0) then
      v_refuses := array_append(v_refuses, v_prog.nom);
    elsif exists (select 1 from lots where programme_id = v_id)
       or exists (select 1 from mouvements where programme_id = v_id)
       or exists (select 1 from ventes where programme_id = v_id)
       or exists (select 1 from commandes where programme_id = v_id)
       or exists (select 1 from rapports_corrections where programme_id = v_id) then
      update programmes set actif = false where id = v_id;
      v_desactives := array_append(v_desactives, v_prog.nom);
    else
      -- les produits ne sont pas touchés : seul leur rattachement à ce programme disparaît (cascade)
      delete from programmes where id = v_id;
      v_supprimes := array_append(v_supprimes, v_prog.nom);
    end if;
  end loop;
  if cardinality(v_supprimes) + cardinality(v_desactives) > 0 then
    perform journaliser('programmes_supprimes', jsonb_build_object('supprimes', v_supprimes, 'desactives', v_desactives));
  end if;
  return jsonb_build_object('supprimes', to_jsonb(v_supprimes), 'desactives', to_jsonb(v_desactives), 'refuses', to_jsonb(v_refuses));
end;
$$;

-- Version de la base attendue par l'application
insert into public.parametres (cle, valeur) values ('version_base', '{"version": 6}')
on conflict (cle) do update set valeur = excluded.valeur;

revoke execute on function public.supprimer_produits(int[]) from public, anon;
revoke execute on function public.supprimer_programmes(int[]) from public, anon;
grant execute on function public.supprimer_produits(int[]) to authenticated;
grant execute on function public.supprimer_programmes(int[]) to authenticated;
