// Gestion des comptes par le gérant : création avec identifiant + mot de passe,
// et changement de mot de passe. Les comptes n'ont pas besoin d'adresse e-mail :
// l'identifiant est transformé en adresse interne « identifiant@pharmacie.local ».
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DOMAINE = 'pharmacie.local';
const ROLES = ['gerant', 'responsable', 'vendeur'];
// Même règle que l'application (js/util.js) : au moins 8 caractères, une lettre et un chiffre
const MDP_REGLE = 'Le mot de passe doit faire au moins 8 caractères, avec au moins une lettre et un chiffre.';
const mdpValide = (m: string) => m.length >= 8 && /[A-Za-z]/.test(m) && /\d/.test(m);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reponse({ error: 'Méthode non autorisée.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Qui appelle ? Seul un gérant actif peut gérer les comptes.
  const jeton = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(jeton);
  if (!user) return reponse({ error: 'Vous devez être connecté.' }, 401);
  const { data: moi } = await admin.from('profiles').select('role, actif').eq('id', user.id).maybeSingle();
  if (!moi || !moi.actif || moi.role !== 'gerant') return reponse({ error: 'Réservé au gérant.' }, 403);

  let corps: Record<string, unknown>;
  try {
    corps = await req.json();
  } catch {
    return reponse({ error: 'Requête invalide.' }, 400);
  }

  if (corps.action === 'creer') {
    const identifiant = String(corps.identifiant ?? '').trim().toLowerCase();
    const nom = String(corps.nom ?? '').trim();
    const motDePasse = String(corps.mot_de_passe ?? '');
    const role = String(corps.role ?? 'vendeur');
    if (!/^[a-z0-9._-]{3,30}$/.test(identifiant)) {
      return reponse({ error: 'Identifiant invalide : 3 à 30 caractères, lettres sans accent, chiffres, point, tiret.' }, 400);
    }
    if (!mdpValide(motDePasse)) return reponse({ error: MDP_REGLE }, 400);
    if (!nom || nom.length > 80) return reponse({ error: 'Le nom est obligatoire (80 caractères au plus).' }, 400);
    if (!ROLES.includes(role)) return reponse({ error: 'Rôle invalide.' }, 400);

    const { data: existe } = await admin.from('profiles').select('id').eq('identifiant', identifiant).maybeSingle();
    if (existe) return reponse({ error: 'Cet identifiant est déjà utilisé.' }, 409);

    const { data, error } = await admin.auth.admin.createUser({
      email: `${identifiant}@${DOMAINE}`,
      password: motDePasse,
      email_confirm: true,
      user_metadata: { nom, identifiant },
      app_metadata: { cree_par_gerant: true, role },
    });
    if (error) {
      const deja = /already|registered|exists/i.test(error.message);
      return reponse({ error: deja ? 'Cet identifiant est déjà utilisé.' : error.message }, deja ? 409 : 400);
    }
    // Le mot de passe donné par le gérant est provisoire : la personne choisit le sien à la première connexion
    // (le profil est créé avec doit_changer_mdp = true par le déclencheur creer_profil)
    await admin.from('journal').insert({ user_id: user.id, action: 'utilisateur_cree', details: { identifiant, role } });
    return reponse({ id: data.user.id });
  }

  if (corps.action === 'mot_de_passe') {
    const id = String(corps.id ?? '');
    const motDePasse = String(corps.mot_de_passe ?? '');
    if (!mdpValide(motDePasse)) return reponse({ error: MDP_REGLE }, 400);
    if (id === user.id) return reponse({ error: 'Changez votre propre mot de passe depuis le menu « Mon mot de passe ».' }, 400);
    const { data: cible } = await admin.from('profiles').select('identifiant').eq('id', id).maybeSingle();
    if (!cible) return reponse({ error: 'Utilisateur introuvable.' }, 404);
    const { error } = await admin.auth.admin.updateUserById(id, { password: motDePasse });
    if (error) return reponse({ error: error.message }, 400);
    // Mot de passe provisoire : à remplacer par la personne à sa prochaine connexion
    await admin.from('profiles').update({ doit_changer_mdp: true }).eq('id', id);
    await admin.from('journal').insert({ user_id: user.id, action: 'mot_de_passe_change', details: { identifiant: cible.identifiant ?? id } });
    return reponse({ ok: true });
  }

  return reponse({ error: 'Action inconnue.' }, 400);
});
