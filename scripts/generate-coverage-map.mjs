import path from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { generateCoverageMapSvg } from '../ops/lib/generate-coverage-map.mjs';

const root = process.cwd();
const config = JSON.parse(
  await readFile(path.join(root, 'src/config/site-config.json'), 'utf8'),
);
const outputPath = path.join(root, 'public/images/coverage-map.svg');
const result = await generateCoverageMapSvg(config, outputPath);
console.log(
  `Generated ${path.relative(root, outputPath)} with ${result.areas} boundaries.`,
);
