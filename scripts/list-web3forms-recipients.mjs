/**
 * Print launched-site Web3Forms Recipient Emails (leads@domain).
 * Run: node scripts/list-web3forms-recipients.mjs
 */
import { loadEnvFile } from './lib/dataforseo.mjs';
import { listLaunchedSites } from '../ops/lib/sites.mjs';
import { publicLeadsEmail } from '../ops/lib/site-config.mjs';

loadEnvFile();

const rows = listLaunchedSites().filter((s) => s.domain);
console.log('Set Web3Forms Recipient Emails to leads@ this domain — not the account Gmail.\n');
for (const s of rows) {
  const recipient = publicLeadsEmail(s.email, s.domain);
  console.log(`${s.businessName || s.candidateId}\t${recipient}`);
}
console.log(`\n${rows.length} forms`);
