// @steered AudibleSecurityContext 1.2 2026-09-14
// Astro config for Playwright test runs only. Identical to astro.config.mjs
// minus the Netlify adapter: adapter dev mode requires Deno, and `astro dev`
// serves server endpoints natively without an adapter. Never used for builds.
import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  site: "https://www.orble-tea.com",
  output: "server",
  devToolbar: { enabled: false },
  integrations: [tailwind(), mdx()],
  vite: {
    plugins: [glsl()],
    ssr: {
      external: ["svgo"],
    },
  },
});
