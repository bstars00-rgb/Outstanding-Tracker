import { mkdir, rm, writeFile } from 'node:fs/promises';
import { buildFixtureModel } from '../fixtures/fixture-model';
import { encryptBundle } from '../../src/app/gate/data-crypto';

/**
 * E2E data: the app only renders published pipeline output (dist/data/*). Build it from the test fixture so the
 * suite never depends on real customer data. `npm run build` must have produced dist/ beforehand.
 * With E2E_GATE_PASSWORD set (gate build under test) only the ENCRYPTED bundle is published, so the gate spec
 * proves password -> key derivation -> decryption end to end.
 */
export default async function globalSetup() {
  const built = await buildFixtureModel('2026-09-05', { lang: 'en' });
  await mkdir('dist/data', { recursive: true });
  const password = process.env.E2E_GATE_PASSWORD;
  if (password) {
    await rm('dist/data/tracker-model.json', { force: true });
    await rm('dist/data/insight.json', { force: true });
    await writeFile('dist/data/bundle.enc.json', JSON.stringify(await encryptBundle(password, { model: built.model, insight: built.insight }, 20_000)));
  } else {
    await rm('dist/data/bundle.enc.json', { force: true });
    await writeFile('dist/data/tracker-model.json', JSON.stringify(built.model));
    await writeFile('dist/data/insight.json', JSON.stringify(built.insight));
  }
}
