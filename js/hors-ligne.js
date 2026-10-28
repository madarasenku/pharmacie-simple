// Ventes faites sans internet : gardées sur l'appareil, puis envoyées dès que le réseau revient.
// Chaque vente porte un identifiant unique (ref_client) : si elle est envoyée deux fois
// (coupure au mauvais moment, double clic), le serveur ne l'enregistre qu'une seule fois.
import { local, rpc, estErreurReseau, messageErreur } from './util.js';

const CLE = 'file_ventes';
const abonnes = new Set();

export const lireFile = () => local.lire(CLE, []);

function ecrire(file) {
  if (!local.ecrire(CLE, file)) throw new Error('Impossible d’enregistrer la vente sur cet appareil (stockage indisponible).');
  abonnes.forEach((fn) => { try { fn(file); } catch (_) { /* un abonné ne doit pas bloquer les autres */ } });
}

export const surChangement = (fn) => { abonnes.add(fn); return () => abonnes.delete(fn); };

export function mettreEnFile(charge, resume, utilisateur) {
  const file = lireFile();
  if (file.some((x) => x.ref === charge.ref_client)) return;
  file.push({
    ref: charge.ref_client,
    charge: { ...charge, hors_ligne: true, date_locale: new Date().toISOString() },
    resume,
    utilisateur,
    etat: 'attente',
    erreur: null,
    cree_le: new Date().toISOString()
  });
  ecrire(file);
}

export function retirer(ref) { ecrire(lireFile().filter((x) => x.ref !== ref)); }
export function reessayer(ref) { ecrire(lireFile().map((x) => (x.ref === ref ? { ...x, etat: 'attente', erreur: null } : x))); }
const maj = (ref, champs) => ecrire(lireFile().map((x) => (x.ref === ref ? { ...x, ...champs } : x)));

// Refus passagers : on réessaiera plus tard sans rien demander
const PASSAGER = /Ouvrez la caisse|Session expirée|JWT|reconnectez/i;

let enCours = false;
export async function synchroniser(sb, utilisateur) {
  if (enCours || !navigator.onLine || !utilisateur) return { envoyees: 0 };
  enCours = true;
  let envoyees = 0;
  try {
    for (const item of lireFile()) {
      // Une vente est rejouée par la personne qui l'a faite, avec son propre compte
      if (item.utilisateur !== utilisateur || item.etat === 'erreur') continue;
      try {
        await rpc(sb, 'enregistrer_vente', { p: item.charge });
        retirer(item.ref);
        envoyees++;
      } catch (e) {
        if (estErreurReseau(e)) break;
        const msg = messageErreur(e);
        if (PASSAGER.test(msg)) { maj(item.ref, { erreur: msg }); break; }
        maj(item.ref, { etat: 'erreur', erreur: msg });
      }
    }
  } finally {
    enCours = false;
  }
  return { envoyees };
}
