// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import siteConfig from './src/config/site-config.json';
import ensureSitemapXml from './src/integrations/ensure-sitemap-xml.mjs';
import { createUnwrapBusinessSelfLinkPlugin } from './src/lib/unwrap-business-self-link.mjs';
import { createBoldFaqQuestionPlugin } from './src/lib/bold-faq-question.mjs';
import { createLinkifyPhonePlugin } from './src/lib/linkify-prose-phone.mjs';

// https://astro.build/config
export default defineConfig({
  site: `https://${siteConfig.domain}`,
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
    preview: { strictPort: true },
    server: { strictPort: true },
  },
  integrations: [sitemap(), ensureSitemapXml()],
  markdown: {
    processor: satteri({
      mdastPlugins: [
        createUnwrapBusinessSelfLinkPlugin(siteConfig.businessName),
        createLinkifyPhonePlugin({
          businessName: siteConfig.businessName,
          phone: siteConfig.phone,
        }),
        createBoldFaqQuestionPlugin(),
      ],
    }),
  },
});
