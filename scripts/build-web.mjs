import { rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}src`;
const output = `${root}dist`;

if (!existsSync(`${source}/index.html`)) {
  console.error('Missing src/index.html, nothing to build.');
  process.exit(1);
}

rmSync(output, { recursive: true, force: true });
cpSync(source, output, { recursive: true });
// Stop GitHub Pages from running Jekyll over the static assets.
writeFileSync(`${output}/.nojekyll`, '');

console.log(`Web build ready in ${output}`);
