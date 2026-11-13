// Copies the font files the app uses from @fontsource packages into www/fonts,
// so the app works offline without loading anything from the internet.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const wanted = [
  ['manrope', ['500', '600', '700']],
  ['unbounded', ['600']],
];
let missing = 0;
for (const [family, weights] of wanted) {
  for (const w of weights) {
    for (const subset of ['cyrillic', 'latin']) {
      const file = `${family}-${subset}-${w}-normal.woff2`;
      const src = join('node_modules', '@fontsource', family, 'files', file);
      if (existsSync(src)) {
        copyFileSync(src, join('www', 'fonts', file));
      } else {
        console.warn('Font not found:', src);
        missing++;
      }
    }
  }
}
console.log(missing ? `Copied fonts, ${missing} missing (system font will be used)` : 'Copied all fonts');
