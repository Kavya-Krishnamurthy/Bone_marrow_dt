// Bundles the app into single self-contained HTML files:
//   dist/marrow-dose-response.html           standalone page (open directly in a browser)
//   dist/marrow-dose-response.fragment.html  body-only variant for hosts that supply the document skeleton
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers ${a} / ${b} not found`);
  return s.slice(i + a.length, j).trim();
};

// Modules in dependency order. Strip ESM syntax so they share one module scope.
const js = ['src/model.js', 'src/charts.js', 'src/scene.js', 'src/story.js', 'src/app.js']
  .map((p) => `// ---- ${p} ----\n` + read(p)
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(?=(const|function|let|class|async))/gm, ''))
  .join('\n');

const html = read('index.html');
const head = between(html, '<!-- BUILD:HEAD-START -->', '<!-- BUILD:HEAD-END -->');
const body = between(html, '<!-- BUILD:BODY-START -->', '<!-- BUILD:BODY-END -->');
const css = read('styles.css');

const fragment = `${head}\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`;
const standalone = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>\n${css}\n</style>\n</head>\n<body>\n${body}\n<script type="module">\n${js}\n</script>\n</body>\n</html>\n`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/marrow-dose-response.html'), standalone);
writeFileSync(join(root, 'dist/marrow-dose-response.fragment.html'), fragment);
console.log(`Built dist/marrow-dose-response.html (${(standalone.length / 1024).toFixed(0)} KB)`);
