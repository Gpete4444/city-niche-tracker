/**
 * Print launched-site leads@ addresses (Rover sends form mail from these).
 * Run: node scripts/list-web3forms-recipients.mjs
 */
import { loadEnvFile } from './lib/dataforseo.mjs';
import { listLaunchedSites } from '../ops/lib/sites.mjs';
import { publicLeadsEmail } from '../ops/lib/site-config.mjs';

loadEnvFile();

const rows = listLaunchedSites().filter((s) => s.domain);
console.log('Rover emails the routing destination from these leads@ addresses.\n');
for (const s of rows) {
  const recipient = publicLeadsEmail(s.email, s.domain);
  console.log(`${s.businessName || s.candidateId}\t${recipient}`);
}
console.log(`\n${rows.length} forms`);
