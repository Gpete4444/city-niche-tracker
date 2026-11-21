/**
 * Account setup rows and the short guides beside them.
 * Steps are the short form of docs/ENV-SETUP.md. Links open in a new tab.
 */

function step(text, href, label) {
  return href ? { text, href, label: label || href } : { text };
}

export const ACCOUNT_FIELDS = [
  {
    id: 'sitesFolder',
    env: 'ASSEMBLED_SITES_DIR',
    group: 'This computer',
    label: 'Sites folder',
    secret: false,
    kind: 'path',
    button: 'How to choose this folder',
    guide: {
      title: 'Sites folder',
      steps: [
        step('Pick a folder on the drive where site projects and photos should live. Example: D:\\Rover Sites.'),
        step('Use the real folder. A shortcut still works, and Rover builds from the real path.'),
        step('Click Browse, or paste the full path, then Save.'),
        step('Each site becomes a subfolder. Rover keeps its own dashboard files in a _rover folder inside this one on a new install.'),
      ],
    },
  },
  {
    id: 'DATAFORSEO_LOGIN',
    env: 'DATAFORSEO_LOGIN',
    group: 'Discovery & research',
    label: 'DataForSEO login',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'DataForSEO login',
      steps: [
        step('Open the DataForSEO API access page.', 'https://app.dataforseo.com/api-access', 'DataForSEO API access'),
        step('Sign up or log in.'),
        step('Copy the login. It is usually your email.'),
        step('Paste it into DataForSEO login and Save. Discovery also needs the API password below.'),
      ],
    },
  },
  {
    id: 'DATAFORSEO_PASSWORD',
    env: 'DATAFORSEO_PASSWORD',
    group: 'Discovery & research',
    label: 'DataForSEO API password',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'DataForSEO API password',
      steps: [
        step('Open the DataForSEO API access page.', 'https://app.dataforseo.com/api-access', 'DataForSEO API access'),
        step('Copy the API password shown there. It can differ from the password you use to sign in to the website.'),
        step('Fund SERP and Keywords Data before you run Discovery.'),
        step('Paste the password into DataForSEO API password and Save.'),
        step('API docs, if you want them.', 'https://docs.dataforseo.com/v3/', 'DataForSEO docs'),
      ],
    },
  },
  {
    id: 'ANTHROPIC_API_KEY',
    env: 'ANTHROPIC_API_KEY',
    group: 'Copy & AI',
    label: 'Anthropic API key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Anthropic API key',
      steps: [
        step('Open the Anthropic console.', 'https://console.anthropic.com/', 'Anthropic Console'),
        step('Open Settings, then API keys.', 'https://console.anthropic.com/settings/keys', 'API keys'),
        step('Create a key and copy it. It starts with sk-ant-.'),
        step('Paste it into Anthropic API key and Save.'),
      ],
    },
  },
  {
    id: 'ANTHROPIC_ADMIN_KEY',
    env: 'ANTHROPIC_ADMIN_KEY',
    group: 'Copy & AI',
    label: 'Anthropic admin key',
    secret: true,
    optional: true,
    button: 'How to get this key',
    guide: {
      title: 'Anthropic admin key',
      steps: [
        step('This key is optional. Rover uses it only to show the API credit balance.'),
        step('Open Admin keys.', 'https://console.anthropic.com/settings/admin-keys', 'Admin keys'),
        step('Create an admin key, paste it here, and Save.'),
      ],
    },
  },
  {
    id: 'GOOGLE_MAPS_API_KEY',
    env: 'GOOGLE_MAPS_API_KEY',
    group: 'Address',
    label: 'Google Maps API key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Google Maps API key',
      steps: [
        step('Open Google Cloud Console.', 'https://console.cloud.google.com/', 'Google Cloud Console'),
        step('Create or choose a project.'),
        step('Enable Places API (New).', 'https://console.cloud.google.com/apis/library/places.googleapis.com', 'Places API (New)'),
        step('Enable Geocoding API.', 'https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com', 'Geocoding API'),
        step('Open Credentials, create an API key, and paste it here.', 'https://console.cloud.google.com/apis/credentials', 'Credentials'),
      ],
    },
  },
  {
    id: 'APIFY_TOKEN',
    env: 'APIFY_TOKEN',
    group: 'Address',
    label: 'Apify token',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Apify token',
      steps: [
        step('Open Apify integrations.', 'https://console.apify.com/settings/integrations', 'Apify integrations'),
        step('Copy the API token.'),
        step('Paste it into Apify token and Save.'),
        step('The actor store is where LoopNet and Crexi actors live, if you add those later.', 'https://apify.com/store', 'Apify Store'),
      ],
    },
  },
  {
    id: 'UNSPLASH_ACCESS_KEY',
    env: 'UNSPLASH_ACCESS_KEY',
    group: 'Images',
    label: 'Unsplash access key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Unsplash access key',
      steps: [
        step('Open Unsplash developers and create an application.', 'https://unsplash.com/oauth/applications', 'Unsplash applications'),
        step('Copy the Access Key.'),
        step('Paste it into Unsplash access key and Save. One of Unsplash, Pexels, or Pixabay is enough for stock photos.'),
      ],
    },
  },
  {
    id: 'PEXELS_API_KEY',
    env: 'PEXELS_API_KEY',
    group: 'Images',
    label: 'Pexels API key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Pexels API key',
      steps: [
        step('Open the Pexels API page and request a key.', 'https://www.pexels.com/api/', 'Pexels API'),
        step('Copy the key from the email or the Pexels dashboard.'),
        step('Paste it into Pexels API key and Save.'),
      ],
    },
  },
  {
    id: 'PIXABAY_API_KEY',
    env: 'PIXABAY_API_KEY',
    group: 'Images',
    label: 'Pixabay API key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Pixabay API key',
      steps: [
        step('Open the Pixabay API docs and sign in.', 'https://pixabay.com/api/docs/', 'Pixabay API'),
        step('Copy the API key shown on that page.'),
        step('Paste it into Pixabay API key and Save.'),
      ],
    },
  },
  {
    id: 'OPENAI_API_KEY',
    env: 'OPENAI_API_KEY',
    group: 'Images and phone',
    label: 'OpenAI API key',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'OpenAI API key',
      steps: [
        step('Open OpenAI API keys.', 'https://platform.openai.com/api-keys', 'OpenAI API keys'),
        step('Create a secret key and copy it.'),
        step('Paste it into OpenAI API key and Save. The same key is used for generated photos and phone transcripts.'),
      ],
    },
  },
  {
    id: 'githubOwner',
    env: 'GITHUB_OWNER',
    group: 'Launch',
    label: 'GitHub owner',
    secret: false,
    button: 'How to find this',
    guide: {
      title: 'GitHub owner',
      steps: [
        step('Sign in at GitHub and open your profile. The username in the URL is the owner.'),
        step('Install GitHub CLI once on this computer.', 'https://cli.github.com/', 'GitHub CLI'),
        step('In a terminal, run gh auth login and finish the browser sign-in.', 'https://cli.github.com/manual/gh_auth_login', 'gh auth login'),
        step('Paste the GitHub username into GitHub owner and Save.'),
      ],
    },
  },
  {
    id: 'cloudflareAccountId',
    env: 'CLOUDFLARE_ACCOUNT_ID',
    group: 'Launch',
    label: 'Cloudflare account ID',
    secret: false,
    button: 'How to find this',
    guide: {
      title: 'Cloudflare account ID',
      steps: [
        step('Log in to Cloudflare.', 'https://dash.cloudflare.com/', 'Cloudflare Dashboard'),
        step('Open any site, or the account home. Copy the Account ID from the right-hand column or the URL.'),
        step('Paste it into Cloudflare account ID and Save. The API token is the next field.'),
      ],
    },
  },
  {
    id: 'CLOUDFLARE_API_TOKEN',
    env: 'CLOUDFLARE_API_TOKEN',
    group: 'Launch',
    label: 'Cloudflare API token',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Cloudflare API token',
      steps: [
        step('Open API tokens.', 'https://dash.cloudflare.com/profile/api-tokens', 'Create API token'),
        step('Create a token that can edit Workers, Account Settings, Zone, and Email Routing for the account.'),
        step('Copy the token once. Cloudflare shows it only at creation.'),
        step('Paste it into Cloudflare API token and Save.'),
      ],
    },
  },
  {
    id: 'leadNotifyEmail',
    env: 'LEAD_NOTIFY_EMAIL',
    group: 'Launch',
    label: 'Lead notify email',
    secret: false,
    kind: 'email',
    button: 'How this email is used',
    guide: {
      title: 'Lead notify email',
      steps: [
        step('This is the inbox that receives every site’s form leads. Public visitors still see leads@your-domain.'),
        step('Use a Gmail or other inbox you can open. Cloudflare emails a verification link the first time a destination is new.'),
        step('Paste the address here and Save. You can still type a different destination on one Launch.'),
      ],
    },
  },
  {
    id: 'TWILIO_ACCOUNT_SID',
    env: 'TWILIO_ACCOUNT_SID',
    group: 'Phone',
    label: 'Twilio Account SID',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Twilio Account SID',
      steps: [
        step('Open the Twilio console.', 'https://console.twilio.com/', 'Twilio Console'),
        step('On the account dashboard, copy Account SID.'),
        step('Paste it into Twilio Account SID and Save. The auth token and forwarding number are the next fields.'),
      ],
    },
  },
  {
    id: 'TWILIO_AUTH_TOKEN',
    env: 'TWILIO_AUTH_TOKEN',
    group: 'Phone',
    label: 'Twilio auth token',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Twilio auth token',
      steps: [
        step('Open the Twilio console.', 'https://console.twilio.com/', 'Twilio Console'),
        step('On the account dashboard, reveal and copy Auth Token.'),
        step('Paste it into Twilio auth token and Save.'),
      ],
    },
  },
  {
    id: 'TWILIO_FORWARD_TO',
    env: 'TWILIO_FORWARD_TO',
    group: 'Phone',
    label: 'Forward calls to',
    secret: false,
    button: 'How this number is used',
    guide: {
      title: 'Forward calls to',
      steps: [
        step('This is the real phone that should ring when someone calls a site’s tracking number.'),
        step('Use country code format, for example +15035551212.'),
        step('Paste it into Forward calls to and Save.'),
      ],
    },
  },
  {
    id: 'GOOGLE_GSC_CLIENT_ID',
    env: 'GOOGLE_GSC_CLIENT_ID',
    group: 'Launched metrics',
    label: 'Search Console client ID',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Search Console client ID',
      steps: [
        step('Open Google Cloud credentials.', 'https://console.cloud.google.com/apis/credentials', 'Credentials'),
        step('Enable the Search Console API.', 'https://console.cloud.google.com/apis/library/searchconsole.googleapis.com', 'Search Console API'),
        step('Configure the OAuth consent screen.', 'https://console.cloud.google.com/apis/credentials/consent', 'OAuth consent screen'),
        step('Create an OAuth client of type Desktop, or Web with redirect http://127.0.0.1:8787/api/gsc/oauth/callback.'),
        step('Copy the client ID into Search Console client ID and Save.'),
      ],
    },
  },
  {
    id: 'GOOGLE_GSC_CLIENT_SECRET',
    env: 'GOOGLE_GSC_CLIENT_SECRET',
    group: 'Launched metrics',
    label: 'Search Console client secret',
    secret: true,
    button: 'How to get this key',
    guide: {
      title: 'Search Console client secret',
      steps: [
        step('On the same OAuth client, copy the client secret.', 'https://console.cloud.google.com/apis/credentials', 'Credentials'),
        step('Paste it into Search Console client secret and Save.'),
        step('Then use Connect Search Console in Launched. Rover opens Google on this computer. The refresh token stays in the local research folder.'),
        step('Search Console itself is where you confirm the site.', 'https://search.google.com/search-console', 'Google Search Console'),
      ],
    },
  },
];

export function accountField(id) {
  return ACCOUNT_FIELDS.find((field) => field.id === id) || null;
}

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return { set: false, last4: '' };
  if (text.length <= 4) return { set: true, last4: '' };
  return { set: true, last4: text.slice(-4) };
}
