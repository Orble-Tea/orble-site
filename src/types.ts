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

export interface NavItem {
  title: string;
  url: string;
}

export interface ShowcaseSite {
  title: string;
  image: ImageMetadata;
  url: string;
}
