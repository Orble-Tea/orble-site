export interface NavItem {
  /** The section ID used for things like links and nav items. */
  id: string;
  title?: string;
}

export interface SectionInfo extends NavItem {
  subtitle?: string;
  Body?: AstroComponentFactory;
}

export interface CompatibilityItem {
  icon: string;
  title: string;
  url: string;
}

export interface PersonItem {
  name: string;
  bio: string;
  picture: string;
  resolvedImage: unknown | undefined;
}

export interface FooterLink {
  description: string;
  icon: string;
  url: string;
}


export interface ShowcaseSite {
  title: string;
  image: ImageMetadata;
  url: string;
}
