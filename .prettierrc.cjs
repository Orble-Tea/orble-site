/** @type {import('prettier').Options;} **/
const config = {
  plugins: [
    "prettier-plugin-astro",
    "prettier-plugin-tailwindcss", // MUST come last
  ],
  pluginSearchDirs: false,
  singleQuote: false,
  // htmlWhitespaceSensitivity: "strict"
};

module.exports = config;
