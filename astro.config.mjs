// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import siteConfig from './src/config/site-config.json';

// https://astro.build/config
export default defineConfig({
  site: `https://${siteConfig.domain}`,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});
