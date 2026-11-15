// Build the Porsche page into web-porsche/dist: the page script, nfsu2-web's host workers and the
// audio worklet (esbuild from web/node_modules: run `npm ci` in web/ once).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(path.join(here, '../web/package.json'))('esbuild');
const DIST = path.join(here, 'dist');
const web = p => path.join(here, '../web/src', p);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
await esbuild.build({
  entryPoints: {
    'main': path.join(here, 'src/main.ts'),
    'ticker': path.join(here, 'src/ticker.ts'),
    'host/game-worker': web('host/game-worker.ts'),
    'host/io-worker': web('host/io-worker.ts'),
    'audio/worklet': web('audio/worklet.ts'),
  },
  outdir: DIST, bundle: true, format: 'esm', target: ['chrome140', 'firefox145'], sourcemap: true,
  minify: !process.env.NOMINIFY, logLevel: 'info', loader: { '.txt': 'text', '.png': 'dataurl' },
});
fs.copyFileSync(path.join(here, 'index.html'), path.join(DIST, 'index.html'));
console.log('page built: web-porsche/dist');
