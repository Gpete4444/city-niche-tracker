/**
 * Service pages stay only when their slug is on the site-config list.
 * Run: node scripts/test-prune-service-files.mjs
 */
import { pruneFilesToStructure } from '../ops/lib/content-markdown.mjs';

function assert(cond, label) {
  if (!cond) {
    console.error(label);
    process.exit(1);
  }
}

const files = {
  'src/content/pages/index.md': '# Home\n- [Old](/services/old-offer)\n- [Keep](/services/putting-green-installation)\n',
  'src/content/locations/el-mirage.md': '# El Mirage\n',
  'src/content/services/putting-green-installation.md': '---\nserviceName: "Putting green installation"\n---\nKeep\n',
  'src/content/services/dog-park-and-pet-facility-turf.md': '---\nserviceName: "Dog Park and Pet Facility Turf"\n---\nKeep\n',
  'src/content/services/old-offer.md': '---\nserviceName: "Old offer"\n---\nDrop\n',
};

const config = {
  services: ['Putting green installation'],
  commercialServices: ['Dog Park & Pet Facility Turf'],
};

const pruned = pruneFilesToStructure(files, { siteConfig: config });
assert(pruned['src/content/services/putting-green-installation.md'], 'keeps a service on the list');
assert(
  pruned['src/content/services/dog-park-and-pet-facility-turf.md'],
  'keeps a commercial service when & and and slug the same',
);
assert(!pruned['src/content/services/old-offer.md'], 'drops a service that is not on the list');
assert(pruned['src/content/pages/index.md'], 'leaves the homepage alone');
assert(pruned['src/content/locations/el-mirage.md'], 'leaves location pages alone');
assert(files['src/content/services/old-offer.md'], 'does not mutate the input map');

const untouched = pruneFilesToStructure(files, { siteConfig: { services: [], commercialServices: [] } });
assert(untouched['src/content/services/old-offer.md'], 'empty service list does not wipe files');
const missingLists = pruneFilesToStructure(files, { siteConfig: {} });
assert(missingLists['src/content/services/old-offer.md'], 'config with no service names does not wipe files');

console.log('prune service files ok');
