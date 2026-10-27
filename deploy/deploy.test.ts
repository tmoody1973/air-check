import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
const compose = parse(read("compose.yaml")) as { services: Record<string, any>; networks?: object };
const { console: web, caddy } = compose.services;

describe("deploy files", () => {
  it("only caddy publishes ports, and only 80 and 443", () => {
    expect(web.ports).toBeUndefined();
    expect(Object.keys(compose.services).sort()).toEqual(["caddy", "console"]);
    expect(caddy.ports.map(String).sort()).toEqual(["443:443", "80:80"]);
  });

  it("console is hardened", () => {
    expect(web.read_only).toBe(true);
    expect(web.cap_drop).toEqual(["ALL"]);
    expect(web.security_opt).toContain("no-new-privileges:true");
    expect(web.mem_limit ?? web.deploy?.resources?.limits?.memory).toBeTruthy();
    expect(web.pids_limit).toBeGreaterThan(0);
    expect(web.tmpfs.join()).toContain("/app/apps/console/.next/cache");
    expect(web.env_file).toBe("${HOME}/.aircheck/console.env");
  });

  it("caddy keeps only the bind capability", () => {
    expect(caddy.cap_drop).toEqual(["ALL"]);
    expect(caddy.cap_add).toEqual(["NET_BIND_SERVICE"]);
    expect(caddy.security_opt).toContain("no-new-privileges:true");
  });

  it("compose header documents the run command", () => {
    expect(read("compose.yaml")).toContain(
      "docker compose --env-file ${HOME}/.aircheck/console.env -f deploy/compose.yaml up -d --build",
    );
  });

  it("caddy sets X-Real-IP from the peer, overwriting", () => {
    const c = read("Caddyfile");
    expect(c).toContain("header_up X-Real-IP {remote_host}");
    expect(c).toContain("reverse_proxy console:3000");
    expect(c).not.toMatch(/X-Forwarded-For/i);
  });

  it("caddy writes no access log", () => {
    const noComments = read("Caddyfile").replace(/#.*$/gm, "");
    expect(noComments).not.toMatch(/^\s*log\b/m);
  });

  it("dockerfile runs standalone as non-root with telemetry off", () => {
    const d = read("Dockerfile");
    expect(d).toContain("USER node");
    expect(d).toContain("apps/console/server.js");
    expect(d).toContain("NEXT_TELEMETRY_DISABLED=1");
    expect(d).toContain("CLERK_TELEMETRY_DISABLED=1");
  });

  it("console.env.example lists names only", () => {
    const lines = read("console.env.example").split("\n").filter((l) => l && !l.startsWith("#"));
    for (const l of lines) {
      const [k, v] = l.split("=");
      expect(["NEXT_TELEMETRY_DISABLED", "CLERK_TELEMETRY_DISABLED"].includes(k) ? v : "").toBe(
        ["NEXT_TELEMETRY_DISABLED", "CLERK_TELEMETRY_DISABLED"].includes(k) ? "1" : "",
      );
    }
    expect(lines.map((l) => l.split("=")[0])).toEqual([
      "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL",
      "CLERK_SECRET_KEY", "AIRCHECK_DEMO_USER_ID", "NEXT_TELEMETRY_DISABLED", "CLERK_TELEMETRY_DISABLED",
    ]);
  });
});
