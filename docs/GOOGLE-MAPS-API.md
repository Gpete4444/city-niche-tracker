# Google Maps API for Rover

For Rover you only need **two** Google Maps Platform APIs:

1. **Places API (New)** — Address Find / Screen (text search, operational listing check)
2. **Geocoding API** — Maps locality so suburb mismatches go to the Secondary tier

You do **not** need Maps JavaScript, Directions, Static Maps, or the old “Places API” (legacy). Enable **Places API (New)**, not the legacy Places API.

Rover reads one key: `GOOGLE_MAPS_API_KEY` in `.env`. Billing must be on; Google will not serve these APIs without it.

## 1. Google account + Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Project picker (top bar) → **New project**.
3. Name it (e.g. `rover-maps`) → **Create**.
4. Select that project.

## 2. Enable billing (required)

1. Open [Billing](https://console.cloud.google.com/billing) (or the billing prompt on the project).
2. **Link a billing account** (or create one with a card).
3. Confirm the project is linked. Maps calls fail with billing errors until this is done.

Google has a monthly Maps credit; usage above that is pay-as-you-go. Places Text Search is the spendy one (~$32 / 1k on Pro-class text search).

## 3. Enable the two APIs

In the **same** project:

1. Open [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com) → **Enable**.  
   Library name: **Places API (New)** (`places.googleapis.com`).
2. Open [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com) → **Enable**.  
   Library name: **Geocoding API** (`geocoding-backend.googleapis.com`).

You can also do: **APIs & Services → Library** → search each name → **Enable**.

## 4. Create the API key

1. Open [Credentials](https://console.cloud.google.com/apis/credentials).
2. **+ Create credentials** → **API key**.
3. Copy the key (`AIza…`). You can also open it later from the Credentials list.

## 5. Restrict the key (recommended)

On the key’s edit page:

### API restrictions

1. **Restrict key**.
2. Select only:
   - **Places API (New)**
   - **Geocoding API**
3. **Save**.

If **Places API (New)** is missing from the list, it is not enabled yet — go back to [Enable the two APIs](#3-enable-the-two-apis).

### Application restrictions

Rover calls Google from the **server** (`ops/lib/address-screen.mjs`), not the browser. Prefer:

- **IP addresses** → your machine’s public IP (or the server that runs `npm run rover`)

Do **not** use HTTP referrers for this key; that is for browser Maps, and it will break Rover’s server calls.

## 6. Put it in Rover

In the repo `.env`:

```env
GOOGLE_MAPS_API_KEY=AIza…
```

Save, then **restart Rover** (`npm run rover`). Settings → **Site-config · address → Google Maps** should go green when the key is set.

## Not needed for Rover

Maps JavaScript API, Places API (legacy), Street View, and Directions are extra products if you enable them on the same key.

Find addresses also needs Apify (`APIFY_TOKEN` + LoopNet/Crexi actor IDs); Maps alone does not pull listings.

See also [ENV-SETUP.md](./ENV-SETUP.md) section 3a.
