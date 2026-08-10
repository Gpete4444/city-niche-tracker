/**
 * CLI: npm run launch-site -- <candidateId> [--skip-cloudflare] [--skip-ship] [--turnstile]
 */
import { launchSite } from './launch-site.mjs';
import { loadEnvFile } from '../../scripts/lib/dataforseo.mjs';

loadEnvFile();

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
if (!id) {
  console.error(
    'Usage: npm run launch-site -- <candidateId> [--skip-cloudflare] [--skip-ship] [--turnstile] [--destination=email]',
  );
  process.exit(1);
}

const skipCf = args.includes('--skip-cloudflare');
const skipShip = args.includes('--skip-ship');
const createTurnstile = args.includes('--turnstile');
const destArg = args.find((a) => a.startsWith('--destination='));
const destinationEmail = destArg ? destArg.slice('--destination='.length) : undefined;

const result = await launchSite(id, {
  runCloudflare: !skipCf,
  ship: !skipShip,
  createTurnstile,
  destinationEmail,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
