import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function seedModelCatalog(root, t = null) {
  const previous = process.env.CODEX_HOME;
  const codexHome = join(root, 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'models_cache.json'), JSON.stringify({
    fetched_at: new Date().toISOString(),
    models: [{ slug: 'gpt-5.6-sol' }, { slug: 'gpt-6.1-sol' }, { slug: 'gpt-6-astra' }],
  }));
  process.env.CODEX_HOME = codexHome;
  t?.after(() => {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  });
}
