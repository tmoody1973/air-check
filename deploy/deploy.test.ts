import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      "AGENTMAIL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "RADAR_SENDERS", "INBOX_TOKEN",
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
      "NEBIUS_API_KEY",
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
    for (const d of [".local/bin", ".aircheck"]) mkdirSync(join(home, d), { recursive: true });
    // nemohermes takes the sandbox first; openshell takes `sandbox exec -n <sandbox>`.
    for (const bin of ["nemohermes", "openshell"]) {
      const stub = join(home, ".local/bin", bin);
      writeFileSync(stub, `#!/bin/sh\ncase "$*" in *aircdemo*) cat <<'J'\n${status.aircdemo}\nJ\n;; *) cat <<'J'\n${status.airc}\nJ\n;; esac\n`);
      chmodSync(stub, 0o755);
    }
    const probes = read("hermes/watchdog.sh").match(/^PROBES=\([\s\S]*?^\)$/m)![0];
    const script = `set -u\n${probes}\nfor n in ${names.map((n) => `"${n}"`).join(" ")}; do for p in "\${PROBES[@]}"; do [[ "\${p%%|*}" == "$n" ]] || continue; bash -c "\${p#*|}" >/dev/null 2>&1 && echo UP || echo DOWN; done; done`;
    return execFileSync("bash", ["-c", script], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim().split("\n");
  };
  const reg = (v: string) => `{"name": "aircheck", "adapter": {"registered": ${v}, "detail": "x"}}`;

  // Runs the real watchdog with only the Hermes probe, stubs for curl/timeout/sudo/nemohermes, and a fake HOME.
  // `curl` health succeeds only after `nemohermes airc recover` has run (or the forward unit restart, with
  // `restartFixes`), or always if `healthy`. `skills` is what `nemohermes <sandbox> skill list` prints.
  // Pass `home` to run again with the same state.
  const runHeal = (opts: {
    healthy?: boolean; recoverFixes?: boolean; restartFixes?: boolean; dry?: boolean;
    skills?: Partial<Record<"airc" | "aircdemo", string>>; home?: string;
  }) => {
    const home = opts.home ?? mkdtempSync(join(tmpdir(), "watchdog-heal-"));
    for (const d of [".local/bin", ".aircheck", ".airc", "bin"]) mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, ".airc/secrets.env"), "TELEGRAM_BOT_TOKEN=t\nTELEGRAM_ALLOWED_IDS=1\n");
    const stub = (path: string, body: string) => { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); };
    stub(join(home, "bin/timeout"), 'shift; exec "$@"');
    // printf, not echo: dash's echo (CI's /bin/sh) swallows a leading -n as its own flag.
    stub(join(home, "bin/sudo"), `printf '%s\\n' "$*" >> "${home}/sudo.log"\n${opts.restartFixes ? `touch "${home}/fixed"` : "true"}`);
    const lists = { airc: opts.skills?.airc ?? "", aircdemo: opts.skills?.aircdemo ?? "" };
    stub(join(home, ".local/bin/nemohermes"), [
      'case "$*" in',
      `  *recover*) echo "$@" >> "${home}/recover.log"; ${opts.recoverFixes ? `touch "${home}/fixed"` : "true"};;`,
      `  "airc skill list") cat <<'J'\n${lists.airc}\nJ\n;;`,
      `  "aircdemo skill list") cat <<'J'\n${lists.aircdemo}\nJ\n;;`,
      "esac",
    ].join("\n"));
    stub(join(home, ".local/bin/openshell"), [
      'echo "$@" >> "' + home + '/openshell.log"',
      'case "$*" in',
      `  *aircdemo*) cat <<'J'\n${lists.aircdemo}\nJ\n;;`,
      `  *) cat <<'J'\n${lists.airc}\nJ\n;;`,
      "esac",
    ].join("\n"));
    stub(join(home, "bin/curl"), `case "$*" in *8642*) ${opts.healthy ? "exit 0" : `[ -f "${home}/fixed" ]`};; *) echo "$*" >> "${home}/telegram.log"; exit 0;; esac`);
    const real = read("hermes/watchdog.sh");
    const skillsProbe = opts.skills ? `\n  ${real.split("\n").find((l) => l.startsWith('  "Agent skills|'))!.trim()}` : "";
    const body = real.replace(/^PROBES=\([\s\S]*?^\)$/m, `PROBES=(\n  "Hermes|curl -sf -m 5 -o /dev/null http://127.0.0.1:8642/health"${skillsProbe}\n)`);
    const file = join(home, "watchdog.sh");
    writeFileSync(file, body);
    const out = execFileSync("bash", [file, ...(opts.dry ? ["--dry-run"] : [])], {
      env: { ...process.env, HOME: home, HEAL_WAIT: "0", PATH: `${join(home, "bin")}:${process.env.PATH}` }, encoding: "utf8",
    });
    const log = (f: string) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8") : "");
    const state = existsSync(join(home, ".aircheck/watchdog.state")) ? readFileSync(join(home, ".aircheck/watchdog.state"), "utf8").trim() : "";
    return { home, out, recovers: log("recover.log"), restarts: log("sudo.log"), telegram: log("telegram.log"), openshell: log("openshell.log"), state };
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
    const listed = "│ rlr-description-safety      │          │ local  │ local   │ enabled │";
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

  it("a failing Hermes probe restarts the forward unit first, and skips recover when that fixes it", () => {
    const r = runHeal({ restartFixes: true });
    expect(r.restarts.trim().split("\n")).toEqual(["-n /usr/bin/systemctl restart --no-block aircheck-hermes-forward.service"]);
    expect(r.recovers).toBe("");
    expect(r.state).toBe("");
    expect(r.telegram.trim().split("\n")).toHaveLength(1);
  });

  it("the watchdog's sudo command is exactly what the sudoers rule allows, and the rule allows nothing else", () => {
    const rules = read("hermes/aircheck-forward.sudoers").split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules).toEqual([
      "user ALL=(root) NOPASSWD: /usr/bin/systemctl restart --no-block aircheck-hermes-forward.service, /usr/bin/systemctl restart --no-block aircheck-hermes-demo-forward.service",
    ]);
    const w = read("hermes/watchdog.sh");
    expect(w).toContain('sudo -n /usr/bin/systemctl restart --no-block "${unit}"');
    expect(w).toContain('unit="aircheck-hermes-forward.service"');
    expect(w).toContain('unit="aircheck-hermes-demo-forward.service"');
  });

  // The forward units: NemoClaw's exact argv (so `recover` treats the listener as its own), restarted forever.
  const forwardArgv = (box: string, port: number) =>
    `/home/user/.local/bin/openshell --gateway nemoclaw --gateway-endpoint https://127.0.0.1:8080 --workspace default forward service ${box} --target-port ${port} --target-host 127.0.0.1 --local 127.0.0.1:${port}`;
  const forwards = [
    ["hermes/aircheck-hermes-forward.service", "airc", 8642, "aircheck-hermes.service"],
    ["hermes/aircheck-hermes-demo-forward.service", "aircdemo", 8643, "aircheck-hermes-demo.service"],
  ] as const;

  it("each Hermes forward has a supervised unit with NemoClaw's exact argv (reliability fix, Oct 29)", () => {
    const hermesEnv = read("hermes/aircheck-hermes.service").split("\n").filter((l) => /^(User|Environment)=/.test(l));
    for (const [file, box, port, bootUnit] of forwards) {
      const lines = read(file).split("\n");
      expect(lines.filter((l) => l.startsWith("ExecStart=")), file).toEqual([`ExecStart=${forwardArgv(box, port)}`]);
      for (const l of ["Restart=always", "RestartSec=1", "StartLimitIntervalSec=0", "WantedBy=multi-user.target", ...hermesEnv])
        expect(lines, `${file}: ${l}`).toContain(l);
      expect(lines, file).toContain(`After=${bootUnit} user@1001.service`);
      expect(lines, file).toContain(`Wants=${bootUnit}`);
      expect(lines, file).toContain(`ExecStartPre=/home/user/.aircheck/forward-adopt.sh /etc/systemd/system/${file.split("/")[1]}`);
      // StartLimitIntervalSec belongs in [Unit]; in [Service] systemd ignores it and gives up after 5 fast failures.
      expect(lines.indexOf("StartLimitIntervalSec=0"), file).toBeLessThan(lines.indexOf("[Service]"));
      expect(lines.filter((l) => /^(Type|RemainAfterExit|KillMode)=/.test(l)), file).toEqual([]);
    }
  });

  it("the watchdog unit kills only watchdog.sh on exit, so a forward its recover starts survives", () => {
    expect(read("hermes/aircheck-watchdog.service").split("\n")).toContain("KillMode=process");
  });

  // forward-adopt.sh with a stub `ss` (a listener while ALIVE exists), a fake /proc and `kill` overridden by an
  // exported shell function, so no real process is touched.
  const runAdopt = (argv: string, opts: { listening?: boolean; age?: number } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "adopt-"));
    for (const d of ["bin", "proc/4242"]) mkdirSync(join(dir, d), { recursive: true });
    const alive = join(dir, "ALIVE");
    if (opts.listening ?? true) writeFileSync(alive, "");
    writeFileSync(join(dir, "proc/4242/cmdline"), argv.split(" ").join("\0") + "\0");
    writeFileSync(join(dir, "bin/ss"), `#!/bin/sh\n[ -f "${alive}" ] && echo 'LISTEN 0 4096 127.0.0.1:8642 0.0.0.0:* users:(("openshell",pid=4242,fd=10))'\nexit 0\n`);
    chmodSync(join(dir, "bin/ss"), 0o755);
    writeFileSync(join(dir, "bin/ps"), `#!/bin/sh\necho "   ${opts.age ?? 3600}"\n`);
    chmodSync(join(dir, "bin/ps"), 0o755);
    const unit = join(dir, "aircheck-hermes-forward.service");
    writeFileSync(unit, read("hermes/aircheck-hermes-forward.service"));
    const script = `kill() { echo "$@" >> "${dir}/killed"; rm -f "${alive}"; }; export -f kill; bash "${resolve(__dirname, "hermes/forward-adopt.sh")}" "${unit}"`;
    let code = 0;
    try {
      execFileSync("bash", ["-c", script], { env: { ...process.env, PROC_ROOT: join(dir, "proc"), PATH: `${join(dir, "bin")}:${process.env.PATH}` }, stdio: "pipe" });
    } catch (e: any) { code = e.status; }
    return { code, killed: existsSync(join(dir, "killed")) ? readFileSync(join(dir, "killed"), "utf8").trim() : "" };
  };

  it("forward-adopt stops only a listener whose full argv equals the unit's ExecStart", () => {
    expect(runAdopt(forwardArgv("airc", 8642))).toEqual({ code: 0, killed: "4242" });
    expect(runAdopt(`${forwardArgv("airc", 8642)} --extra`)).toEqual({ code: 1, killed: "" });
    expect(runAdopt(forwardArgv("airc", 8642).replace("/home/user/.local/bin/openshell", "openshell"))).toEqual({ code: 1, killed: "" });
    expect(runAdopt("socat TCP-LISTEN:8642,fork TCP:127.0.0.1:18642")).toEqual({ code: 1, killed: "" });
    expect(runAdopt(forwardArgv("airc", 8642), { listening: false })).toEqual({ code: 0, killed: "" });
  });

  it("forward-adopt leaves a matching forward younger than 30 s alone (NemoClaw may have just started it)", () => {
    expect(runAdopt(forwardArgv("airc", 8642), { age: 29 })).toEqual({ code: 1, killed: "" });
    expect(runAdopt(forwardArgv("airc", 8642), { age: 30 })).toEqual({ code: 0, killed: "4242" });
  });

  it("install-forward.sh never kills broadly: its one kill is the unit's MainPID in --test; strays go through forward-adopt", () => {
    const sh = read("hermes/install-forward.sh");
    const code = sh.replace(/^\s*#.*$/gm, "");
    expect(code).not.toMatch(/\b(pkill|killall|fuser)\b|kill -9/);
    // Every command position: start of line, or after ;, &&, || or a pipe.
    expect(code.match(/(^|[;&|]\s*)\s*kill\b.*$/gm)!.map((l) => l.trim())).toEqual(['kill "${main}"']);
    expect(code).toContain('main="$(prop MainPID "$u")"');
    expect(code).toContain('"$HOME/.aircheck/forward-adopt.sh" "/etc/systemd/system/$u"');
    // Preflight compares the live argv with the unit before anything is installed.
    expect(code.indexOf('/proc/$pid/cmdline')).toBeLessThan(code.indexOf("sudo install"));
    expect(code).toContain("bash \"$HERE/install-watchdog.sh\"");
    expect(code).toContain("bash \"$HERE/apply-agent-config.sh\" \"$REPO\"");
    // Live prod: config only, never a skills reinstall (that leaves a window without rlr-description-safety).
    expect(code).not.toMatch(/install-skills|--with-skills/);
    // A unit that already owns its port is not restarted.
    expect(code).toMatch(/already owns \$port; not restarted"\n\s*continue/);
  });

  it("apply-agent-config sets and reads back the skill-writing lock in both sandboxes; skills only with --with-skills", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-config-"));
    for (const d of ["home/.local/bin", "repo/deploy/hermes"]) mkdirSync(join(dir, d), { recursive: true });
    const stub = (path: string, body: string) => { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); };
    stub(join(dir, "repo/deploy/hermes/install-skills.sh"), `echo "$@" > "${dir}/skills.log"`);
    const run = (readBack: string, ...args: string[]) => {
      rmSync(join(dir, "openshell.log"), { force: true });
      rmSync(join(dir, "skills.log"), { force: true });
      stub(join(dir, "home/.local/bin/openshell"), `echo "$@" >> "${dir}/openshell.log"\nprintf '${readBack}'`);
      try {
        const out = execFileSync("bash", [resolve(__dirname, "hermes/apply-agent-config.sh"), ...args, join(dir, "repo")], { env: { ...process.env, HOME: join(dir, "home") }, encoding: "utf8", stdio: "pipe" });
        return { code: 0, out };
      } catch (e: any) { return { code: e.status as number, out: String(e.stdout) }; }
    };
    const ok = run("0\\ntrue\\n");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("aircdemo (demo agent): skill writing turned off");
    const calls = readFileSync(join(dir, "openshell.log"), "utf8").trim().split("\n");
    expect(calls).toHaveLength(2); // one call per sandbox
    for (const sb of ["airc", "aircdemo"])
      expect(calls).toContain(`sandbox exec -n ${sb} -- bash -lc hermes config set skills.creation_nudge_interval 0 >/dev/null && hermes config set skills.write_approval true >/dev/null && hermes config get skills.creation_nudge_interval && hermes config get skills.write_approval`);
    expect(existsSync(join(dir, "skills.log"))).toBe(false); // no skills reinstall by default
    expect(run("skills.creation_nudge_interval = 0\\nskills.write_approval = True\\n").code).toBe(0);
    expect(run("0\\ntrue\\n", "--with-skills").code).toBe(0);
    expect(readFileSync(join(dir, "skills.log"), "utf8").trim()).toBe(join(dir, "repo"));
    // The live demo values on Oct 29, or anything that did not stick, stop it before the skills step.
    expect(run("15\\nfalse\\n", "--with-skills").code).toBe(1);
    expect(existsSync(join(dir, "skills.log"))).toBe(false);
    expect(run("", "--with-skills").code).toBe(1);
  });

  it("the watchdog's skill allowlist is exactly what install-skills.sh installs", () => {
    const arr = (src: string, name: string) => src.match(new RegExp(`^${name}=\\(([^)]*)\\)$`, "m"))![1].trim().split(/\s+/);
    expect(arr(read("hermes/watchdog.sh"), "REPO_SKILLS")).toEqual(arr(read("hermes/install-skills.sh"), "SKILLS"));
  });

  it("an agent-made local skill alerts once per sandbox and name; repo, truncated repo and builtin skills never alert", () => {
    // Hermes's real 5-column table. The first airc row is the truncated form `nemohermes skill list` printed on the VM.
    const row = (name: string, source = "local") => `│ ${name.padEnd(28)} │          │ ${source.padEnd(6)} │ ${source.padEnd(7)} │ enabled │`;
    const table = (...rows: string[]) => ["┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┓", "┃ Name ┃ Category ┃ Source ┃ Trust ┃ Status ┃", ...rows, "0 hub-installed, 53 builtin, 3 local"].join("\n");
    const skills = {
      airc: table(row("rlr-mixcloud-title-and…"), row("rlr-description-safety"), row("rlr-mixcloud-title-and-tags"), row("claude-code", "builtin"), row("mixcloud-package-submission")),
      aircdemo: table(row("rlr-description-safety")),
    };
    const first = runHeal({ healthy: true, skills });
    expect(first.state).toBe(""); // the Agent skills probe itself is UP
    expect(first.telegram).toContain("mixcloud-package-submission");
    expect(first.telegram).toContain("in airc");
    expect(first.telegram).not.toMatch(/rlr-|claude-code|aircdemo/);
    expect(first.out).toContain("watchdog: new local skill in airc: mixcloud-package-submission");
    // One listing per sandbox per run, untruncated, local only.
    expect(first.openshell.trim().split("\n")).toEqual([
      "sandbox exec -n airc -- bash -lc COLUMNS=200 hermes skills list --source local",
      "sandbox exec -n aircdemo -- bash -lc COLUMNS=200 hermes skills list --source local",
    ]);
    const again = runHeal({ healthy: true, skills, home: first.home });
    expect(again.telegram).toBe(first.telegram); // nothing new sent
    expect(runHeal({ healthy: true, skills, dry: true }).out).toContain("mixcloud-package-submission");
  });

  it("the watchdog probes both forward units, so a stopped unit alerts once like any other probe", () => {
    const w = read("hermes/watchdog.sh");
    expect(w).toContain('"Hermes forward|systemctl is-active --quiet aircheck-hermes-forward"');
    expect(w).toContain('"Demo Hermes forward|systemctl is-active --quiet aircheck-hermes-demo-forward"');
  });
});
