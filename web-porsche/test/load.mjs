// Loads one of the page's TypeScript modules (web-porsche/src/<file>) for a unit test: esbuild bundles
// it to one ES module in memory, imported from a data: URL.  Only modules that need no DOM at import.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(path.join(here, '../../web/package.json'))('esbuild');

export async function load(tsFile) {
  const r = await esbuild.build({
    entryPoints: [path.join(here, '../src', tsFile)], bundle: true, format: 'esm', platform: 'neutral',
    write: false, logLevel: 'silent', target: 'es2022',
  });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
}
export const enc = s => new TextEncoder().encode(s);
export const dec = b => new TextDecoder().decode(b);
