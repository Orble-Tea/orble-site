// Put the data in here.
const info: SiteInfo = {
  title: "Orble Tea",
  description:
    "Orble is a commercial automated bubble tea machine that can be installed anywhere.",
  preview_image: "machine_render.png",
};

// This is the how the data is structured, what each property is, and it's types.
export interface SiteInfo {
  title: string;
  description: string;
  /**
   * The image displayed in social media previews of the site, for example when sharing a link.
   * It should be relative to the /public folder.
   */
  preview_image: string;
}

export default info;
