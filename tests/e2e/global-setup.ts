import { mkdir, writeFile } from 'node:fs/promises';
import { buildFixtureModel } from '../fixtures/fixture-model';

/**
 * E2E data: the app only renders published pipeline output (dist/data/*.json). Build it from the test fixture
 * so the suite never depends on real customer data. `npm run build` must have produced dist/ beforehand.
 */
export default async function globalSetup() {
  const built = await buildFixtureModel('2026-09-05', { lang: 'en' });
  await mkdir('dist/data', { recursive: true });
  await writeFile('dist/data/tracker-model.json', JSON.stringify(built.model));
  await writeFile('dist/data/insight.json', JSON.stringify(built.insight));
}
