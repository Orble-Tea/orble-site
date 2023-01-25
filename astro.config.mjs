import { defineConfig } from "astro/config";
import image from "@astrojs/image";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import glsl from "vite-plugin-glsl";

// https://astro.build/config
export default defineConfig({
  site: "https://osiris.cyber.nyu.edu/",
  // ...(process.env.BUILD_ENV === "GITHUB" && {base: "/osiris-site"}),
  integrations: [
    tailwind(),
    image({
      serviceEntryPoint: "@astrojs/image/sharp",
    }),
    sitemap(),
  ],
  vite: {
    css: {
      devSourcemap: true,
    },
    plugins: [glsl(), yaml()],
    ssr: {
      external: ["svgo"],
    },
    server: {
      port: 3000,
    },
  },
});
