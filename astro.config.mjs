import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import glsl from "vite-plugin-glsl";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  site: "https://www.orble-tea.com",
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  integrations: [
    tailwind(),
    mdx(),
    sitemap(),
  ],
  vite: {
    css: {
      devSourcemap: true,
    },
    plugins: [glsl()],
    ssr: {
      external: ["svgo"],
    },
    server: {
      port: 3000,
    },
  },
});
