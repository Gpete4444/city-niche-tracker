/**
 * Pexels API provider (https://www.pexels.com/api/documentation/)
 */

const API = 'https://api.pexels.com/v1';

function apiKey() {
  return String(process.env.PEXELS_API_KEY || '').trim();
}

export function createPexelsProvider() {
  const key = apiKey();
  return {
    id: 'pexels',
    label: 'Pexels',
    configured: Boolean(key),

    async search(query, { perPage = 12, page = 1 } = {}) {
      if (!key) return [];
      const url = new URL(`${API}/search`);
      url.searchParams.set('query', query);
      url.searchParams.set('per_page', String(Math.min(40, Math.max(1, perPage))));
      url.searchParams.set('page', String(page));
      url.searchParams.set('orientation', 'landscape');
      const res = await fetch(url, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Pexels search failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const results = Array.isArray(data?.photos) ? data.photos : [];
      return results.map((photo) => ({
        provider: 'pexels',
        id: `pexels:${photo.id}`,
        downloadUrl:
          photo?.src?.large2x || photo?.src?.large || photo?.src?.original || photo?.src?.medium,
        thumbUrl: photo?.src?.tiny || photo?.src?.small,
        description: photo?.alt || '',
        photographer: photo?.photographer || 'Unknown',
        pageUrl: photo?.url || `https://www.pexels.com/photo/${photo.id}/`,
        tags: [],
      }));
    },

    async download(photo) {
      if (!photo?.downloadUrl) throw new Error('Pexels photo missing downloadUrl');
      const res = await fetch(photo.downloadUrl, {
        signal: AbortSignal.timeout(45000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Pexels download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        buffer: buf,
        id: photo.id,
        photographer: photo.photographer,
        pageUrl: photo.pageUrl,
        attribution: `Photo: ${photo.photographer} / Pexels`,
        description: photo.description || '',
      };
    },
  };
}
