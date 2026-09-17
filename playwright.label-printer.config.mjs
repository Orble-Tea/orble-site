import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mjs";

export default defineConfig({
  ...config,
  projects: config.projects.filter((project) =>
    project.name.startsWith("label-"),
  ),
});
