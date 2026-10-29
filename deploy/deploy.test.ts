import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("console mounts only the Mixcloud and ingest token folders (rw) and the prepared audio (ro)", () => {
    expect(web.read_only).toBe(true);
    expect(web.volumes).toEqual([
      "${HOME}/.aircheck/mixcloud:/mixcloud:rw", "${HOME}/.aircheck/ingest-tokens:/ingest-tokens:rw", "${HOME}/aircheck-audio/prepared:/audio:ro",
    ]);
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
    // Only the global `log default { exclude ... }` block is allowed; no per-site log.
    expect(noComments).not.toMatch(/^\s*log\b(?!\s+default)/m);
  });

  it("caddy has memory and process limits", () => {
    expect(caddy.mem_limit).toBeTruthy();
    expect(caddy.pids_limit).toBeGreaterThan(0);
  });

  it("both services rotate their logs", () => {
    for (const s of [web, caddy]) {
      expect(s.logging.driver).toBe("json-file");
      expect(s.logging.options["max-size"]).toBe("10m");
      expect(s.logging.options["max-file"]).toBe("3");
    }
  });

  it("caddy excludes proxy error logs and does not advertise HTTP/3", () => {
    const c = read("Caddyfile").replace(/#.*$/gm, "");
    expect(c).toMatch(/log default\s*\{\s*exclude http\.log\.error\s*\}/);
    expect(c).toMatch(/servers\s*\{\s*protocols h1 h2\s*\}/);
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
      "MIXCLOUD_CLIENT_ID", "MIXCLOUD_CLIENT_SECRET", "MIXCLOUD_TOKEN_FILE",
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "INGEST_TOKEN_DIR",
    ]);
  });

  it("build args fail loudly when unset", () => {
    for (const k of ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL"]) {
      expect(web.build.args[k]).toMatch(new RegExp(`^\\$\\{${k}:\\?.+\\}$`));
    }
  });

  it("console has init and a 127.0.0.1 healthcheck", () => {
    expect(web.init).toBe(true);
    expect(web.healthcheck.test.join(" ")).toContain("http://127.0.0.1:3000/sign-in");
  });

  it("no secret can enter the image", () => {
    const ignore = readFileSync(resolve(__dirname, "../.dockerignore"), "utf8").split("\n");
    expect(ignore).toContain(".env*");
    expect(ignore).toContain("**/.env*");
    const d = read("Dockerfile");
    expect(d).not.toContain("CLERK_SECRET_KEY");
    const args = d.split("\n").filter((l) => /^\s*ARG\b/.test(l));
    expect(args.length).toBeGreaterThan(0);
    for (const l of args) expect(l).toMatch(/^\s*ARG NEXT_PUBLIC_/);
  });

  it("caddy sends HSTS without includeSubDomains or preload", () => {
    const c = read("Caddyfile").replace(/#.*$/gm, "");
    expect(c).toContain('header Strict-Transport-Security "max-age=31536000"');
    expect(c).not.toMatch(/includeSubDomains|preload/);
  });

  it("the demo sandbox boots from its own unit, after the real one, and the real unit is airc only", () => {
    const realUnit = read("hermes/aircheck-hermes.service");
    const demoUnit = read("hermes/aircheck-hermes-demo.service");
    expect(realUnit.replace(/^#.*$/gm, "")).not.toContain("aircdemo"); // comments may point at the demo unit
    expect(demoUnit).toMatch(/^After=.*aircheck-hermes\.service/m);
    expect(demoUnit).toMatch(/^Wants=.*aircheck-hermes\.service/m);
    expect(demoUnit).toMatch(/^TimeoutStartSec=900$/m);
    expect(demoUnit).toMatch(/^ExecStopPost=-\S+openshell sandbox stop aircdemo$/m);
    const execs = demoUnit.split("\n").filter((l) => /^Exec\w+=/.test(l));
    expect(execs.length).toBeGreaterThanOrEqual(3);
    for (const l of execs) expect(l).toMatch(/^Exec\w+=-/);
    expect(execs.join("\n")).not.toMatch(/\bairc\b(?!demo)/);
  });

  it("the media unit creates its audio folders before the sandbox needs them (M4)", () => {
    const unit = read("media/aircheck-media.service");
    expect(unit).toMatch(
      /^ExecStartPre=\+\/usr\/bin\/install -d -m 0755 -o user -g user \/home\/user\/aircheck-audio \/home\/user\/aircheck-audio\/inbox \/home\/user\/aircheck-audio\/prepared$/m,
    );
    expect(unit.indexOf("ExecStartPre=")).toBeLessThan(unit.indexOf("ExecStart=/"));
  });

  it("the ingest unit creates the audio folders, may write only there, and its env example holds names only", () => {
    const unit = read("ingest/aircheck-ingest.service");
    expect(unit).toMatch(
      /^ExecStartPre=\+\/usr\/bin\/install -d -m 0755 -o user -g user \/home\/user\/aircheck-audio \/home\/user\/aircheck-audio\/inbox \/home\/user\/aircheck-audio\/prepared$/m,
    );
    expect(unit.indexOf("ExecStartPre=")).toBeLessThan(unit.indexOf("ExecStart=/"));
    expect(unit.match(/^ReadWritePaths=.*$/gm)).toEqual(["ReadWritePaths=-/home/user/aircheck-audio"]);
    for (const l of ["ProtectSystem=strict", "ProtectHome=read-only", "NoNewPrivileges=yes", "User=user", "EnvironmentFile=/home/user/.aircheck/ingest.env"])
      expect(unit).toContain(l);
    const env = read("ingest/ingest.env.example").split("\n").filter((l) => l && !l.startsWith("#"));
    for (const l of env) expect(l).toMatch(/^[A-Z_]+=$/);
    expect(env.map((l) => l.slice(0, -1))).toEqual(expect.arrayContaining([
      "CONVEX_URL", "INGEST_TOKEN", "BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_ENTERPRISE_ID", "BOX_FOLDER_ID",
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "INGEST_TOKEN_DIR", "INBOX_DIR", "PREPARED_DIR",
    ]));
  });

  it("DEPLOY creates the ingest token folder before the console rebuild in the deploy order, and says why (M7)", () => {
    const doc = readFileSync(new URL("../docs/DEPLOY.md", import.meta.url), "utf8");
    const order = doc.slice(doc.indexOf("## Deploy order"), doc.indexOf("## Certificates"));
    expect(order.indexOf("~/.aircheck/ingest-tokens")).toBeGreaterThan(-1);
    expect(order.indexOf("~/.aircheck/ingest-tokens")).toBeLessThan(order.indexOf("dc up -d --build"));
    expect(order).toMatch(/Docker creates the folder as root and Connect fails/);
  });

  it("DEPLOY copies WAVs under a temporary name so a half-copied file is never an inbox WAV (C1)", () => {
    const doc = readFileSync(new URL("../docs/DEPLOY.md", import.meta.url), "utf8");
    expect(doc).toMatch(/cat > [^\n']*\.wav\.part && mv [^\n']*\.wav\.part [^\n']*\.wav/);
    expect(doc).toMatch(/mkdir -p [^\n]*~\/aircheck-audio\/inbox/);
  });

  // The watchdog's PROBES array, loaded under `set -u` as the script does, with a stub nemohermes that prints
  // `status` per sandbox. Returns each named probe's verdict.
  const runProbes = (names: string[], status: Record<"airc" | "aircdemo", string>) => {
    const home = mkdtempSync(join(tmpdir(), "watchdog-"));
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    const stub = join(home, ".local/bin/nemohermes");
    writeFileSync(stub, `#!/bin/sh\ncase "$1" in aircdemo) cat <<'J'\n${status.aircdemo}\nJ\n;; *) cat <<'J'\n${status.airc}\nJ\n;; esac\n`);
    chmodSync(stub, 0o755);
    const probes = read("hermes/watchdog.sh").match(/^PROBES=\([\s\S]*?^\)$/m)![0];
    const script = `set -u\n${probes}\nfor n in ${names.map((n) => `"${n}"`).join(" ")}; do for p in "\${PROBES[@]}"; do [[ "\${p%%|*}" == "$n" ]] || continue; bash -c "\${p#*|}" >/dev/null 2>&1 && echo UP || echo DOWN; done; done`;
    return execFileSync("bash", ["-c", script], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim().split("\n");
  };
  const reg = (v: string) => `{"name": "aircheck", "adapter": {"registered": ${v}, "detail": "x"}}`;

  // Runs the real watchdog with only the Hermes probe, stubs for curl/timeout/nemohermes, and a fake HOME.
  // `curl` health succeeds only after `nemohermes airc recover` has run (or always, if `healthy`).
  const runHeal = (opts: { healthy?: boolean; recoverFixes?: boolean; dry?: boolean }) => {
    const home = mkdtempSync(join(tmpdir(), "watchdog-heal-"));
    for (const d of [".local/bin", ".aircheck", ".airc", "bin"]) mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, ".airc/secrets.env"), "TELEGRAM_BOT_TOKEN=t\nTELEGRAM_ALLOWED_IDS=1\n");
    const stub = (path: string, body: string) => { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); };
    stub(join(home, "bin/timeout"), 'shift; exec "$@"');
    stub(join(home, ".local/bin/nemohermes"), `echo "$@" >> "${home}/recover.log"\n${opts.recoverFixes ? `touch "${home}/fixed"` : "true"}`);
    stub(join(home, "bin/curl"), `case "$*" in *8642*) ${opts.healthy ? "exit 0" : `[ -f "${home}/fixed" ]`};; *) echo sent >> "${home}/telegram.log"; exit 0;; esac`);
    const body = read("hermes/watchdog.sh").replace(/^PROBES=\([\s\S]*?^\)$/m, 'PROBES=(\n  "Hermes|curl -sf -m 5 -o /dev/null http://127.0.0.1:8642/health"\n)');
    const file = join(home, "watchdog.sh");
    writeFileSync(file, body);
    const out = execFileSync("bash", [file, ...(opts.dry ? ["--dry-run"] : [])], {
      env: { ...process.env, HOME: home, HEAL_WAIT: "0", PATH: `${join(home, "bin")}:${process.env.PATH}` }, encoding: "utf8",
    });
    const log = (f: string) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8") : "");
    const state = existsSync(join(home, ".aircheck/watchdog.state")) ? readFileSync(join(home, ".aircheck/watchdog.state"), "utf8").trim() : "";
    return { out, recovers: log("recover.log"), telegram: log("telegram.log"), state };
  };

  it("a failing Hermes probe runs `airc recover` once and sends only the reconnected line when it heals", () => {
    const r = runHeal({ recoverFixes: true });
    expect(r.recovers.trim().split("\n")).toEqual(["airc recover"]);
    expect(r.state).toBe("");
    expect(r.telegram.trim().split("\n")).toHaveLength(1);
  });

  it("if recover does not fix it, Hermes still counts as down and alerts", () => {
    const r = runHeal({ recoverFixes: false });
    expect(r.recovers.trim().split("\n")).toEqual(["airc recover"]);
    expect(r.state).toBe("down:Hermes");
  });

  it("a healthy Hermes triggers no recover", () => {
    expect(runHeal({ healthy: true }).recovers).toBe("");
  });

  it("--dry-run never runs recover", () => {
    const r = runHeal({ dry: true, recoverFixes: true });
    expect(r.recovers).toBe("");
    expect(r.out).toContain("would run: nemohermes airc recover");
  });

  it("the Agent tools probe tolerates JSON spacing and goes DOWN on registered false (VM, 2026-10-28)", () => {
    const up = reg("true");
    expect(runProbes(["Agent tools"], { airc: `{"adapter": {"registered": true}}`, aircdemo: up })).toEqual(["UP"]);
    expect(runProbes(["Agent tools"], { airc: `{"adapter": {"registered":true}}`, aircdemo: up })).toEqual(["UP"]);
    expect(runProbes(["Agent tools"], { airc: `{"adapter": {"registered": false, "detail": "mismatch"}}`, aircdemo: up })).toEqual(["DOWN"]);
  });

  it("the demo sandbox's tools have their own probe, so an alert names which sandbox", () => {
    expect(runProbes(["Agent tools", "Demo agent tools"], { airc: reg("true"), aircdemo: reg("false") })).toEqual(["UP", "DOWN"]);
    expect(runProbes(["Agent tools", "Demo agent tools"], { airc: reg("false"), aircdemo: reg("true") })).toEqual(["DOWN", "UP"]);
  });

  it("the Agent skills probe goes DOWN when either sandbox lacks rlr-description-safety (Plan 5c Task 5)", () => {
    const listed = "│ rlr-description-safety  │ local │ enabled │";
    expect(runProbes(["Agent skills"], { airc: listed, aircdemo: listed })).toEqual(["UP"]);
    expect(runProbes(["Agent skills"], { airc: listed, aircdemo: "│ claude-code │ builtin │" })).toEqual(["DOWN"]);
    expect(runProbes(["Agent skills"], { airc: "", aircdemo: listed })).toEqual(["DOWN"]);
  });

  it("both hermes units re-wire their MCP tools after recover, each bounded by timeout 120", () => {
    for (const [file, box] of [["hermes/aircheck-hermes.service", "airc"], ["hermes/aircheck-hermes-demo.service", "aircdemo"]] as const) {
      const unit = read(file);
      const rewire = `ExecStart=-/usr/bin/timeout 120 /home/user/.local/bin/nemohermes ${box} mcp restart`;
      expect(unit.split("\n"), file).toContain(rewire);
      expect(unit.indexOf(rewire), file).toBeGreaterThan(unit.indexOf(`nemohermes ${box} recover`));
    }
  });
});
