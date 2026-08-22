/**
 * Pixabay API provider (https://pixabay.com/api/docs/)
 */

const API = 'https://pixabay.com/api/';

function apiKey() {
  return String(process.env.PIXABAY_API_KEY || '').trim();
}

function parseTags(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function createPixabayProvider() {
  const key = apiKey();
  return {
    id: 'pixabay',
    label: 'Pixabay',
    configured: Boolean(key),

    async search(query, { perPage = 12, page = 1 } = {}) {
      if (!key) return [];
      const url = new URL(API);
      url.searchParams.set('key', key);
      url.searchParams.set('q', query);
      url.searchParams.set('image_type', 'photo');
      url.searchParams.set('orientation', 'horizontal');
      url.searchParams.set('safesearch', 'true');
      url.searchParams.set('per_page', String(Math.min(40, Math.max(3, perPage))));
      url.searchParams.set('page', String(Math.max(1, page)));
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Pixabay search failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const results = Array.isArray(data?.hits) ? data.hits : [];
      return results.map((photo) => {
        const tags = parseTags(photo.tags);
        return {
          provider: 'pixabay',
          id: `pixabay:${photo.id}`,
          downloadUrl:
            photo.fullHDURL || photo.largeImageURL || photo.webformatURL || photo.previewURL,
          thumbUrl: photo.previewURL || photo.webformatURL,
          description: tags.join(', ') || '',
          photographer: photo.user || 'Unknown',
          pageUrl: photo.pageURL || `https://pixabay.com/photos/id-${photo.id}/`,
          tags,
        };
      });
    },

    async download(photo) {
      if (!photo?.downloadUrl) throw new Error('Pixabay photo missing downloadUrl');
      const res = await fetch(photo.downloadUrl, {
        signal: AbortSignal.timeout(45000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Pixabay download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        buffer: buf,
        id: photo.id,
        photographer: photo.photographer,
        pageUrl: photo.pageUrl,
        attribution: `Photo: ${photo.photographer} / Pixabay`,
        description: photo.description || '',
      };
    },
  };
}
