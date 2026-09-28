/**
 * Encrypt the latest pipeline output for GitHub Pages.
 *
 *   DATA_PUBLISH_PASSWORD='<gate password>' npx tsx automation/publish-data.ts [automation/out] [public/data/bundle.enc.json]
 *
 * Reads automation/out/tracker-model.json + insight.json, encrypts them with the gate password
 * (see src/app/gate/data-crypto.ts) and writes public/data/bundle.enc.json — the only data file that is
 * committed and deployed. Plaintext JSON under public/data/ stays git-ignored (local preview only).
 * The password must be the same one the site's VITE_GATE_HASH was generated from, otherwise viewers cannot decrypt.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encryptBundle } from '../src/app/gate/data-crypto';

const password = process.env.DATA_PUBLISH_PASSWORD ?? '';
if (!password) {
  console.error('DATA_PUBLISH_PASSWORD is required (the gate password; it is used only in memory and never written).');
  process.exit(2);
}
const outDir = process.argv[2] ?? 'automation/out';
const target = process.argv[3] ?? 'public/data/bundle.enc.json';

const model = JSON.parse(await readFile(join(outDir, 'tracker-model.json'), 'utf8'));
const insight = JSON.parse(await readFile(join(outDir, 'insight.json'), 'utf8'));
const bundle = await encryptBundle(password, { model, insight });
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(bundle));
console.log(`encrypted ${bundle.bytes} bytes (reference date ${model.reference_date}, ${model.invoices?.length ?? '?'} invoices) -> ${target}`);
console.log('next: git add ' + target + ' && git commit -m "data: publish ' + model.reference_date + '" && git push   (viewers re-enter the password once)');
