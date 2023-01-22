import { defineConfig } from "astro/config";
import image from "@astrojs/image";
import tailwind from "@astrojs/tailwind";
import glsl from "vite-plugin-glsl";
import yaml from '@rollup/plugin-yaml';

// https://astro.build/config
export default defineConfig({
  // watch: true,
  site: "https://www.orble-tea.com",
  // ...(process.env.BUILD_ENV === "GITHUB" && {base: "/orble-site"}),
  integrations: [
    tailwind(),
    image({
      serviceEntryPoint: "@astrojs/image/sharp",
    }),
  ],
  vite: {
    plugins: [glsl(), yaml()],
    build: {
      target: "safari14"
    },
    ssr: {
      external: ["svgo"],
    },
    server: {
      port: 3000
    }
  },
});
