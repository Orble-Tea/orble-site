import image from "@astrojs/image";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";
import glsl from "vite-plugin-glsl";

// https://astro.build/config
export default defineConfig({
  site: "http://localhost:3000", // TODO: set site url
  integrations: [
    tailwind(),
    image({
      serviceEntryPoint: "@astrojs/image/sharp",
    }),
  ],
  vite: {
    plugins: [glsl({ watch: false })],
    build: {
      target: "es2017"
    },
    ssr: {
      external: ["svgo"],
    },
  },
});
