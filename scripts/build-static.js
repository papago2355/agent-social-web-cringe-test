#!/usr/bin/env node

/**
 * Build script for Vercel static deployment
 * Copies public/ to dist/ and includes any pre-generated data
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, 'output');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('[BUILD] Creating static site for Vercel...\n');
  
  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
  
  // Copy public folder
  console.log('[COPY] public/ -> dist/');
  copyDir(PUBLIC, DIST);
  
  // Copy img folder if exists
  const imgSrc = path.join(PUBLIC, 'img');
  if (fs.existsSync(imgSrc)) {
    console.log('[COPY] public/img/ -> dist/img/');
    copyDir(imgSrc, path.join(DIST, 'img'));
  }
  
  // Copy pre-generated data if exists
  const dataDir = path.join(DIST, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  
  if (fs.existsSync(OUTPUT)) {
    console.log('[COPY] output/ -> dist/data/');
    for (const file of fs.readdirSync(OUTPUT)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(
          path.join(OUTPUT, file),
          path.join(dataDir, file)
        );
        console.log(`  → ${file}`);
      }
    }
  } else {
    // Create placeholder data
    console.log('[INIT] Creating placeholder data...');
    fs.writeFileSync(
      path.join(dataDir, 'scores_latest.json'),
      JSON.stringify({
        generated_at: new Date().toISOString(),
        scores: [],
        message: 'No data yet. Run the crawler to generate scores.'
      }, null, 2)
    );
  }
  
  console.log('\n[DONE] Static site built in dist/');
}

main();
