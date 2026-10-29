// Version de l'application. À CHAQUE MISE EN LIGNE : changer APP_VERSION ici, dans sw.js (APP_VERSION et CACHE)
// et dans les « ?v= » de index.html. Le test tests/deploiement.test.js échoue si les trois divergent.
export const APP_VERSION = '1.4.0';
// Version de la base de données attendue (dernière migration supabase/migrations/00N_*.sql).
// Si la base est en retard, le gérant voit un bandeau rouge (voir js/app.js).
export const VERSION_BASE = 7;
