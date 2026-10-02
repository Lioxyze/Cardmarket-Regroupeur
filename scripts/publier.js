/*
 * Publie une nouvelle version sur le dépôt GitHub de diffusion (qui ne contient que l'extension prête à l'emploi).
 *
 *   1. augmenter "version" dans manifest.json (ex. 1.0.1)
 *   2. npm run publier -- "Ce qui change dans cette version"
 *
 * Le PC de ton collègue verra la nouvelle version au plus tard 3 heures après (ou à sa prochaine session).
 * Options : --no-push (prépare le commit sans l'envoyer), --skip-tests.
 * Configuration : diffusion.json { "repo": "pseudo/regroupeur-cardmarket", "dossier": "../Cardmarket-Regroupeur-diffusion", "branche": "main" }
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const notes = args.filter((a) => !a.startsWith('--')).join(' ').trim();

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

const cfgPath = path.join(ROOT, 'diffusion.json');
if (!fs.existsSync(cfgPath)) fail('diffusion.json introuvable : il indique le dépôt GitHub de diffusion (voir README, « Mises à jour automatiques »).');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo || '')) fail('diffusion.json : "repo" doit ressembler à "pseudo/regroupeur-cardmarket".');
const dir = path.resolve(ROOT, cfg.dossier || '../Cardmarket-Regroupeur-diffusion');
if (!fs.existsSync(path.join(dir, '.git'))) fail(`Dossier de diffusion introuvable ou sans git : ${dir}`);
const base = cfg.baseUrl || `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branche || 'main'}`;

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const published = path.join(dir, 'version.json');
if (fs.existsSync(published)) {
  const current = JSON.parse(fs.readFileSync(published, 'utf8')).version;
  const newer = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  if (!newer(version, current)) fail(`La version ${version} n'est pas plus récente que celle déjà publiée (${current}) : augmente "version" dans manifest.json.`);
}

// Le shell (nécessaire pour npm.cmd sous Windows) découperait les notes au premier espace : réservé à npm.
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd: cwd || ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });

// 1. Tests et paquet
if (!flag('--skip-tests')) run('npm', ['test']);
run('node', [path.join('scripts', 'build-zip.js')]);
const zipSrc = path.join(ROOT, 'dist', `Regroupeur-pour-Cardmarket-${version}.zip`);
const zip = fs.readFileSync(zipSrc);
fs.writeFileSync(path.join(dir, 'Regroupeur-pour-Cardmarket.zip'), zip);

// 2. version.json : ce que lisent le programme de mise à jour et l'extension
const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
fs.writeFileSync(
  published,
  JSON.stringify({ version, zip: `${base}/Regroupeur-pour-Cardmarket.zip`, sha256, date: new Date().toISOString().slice(0, 10), notes }, null, 2) + '\n'
);

// 3. Scripts d'installation et page d'accueil du dépôt
for (const name of ['installer.ps1', 'mise-a-jour.ps1', 'desinstaller.ps1', 'Installer-Regroupeur.cmd', 'README.md']) {
  let text = fs.readFileSync(path.join(ROOT, 'distribution', name), 'utf8')
    .split(`https://raw.githubusercontent.com/__REPO__/main`)
    .join(base)
    .split('__VERSION_URL__')
    .join(`${base}/version.json`)
    .split('__REPO__')
    .join(cfg.repo)
    .split('__VERSION__')
    .join(version);
  if (/\.(ps1|cmd)$/.test(name)) text = text.replace(/\r?\n/g, '\r\n');
  // Windows PowerShell 5.1 lit les .ps1 sans BOM en ANSI : BOM UTF-8 pour garder les accents.
  const bom = name.endsWith('.ps1') ? '﻿' : '';
  fs.writeFileSync(path.join(dir, name), bom + text, 'utf8');
}
fs.writeFileSync(path.join(dir, '.gitattributes'), '*.zip binary\n*.ps1 -text\n*.cmd -text\n');

console.log(`\nVersion ${version} prête dans ${dir} (SHA-256 ${sha256.slice(0, 16)}…).`);

// 4. Envoi sur GitHub
if (flag('--no-push')) {
  console.log('--no-push : rien n’a été envoyé.');
  process.exit(0);
}
run('git', ['add', '-A'], dir);
run('git', ['commit', '-m', `Version ${version}${notes ? ' : ' + notes : ''}`], dir);
run('git', ['push', '-u', 'origin', 'HEAD'], dir);
console.log(`\nPubliée : https://github.com/${cfg.repo} — les PC équipés la recevront d'ici 3 heures.`);
