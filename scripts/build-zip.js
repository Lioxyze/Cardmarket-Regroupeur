// Deux paquets, uniquement ce que Chrome charge (manifest, background, src, icônes ; ni tests, ni scripts) :
//   dist/Regroupeur-pour-Cardmarket-<version>.zip  à donner directement (dossier + LISEZ-MOI, installation gratuite
//                                                   en « non empaquetée » ; la clé du manifeste fixe l'identifiant)
//   dist/store/regroupeur-<version>.zip            à envoyer au Chrome Web Store ou à Edge Add-ons (sans « key »,
//                                                   que les stores refusent : ils attribuent leur propre identifiant)
// Chemins en « / » (Compress-Archive de Windows PowerShell 5 écrit des « \ » que Chrome ne sait pas lire).
// Usage : node scripts/build-zip.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', 'background.js', 'src', 'icons'];

function files(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).sort().flatMap((f) => files(path.join(rel, f)));
  return [rel.split(path.sep).join('/')];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Date de fabrication réelle : les outils de copie (robocopy…) comparent les dates des fichiers.
const NOW = new Date();
const DOS_TIME = (NOW.getHours() << 11) | (NOW.getMinutes() << 5) | Math.floor(NOW.getSeconds() / 2);
const DOS_DATE = ((NOW.getFullYear() - 1980) << 9) | ((NOW.getMonth() + 1) << 5) | NOW.getDate();

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const list = INCLUDE.flatMap(files);
const entries = list.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }));

// Garde-fous : tout ce que le manifeste référence doit être dans le paquet.
const referenced = [
  manifest.background && manifest.background.service_worker,
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources),
].filter(Boolean);
const missing = referenced.filter((f) => !list.includes(f));
if (missing.length) {
  console.error('Fichiers référencés absents du paquet :', missing.join(', '));
  process.exit(1);
}

function write(rel, list) {
  const out = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip(list));
  console.log(`${rel} — ${list.length} fichiers, ${(fs.statSync(out).size / 1024).toFixed(0)} Ko`);
}

// 1. Paquet à donner : dossier prêt à charger + mode d'emploi (fins de ligne Windows pour le Bloc-notes).
//    La clé publique (store/cle-publique.txt) fixe l'identifiant de l'extension : la personne garde ses listes même si
//    elle déplace le dossier ou installe une mise à jour. Elle n'est pas dans le manifest.json du dépôt, pour ne pas
//    changer l'identifiant (et perdre les données) de l'installation de développement.
const FOLDER = 'Regroupeur-pour-Cardmarket';
const keyed = Object.assign({ key: fs.readFileSync(path.join(ROOT, 'store', 'cle-publique.txt'), 'utf8').trim() }, manifest);
const directEntries = entries.map((e) => (e.name === 'manifest.json' ? { name: e.name, data: Buffer.from(JSON.stringify(keyed, null, 2) + '\n') } : e));
// Diffusion par GitHub (diffusion.json présent) : l'extension sait où vérifier les nouvelles versions.
const diffusionPath = path.join(ROOT, 'diffusion.json');
if (fs.existsSync(diffusionPath)) {
  const cfg = JSON.parse(fs.readFileSync(diffusionPath, 'utf8'));
  const base = cfg.baseUrl || `https://raw.githubusercontent.com/${cfg.repo}/main`;
  const info = { versionUrl: `${base}/version.json`, page: `https://github.com/${cfg.repo}` };
  directEntries.push({ name: 'distribution.json', data: Buffer.from(JSON.stringify(info, null, 2) + '\n') });
}
const readme = fs.readFileSync(path.join(ROOT, 'store', 'LISEZ-MOI.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
write(`dist/${FOLDER}-${manifest.version}.zip`, [
  ...directEntries.map((e) => ({ name: `${FOLDER}/${e.name}`, data: e.data })),
  { name: 'LISEZ-MOI.txt', data: Buffer.from('﻿' + readme, 'utf8') },
]);

// 2. Paquet pour les stores : sans « key »
const storeManifest = Object.assign({}, manifest);
delete storeManifest.key;
write(
  `dist/store/regroupeur-${manifest.version}.zip`,
  entries.map((e) => (e.name === 'manifest.json' ? { name: e.name, data: Buffer.from(JSON.stringify(storeManifest, null, 2) + '\n') } : e))
);
for (const e of entries) console.log('  ' + e.name);
