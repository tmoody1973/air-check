import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const clerkProps = vi.fn();
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: (props: { children: unknown }) => {
    clerkProps(props);
    return props.children;
  },
  useAuth: () => ({}),
}));
vi.mock("convex/react", () => ({ ConvexReactClient: class {} }));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: (p: { children: unknown }) => p.children }));
vi.mock("../components/PlayerProvider", () => ({ PlayerProvider: (p: { children: unknown }) => p.children }));

async function render() {
  const { Providers } = await import("./providers");
  renderToStaticMarkup(<Providers>x</Providers>);
  return clerkProps.mock.calls.at(-1)![0] as Record<string, unknown>;
}

describe("Providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clerkProps.mockClear();
  });

  it("allowedRedirectOrigins is the app origin only", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://aircheck.rhythmlabradio.com");
    expect((await render()).allowedRedirectOrigins).toEqual(["https://aircheck.rhythmlabradio.com"]);
  });

  it("sets no allowedRedirectOrigins when NEXT_PUBLIC_APP_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect((await render()).allowedRedirectOrigins).toBeUndefined();
  });
});
