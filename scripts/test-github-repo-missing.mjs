/**
 * Missing GitHub repo: create command depends on whether origin is already set,
 * and the Launch incomplete copy tells the user to wait, then create and launch.
 * Run: node scripts/test-github-repo-missing.mjs
 */
import { readFileSync } from 'node:fs';
import {
  githubCreateArgs,
  githubPushRejectedHelp,
  githubRepoCreateRateLimitHelp,
  githubRepoMissingHelp,
  isGithubPushRejectedMessage,
  isGithubRepoCreateRateLimitMessage,
  isGithubRepoMissingMessage,
} from '../ops/lib/github-site.mjs';

function assert(ok, label) {
  if (!ok) {
    console.error(label);
    process.exit(1);
  }
}

const fullName = '7D7D/santanvalleyartificialturfpros-com';
const withOrigin = githubCreateArgs(fullName, { isPrivate: true, originExists: true });
const withoutOrigin = githubCreateArgs(fullName, { isPrivate: true, originExists: false });

assert(withOrigin.includes('repo') && withOrigin.includes('create'), 'create command');
assert(withOrigin.includes('--private'), 'missing repo is private');
assert(!withOrigin.includes('--remote=origin'), 'existing origin omits --remote');
assert(!withOrigin.includes('--push'), 'existing origin omits --push');
assert(withoutOrigin.includes('--source=.'), 'no origin still uses --source');
assert(withoutOrigin.includes('--remote=origin'), 'no origin still sets origin');
assert(withoutOrigin.includes('--push'), 'no origin still pushes from create');

const gitError =
  "remote: Repository not found. fatal: repository 'https://github.com/7D7D/santanvalleyartificialturfpros-com.git/' not found";
assert(isGithubRepoMissingMessage(gitError), 'git push not-found is a missing repo');
assert(
  isGithubRepoMissingMessage('Could not resolve to a Repository'),
  'gh repo view 404 is a missing repo',
);
assert(!isGithubRepoMissingMessage('non-fast-forward'), 'diverged push is not a missing repo');

const help = githubRepoMissingHelp(fullName);
assert(help.includes(fullName), 'help names the repo');
assert(/wait about 1 hour until GitHub allows another/i.test(help), 'help says to wait about 1 hour');
assert(help.includes('Create repo and launch'), 'help names the button');
assert(/Run Cloudflare domain \/ email API/i.test(help), 'help mentions the Cloudflare checkbox');

const app = readFileSync(new URL('../ops/public/app.js', import.meta.url), 'utf8');
assert(app.includes('Create repo and launch'), 'dialog and step offer the button');
assert(app.includes('id="ca-launch-create-repo"'), 'Launch step keeps the button');
assert(app.includes('wait about 1 hour until GitHub allows another'), 'dialog uses the wait copy');
assert(
  app.includes("repoMissing || repoRateLimit ? 'Create repo and launch' : pushRejected ? 'Push updates' : 'OK'"),
  'dialog confirm is the retry',
);
assert(app.includes("cancelLabel: 'Not now'"), 'dialog can be dismissed');

const saveRefused =
  "remote: fatal error in commit_refs To https://github.com/7D7D/buckeyeartificialturfpros-com.git ! [remote rejected] HEAD -> main (failure) error: failed to push some refs to 'https://github.com/7D7D/buckeyeartificialturfpros-com.git' failed to run git: exit status 1";
assert(isGithubPushRejectedMessage(saveRefused), 'commit_refs rejection is a GitHub save failure');
assert(!isGithubPushRejectedMessage(gitError), 'a missing repo is not a save refusal');
assert(
  !isGithubPushRejectedMessage('! [rejected] HEAD -> main (non-fast-forward) updates were rejected'),
  'a diverged main branch is not a save refusal',
);
const pushHelp = githubPushRejectedHelp();
assert(pushHelp.includes('GitHub could not save the website'), 'help says GitHub could not save');
assert(pushHelp.includes('Click Push updates'), 'help names Push updates');
assert(/Run Cloudflare domain \/ email API/i.test(pushHelp), 'help says to leave Cloudflare off');
assert(app.includes(pushHelp), 'dialog and Launch step use the same sentence');
assert(app.includes('Website not published yet'), 'dialog title is plain');
assert(app.includes('id="ca-launch-push-rejected"'), 'Launch step keeps the callout');
assert(app.includes('Wait a minute, then click Push updates again'), 'a failed Push updates says to wait and try again');
assert(app.includes("lastLaunchBlocker === 'github-push-rejected'"), 'Launch step reads the saved failure');

const launch = readFileSync(new URL('../ops/lib/launch-site.mjs', import.meta.url), 'utf8');
assert(launch.includes("lastLaunchBlocker = 'github-push-rejected'"), 'launch remembers the GitHub save failure');

const rateLimit =
  'Ship failed: GraphQL: You have created too many repositories, too quickly. Please try again later. (createRepository)';
assert(isGithubRepoCreateRateLimitMessage(rateLimit), 'createRepository rate limit is detected');
assert(!isGithubRepoCreateRateLimitMessage(gitError), 'a missing repo is not a rate limit');
assert(!isGithubRepoMissingMessage(rateLimit), 'a rate limit is not a missing repo');
assert(!isGithubPushRejectedMessage(rateLimit), 'a rate limit is not a save refusal');
const rateHelp = githubRepoCreateRateLimitHelp();
assert(rateHelp.includes('too many, too quickly'), 'help names the limit');
assert(rateHelp.includes('Wait about 1 hour, then click Create repo and launch'), 'help names the next click');
assert(app.includes(rateHelp), 'dialog and Launch step use the same sentence');
assert(app.includes('Repository not created yet'), 'dialog title is plain');
assert(app.includes('id="ca-launch-repo-rate-limit"'), 'Launch step keeps the rate-limit callout');
assert(app.includes("lastLaunchBlocker === 'github-repo-rate-limit'"), 'Launch step reads the saved rate limit');
assert(launch.includes("lastLaunchBlocker = 'github-repo-rate-limit'"), 'launch remembers the rate limit');
const ship = readFileSync(new URL('../ops/lib/ship-site.mjs', import.meta.url), 'utf8');
assert(ship.includes('lastLaunchBlocker: null'), 'successful ship clears the failure');

console.log('test-github-repo-missing: ok');
