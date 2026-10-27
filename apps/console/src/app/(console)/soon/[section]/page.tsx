import { Shell } from "@/components/Shell";
import { NAV } from "@/lib/nav";

export default async function Soon({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = NAV.find((n) => n.slug === section);
  return (
    <Shell title={item?.label ?? "Coming soon"} active={item?.slug}>
      <p className="text-ink-soft">Coming in a later build.</p>
    </Shell>
  );
}
