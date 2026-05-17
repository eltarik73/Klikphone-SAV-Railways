#!/usr/bin/env node
/**
 * Synchronise le build Vite (frontend/dist/) vers backend/static/.
 *
 * Pourquoi : Railway sert le frontend depuis backend/static/ (cf. STATIC_DIR
 * dans backend/app/main.py). Sans cette sync, les builds frontend ne sont
 * jamais visibles en prod après un git push — bug subtil et coûteux.
 *
 * Ce script s'exécute automatiquement après `npm run build` (hook npm
 * "postbuild" dans package.json). Pour lancer manuellement :
 *   cd frontend && node scripts/sync-to-backend.mjs
 */

import { rmSync, cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'dist');
const DST = resolve(__dirname, '..', '..', 'backend', 'static');
const DST_ASSETS = resolve(DST, 'assets');

// ─── Sanity check ───────────────────────────────────────────
if (!existsSync(SRC)) {
  console.error(`[sync] ✗ Source absente : ${SRC}`);
  console.error('[sync]   Lance d\'abord `npm run build` (ou ce hook est appelé hors séquence).');
  process.exit(1);
}

// ─── Wipe les anciens assets (Vite ne supprime jamais les vieux hashes) ─
if (existsSync(DST_ASSETS)) {
  const oldCount = readdirSync(DST_ASSETS).length;
  rmSync(DST_ASSETS, { recursive: true, force: true });
  console.log(`[sync] ✓ Nettoyé ${oldCount} anciens fichiers dans backend/static/assets/`);
}

// ─── Copie complète dist/ → backend/static/ ─────────────────
mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true });

// ─── Résumé ─────────────────────────────────────────────────
const newAssets = existsSync(DST_ASSETS) ? readdirSync(DST_ASSETS) : [];
const indexJs = newAssets.find(f => f.startsWith('index-') && f.endsWith('.js'));
const totalKb = newAssets
  .map(f => statSync(resolve(DST_ASSETS, f)).size)
  .reduce((s, b) => s + b, 0) / 1024;

console.log(`[sync] ✓ Copié ${newAssets.length} fichiers (${totalKb.toFixed(0)} KB) → backend/static/`);
console.log(`[sync] ✓ Bundle principal : ${indexJs || '(introuvable !)'}`);
console.log(`[sync]   Prochain git push déploiera ce build sur Railway.`);
