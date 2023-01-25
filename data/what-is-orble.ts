import type { SectionInfo } from "~/types";

export const info: SectionInfo = {
  id: "what-is-it",
  title: "What is it?",
  body: "Orble is a commercial automated bubble tea machine that can be installed anywhere.",
};

// This is an array, you can add as many points as you want and the site will fill in the grid automatically.
// See https://icones.js.org for available icons.
export const points = [
  {
    icon: "mdi:package-variant",
    heading: "COMPACT",
    text: "An entire store with the footprint of a soda fountain.",
  },
  {
    icon: "mdi:clock-fast",
    heading: "FAST AND AFFORDABLE",
    text: "Machine produces drinks quickly without the labor and rent costs.",
  },
  {
    icon: "mdi:progress-wrench",
    heading: "EASY TO INSTALL AND MAINTAIN",
    text: "Streamlined ingredient stocking, uses standard outlets and water connection.",
  },
];
