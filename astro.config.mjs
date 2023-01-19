import { defineConfig } from "astro/config";
import image from "@astrojs/image";
import tailwind from "@astrojs/tailwind";
import glsl from "vite-plugin-glsl";

// https://astro.build/config
export default defineConfig({
  // watch: true,
  site: "http://localhost:3000", // TODO: set site url
  integrations: [
    tailwind(),
    image({
      serviceEntryPoint: "@astrojs/image/sharp",
    }),
  ],
  vite: {
    plugins: [glsl()],
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
