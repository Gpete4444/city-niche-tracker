/**
 * Unsplash API provider (https://unsplash.com/documentation)
 */

const API = 'https://api.unsplash.com';

function accessKey() {
  return String(process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_ACCESS_KEY_ID || '').trim();
}

export function createUnsplashProvider() {
  const key = accessKey();
  return {
    id: 'unsplash',
    label: 'Unsplash',
    configured: Boolean(key),

    async search(query, { perPage = 12, page = 1 } = {}) {
      if (!key) return [];
      const url = new URL(`${API}/search/photos`);
      url.searchParams.set('query', query);
      url.searchParams.set('per_page', String(Math.min(30, Math.max(1, perPage))));
      url.searchParams.set('page', String(page));
      url.searchParams.set('orientation', 'landscape');
      const res = await fetch(url, {
        headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Unsplash search failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      return results.map((photo) => ({
        provider: 'unsplash',
        id: `unsplash:${photo.id}`,
        downloadUrl:
          photo?.urls?.regular || photo?.urls?.full || photo?.urls?.small || photo?.links?.download,
        thumbUrl: photo?.urls?.thumb || photo?.urls?.small,
        description: photo?.description || photo?.alt_description || '',
        photographer: photo?.user?.name || photo?.user?.username || 'Unknown',
        pageUrl: photo?.links?.html || `https://unsplash.com/photos/${photo.id}`,
        tags: (photo?.tags || []).map((t) => t?.title).filter(Boolean),
      }));
    },

    async download(photo) {
      if (!photo?.downloadUrl) throw new Error('Unsplash photo missing downloadUrl');
      const res = await fetch(photo.downloadUrl, {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(45000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Unsplash download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Trigger download endpoint for Unsplash guidelines when present
      try {
        const trigger = photo.id?.replace(/^unsplash:/, '');
        if (trigger && key) {
          await fetch(`${API}/photos/${trigger}/download`, {
            headers: { Authorization: `Client-ID ${key}` },
            signal: AbortSignal.timeout(8000),
          }).catch(() => {});
        }
      } catch {
        // non-fatal
      }
      return {
        buffer: buf,
        id: photo.id,
        photographer: photo.photographer,
        pageUrl: photo.pageUrl,
        attribution: `Photo: ${photo.photographer} / Unsplash`,
        description: photo.description || '',
      };
    },
  };
}
