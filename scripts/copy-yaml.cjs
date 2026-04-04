/**
 * Copy YAML files from clis/ to dist/clis/.
 */
const { readdirSync, copyFileSync, mkdirSync, existsSync, statSync } = require('fs');
const path = require('path');

function walk(src, dst) {
  if (!existsSync(src)) return;
  for (const f of readdirSync(src)) {
    const sp = path.join(src, f);
    const dp = path.join(dst, f);
    if (statSync(sp).isDirectory()) {
      walk(sp, dp);
    } else if (/\.ya?ml$/.test(f)) {
      mkdirSync(path.dirname(dp), { recursive: true });
      copyFileSync(sp, dp);
    }
  }
}

walk('clis', 'dist/clis');

// Copy external CLI registry to dist/
const extSrc = 'src/external-clis.yaml';
if (existsSync(extSrc)) {
  mkdirSync('dist/src', { recursive: true });
  copyFileSync(extSrc, 'dist/src/external-clis.yaml');
}
