#!/usr/bin/env node
// Lance toute la suite (chaque fichier *.test.js dans son propre processus, comme labo)
// et renvoie un code de sortie non nul si un test échoue.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
const echecs = [];
for (const t of tests) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, t)], {
      stdio: 'inherit', timeout: 10 * 60000,
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
    });
  } catch { echecs.push(t); }
}
console.log('\n' + '═'.repeat(60));
if (echecs.length) { console.log('ÉCHEC : ' + echecs.join(', ')); process.exit(1); }
console.log(`Tous les tests passent (${tests.length} fichiers).`);
