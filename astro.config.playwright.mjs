import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import config from "./astro.config.mjs";

// Browser tests need Astro routes without Netlify's local Edge runtime.
export default defineConfig({
  ...config,
  adapter: node({ mode: "standalone" }),
});
