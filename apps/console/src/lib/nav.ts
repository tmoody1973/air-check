export type NavItem = { slug: string; label: string; href: string; built: boolean };

const item = (slug: string, label: string, built = false): NavItem => ({
  slug,
  label,
  built,
  href: built ? `/${slug}` : `/soon/${slug}`,
});

// Order is fixed by spec 6.1 (the render wins over the HTML mock).
export const NAV: readonly NavItem[] = [
  item("today", "Today", true),
  item("chat", "Chat", true),
  item("plan", "Plan"),
  item("tracklist", "Tracklist", true),
  item("episodes", "Episodes"),
  item("release-radar", "Release radar"),
  item("trust", "Trust", true),
  item("skills", "Skills and memory"),
];
