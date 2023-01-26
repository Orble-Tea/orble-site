// 1. Import utilities from `astro:content`
import { z, defineCollection } from "astro:content";
// 2. Define your collection(s)
// const sections = defineCollection({
//   schema: z.object({
//     order: z.number(),
//     title: z.ostring(),
//     subtitle: z.ostring(),
//   }),
// });

const whatIsIt = defineCollection({
  schema: z.object({
    order: z.number(),
    icon: z.string(),
    heading: z.string(),
  }),
});
// 3. Export a single `collections` object to register your collection(s)
//    This key should match your collection directory name in "src/content"
export const collections = {
  // "sections": sections,
  "what-is-it": whatIsIt,
};
