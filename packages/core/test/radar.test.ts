import { describe, expect, test } from "vitest";
import {
  BANDCAMP_DOMAIN,
  MAX_EMAIL_CHARS,
  MAX_STORED_CHARS,
  bandcampEmbedSrc,
  bandcampPageUrl,
  checkExtraction,
  cleanMail,
  describeEmbargo,
  embargoHits,
  findDates,
  findEmbargo,
  htmlToText,
  isEmbargoActive,
  parseAllowlist,
  parseBandcampEmail,
  pickInbound,
  readBandcampEmbed,
  releaseKey,
  senderDecision,
  stripLinks,
  unwrapForward,
  type InboundMail,
} from "../src/index";
import { readFixture } from "./helpers/fixtures";

const mailFixture = (name: string): Record<string, unknown> => JSON.parse(readFixture(`email/${name}.json`));
const inbound = (name: string): InboundMail => pickInbound(mailFixture(name))!;
const ALLOW = parseAllowlist("tarik@radiomilwaukee.org, noreply@bandcamp.com");
const OCT29 = Date.UTC(2026, 9, 29, 15); // 10:00 in Chicago
const AR = (d: string) => `mx.example; dkim=pass header.i=@${d} header.s=s1 header.b=abc; spf=pass smtp.mailfrom=${d}`;

describe("pickInbound", () => {
  test("from_ wins over from", () => {
    expect(pickInbound({ message_id: "m1", from_: "A <a@x.org>", from: "B <b@y.org>", text: "hi" })?.from).toBe("A <a@x.org>");
    expect(pickInbound({ message_id: "m1", from: "B <b@y.org>", text: "hi" })?.from).toBe("B <b@y.org>");
  });
  test("HTML-only mail yields text plus hrefs", () => {
    const m = pickInbound({ message_id: "m2", from: "a@x.org", html: '<p>Hello &amp; welcome</p><a href="https://x.example/a">x</a>' })!;
    expect(m.text).toContain("Hello & welcome");
    expect(m.hrefs).toEqual(["https://x.example/a"]);
    expect(m.bodyMissing).toBe(false);
  });
  test("never reads extracted_text", () => {
    const m = pickInbound({ message_id: "m3", from: "a@x.org", text: "full", extracted_text: "cut" })!;
    expect(m.text).toBe("full");
  });
  test("no text and no html is bodyMissing", () => {
    const m = pickInbound({ message_id: "m4", from: "a@x.org", subject: "big", extracted_text: "x" })!;
    expect(m).toMatchObject({ bodyMissing: true, text: "", hrefs: [] });
  });
  test("attachments are counted, never read", () => {
    const m = pickInbound({ message_id: "m5", from: "a@x.org", text: "t", attachments: [{ filename: "a.txt", content: "SECRET-CONTENT" }] })!;
    expect(m.attachmentCount).toBe(1);
    expect(JSON.stringify(m)).not.toContain("SECRET-CONTENT");
  });
  test("no message id or no sender is null", () => {
    expect(pickInbound({ from: "a@x.org", text: "t" })).toBeNull();
    expect(pickInbound({ message_id: "m6", text: "t" })).toBeNull();
    expect(pickInbound("nope")).toBeNull();
    expect(pickInbound(null)).toBeNull();
  });
  test("reads the fixture shape", () => {
    const m = inbound("bandcamp-label");
    expect(m).toMatchObject({ messageId: "<bc-label-0001@bandcamp.example.invalid>", from: "Bandcamp <noreply@bandcamp.com>", attachmentCount: 0 });
    expect(m.headers["Authentication-Results"]).toContain("dkim=pass");
  });
});

describe("htmlToText", () => {
  test("drops script and style, keeps block breaks, decodes entities, collects hrefs", () => {
    const r = htmlToText("<style>p{x:1}</style><script>alert(1)</script><p>One &lt;two&gt; &quot;3&quot; &#39;4&#39; &#x41;</p><div>Next<br>line</div><a href='https://a.example/x?a=1&amp;b=2'>a</a>");
    expect(r.text).not.toMatch(/alert|p\{x/);
    expect(r.text).toContain(`One <two> "3" '4' A`);
    expect(r.text).toMatch(/Next\nline/);
    expect(r.hrefs).toEqual(["https://a.example/x?a=1&b=2"]);
  });
});

describe("parseAllowlist", () => {
  test("comma-separated, lowercased; unset is a closed door", () => {
    expect(parseAllowlist(" Tarik@RadioMilwaukee.org ,, b@x.org ")).toEqual(["tarik@radiomilwaukee.org", "b@x.org"]);
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });
});

describe("senderDecision", () => {
  const mail = (from: string, ar?: string, text = "hello") => ({ from, text, headers: (ar === undefined ? {} : { "Authentication-Results": ar }) as Record<string, string> });
  test("an exact match with an aligned DKIM pass is ok", () => {
    expect(senderDecision(mail("Tarik <Tarik@RadioMilwaukee.org>", AR("radiomilwaukee.org")), ALLOW)).toEqual({ ok: true, tab: "cosign", address: "tarik@radiomilwaukee.org" });
  });
  test("header.d alignment works too, and the header name is case-insensitive", () => {
    const m = { from: "tarik@radiomilwaukee.org", text: "x", headers: { "authentication-results": "mx; dkim=pass header.d=radiomilwaukee.org header.s=g" } };
    expect(senderDecision(m, ALLOW)).toMatchObject({ ok: true });
  });
  test("lookalike addresses are not on the list", () => {
    for (const from of ["tarik@radiomilwaukee.org.evil.com", "nottarik@radiomilwaukee.org"])
      expect(senderDecision(mail(from, AR("radiomilwaukee.org.evil.com")), ALLOW)).toEqual({ ok: false, reason: "Sender not on the list" });
  });
  test("allowlisted but DKIM failed, absent or unaligned", () => {
    const bad = [
      mail("tarik@radiomilwaukee.org", "mx; dkim=fail header.i=@radiomilwaukee.org"),
      mail("tarik@radiomilwaukee.org"),
      mail("tarik@radiomilwaukee.org", "mx; dkim=pass header.d=evil.example"),
    ];
    for (const m of bad) expect(senderDecision(m, ALLOW)).toEqual({ ok: false, reason: "Sender's signature (DKIM) did not pass" });
  });
  test("any aligned passing clause counts, e.g. after a forwarder adds its own", () => {
    expect(senderDecision(mail("noreply@bandcamp.com", "mx; dkim=pass header.d=gmail.com; dkim=pass header.i=@bandcamp.com"), ALLOW)).toMatchObject({ ok: true, tab: "bandcamp" });
  });
  test("relaxed alignment: a subdomain either way passes (R3)", () => {
    expect(senderDecision(mail("noreply@bandcamp.com", "mx; dkim=pass header.d=email.bandcamp.com"), ALLOW)).toMatchObject({ ok: true, tab: "bandcamp" });
    expect(senderDecision(mail("tarik@radiomilwaukee.org", "mx; dkim=pass header.d=mail.radiomilwaukee.org"), ALLOW)).toMatchObject({ ok: true });
    const sub = parseAllowlist("news@email.bandcamp.com");
    expect(senderDecision(mail("news@email.bandcamp.com", "mx; dkim=pass header.d=bandcamp.com"), sub)).toMatchObject({ ok: true });
  });
  test.each(["bandcamp.com.evil.example", "evilbandcamp.com", "bandcamp.co", "com"])("look-alike signing domain %s fails (R3)", (d) => {
    expect(senderDecision(mail("noreply@bandcamp.com", `mx; dkim=pass header.d=${d}`), ALLOW)).toEqual({ ok: false, reason: "Sender's signature (DKIM) did not pass" });
  });
  test("an empty allowlist refuses everyone", () => {
    expect(senderDecision(mail("tarik@radiomilwaukee.org", AR("radiomilwaukee.org")), [])).toEqual({ ok: false, reason: "Sender not on the list" });
  });
  test("tabs", () => {
    expect(BANDCAMP_DOMAIN).toBe("bandcamp.com");
    expect(senderDecision(inbound("bandcamp-label"), ALLOW)).toMatchObject({ ok: true, tab: "bandcamp", address: "noreply@bandcamp.com" });
    expect(senderDecision(inbound("bandcamp-hand-forwarded"), ALLOW)).toMatchObject({ ok: true, tab: "bandcamp", address: "tarik@radiomilwaukee.org" });
    expect(senderDecision(inbound("cosign-forwarded"), ALLOW)).toMatchObject({ ok: true, tab: "cosign" });
  });
});

describe("unwrapForward", () => {
  test("Gmail: original sender, Tarik's note gone", () => {
    const r = unwrapForward(inbound("cosign-forwarded").text);
    expect(r.sender).toEqual({ name: "[Publicist]", address: "press@label.example.invalid" });
    expect(r.body).not.toContain("Worth a spin");
    expect(r.body).not.toContain("Forwarded message");
    expect(r.body).toMatch(/^Hi Tarik/);
  });
  test("Apple: original sender, note gone, header block gone", () => {
    const r = unwrapForward(inbound("cosign-embargo").text);
    expect(r.sender).toEqual({ name: "[Publicist]", address: "press@label.example.invalid" });
    expect(r.body).not.toContain("Hold this one");
    expect(r.body).not.toMatch(/^Subject:/m);
    expect(r.body).toMatch(/^Hi Tarik/);
  });
  test("no forward block: body unchanged, no sender", () => {
    expect(unwrapForward("just text")).toEqual({ body: "just text" });
  });
});

describe("stripLinks and cleanMail (Review Focus 2)", () => {
  test("seven links across text and hrefs, one public Bandcamp album", () => {
    const m = inbound("cosign-forwarded");
    const r = stripLinks(m.text, m.hrefs);
    expect(r.links).toHaveLength(7);
    expect(r.bandcampPages).toEqual(["https://artistname.bandcamp.com/album/song-title"]);
    expect(r.hosts.length).toBeLessThanOrEqual(3);
    expect(r.hosts.join(" ")).not.toContain("bandcamp.com");
    expect(r.links).not.toContain("javascript:alert(1)");
    expect(r.links.join(" ")).not.toContain("mailto:");
  });
  test("cleanMail body and subject hold no http, www. or @, while sender.address is kept", () => {
    for (const name of ["cosign-forwarded", "cosign-injection", "bandcamp-label", "bandcamp-artist", "bandcamp-hand-forwarded"]) {
      const m = inbound(name);
      const d = senderDecision(m, ALLOW);
      if (!d.ok) throw new Error(d.reason);
      const c = cleanMail(m, d);
      for (const bad of ["http", "www.", "@"]) {
        expect(c.body).not.toContain(bad);
        expect(c.subject).not.toContain(bad);
      }
      expect(c.sender?.address).toMatch(/@/);
    }
  });
  test("cleanMail: forward unwrapped, tab carried, direct sender read from From", () => {
    const fwd = inbound("cosign-forwarded");
    const c = cleanMail(fwd, { ok: true, tab: "cosign", address: "tarik@radiomilwaukee.org" });
    expect(c).toMatchObject({ tab: "cosign", sender: { address: "press@label.example.invalid" } });
    expect(c.body).toContain("[link]");
    expect(c.body).toContain("[email]");
    expect(c.body).not.toContain("Worth a spin");
    expect(c.links).toHaveLength(7);
    const bc = cleanMail(inbound("bandcamp-label"), { ok: true, tab: "bandcamp", address: "noreply@bandcamp.com" });
    expect(bc.sender).toEqual({ name: "Bandcamp", address: "noreply@bandcamp.com" });
    expect(bc.bandcampPages).toEqual(["https://palesignal.bandcamp.com/album/glass-weather"]);
  });
  test("cleanMail caps the body", () => {
    const m: InboundMail = { messageId: "x", from: "tarik@radiomilwaukee.org", subject: "s", text: "a ".repeat(30_000), hrefs: [], headers: {}, attachmentCount: 0, bodyMissing: false };
    expect(cleanMail(m, { ok: true, tab: "cosign", address: "tarik@radiomilwaukee.org" }).body.length).toBeLessThanOrEqual(MAX_STORED_CHARS);
  });
  test("25 links keep 20; over-long and non-http links are not kept", () => {
    const text = Array.from({ length: 25 }, (_, i) => `https://x${i}.example/p`).join(" ");
    const r = stripLinks(text, ["javascript:alert(1)", "ftp://x.example/a", `https://long.example/${"a".repeat(600)}`]);
    expect(r.links).toHaveLength(20);
    expect(r.text).not.toContain("http");
  });
  test("mailto and bare addresses become [email]; www. hosts become [link]", () => {
    const r = stripLinks("Write mailto:a@b.example or c.d+e@f.example, see www.g.example/x and HTTPS://H.EXAMPLE/Y.");
    expect(r.text).toBe("Write [email] or [email], see [link] and [link].");
    expect(r.links).toEqual(["https://h.example/Y"]);
    expect(stripLinks("Follow @artistname").text).toBe("Follow (at)artistname");
  });
});

describe("bandcampPageUrl (Review Focus 2)", () => {
  test("accepts public album and track pages", () => {
    expect(bandcampPageUrl("https://artist.bandcamp.com/album/some-record")).toBe("https://artist.bandcamp.com/album/some-record");
    expect(bandcampPageUrl("https://artist.bandcamp.com/track/x#frag")).toBe("https://artist.bandcamp.com/track/x");
    expect(bandcampPageUrl("https://bandcamp.com/album/x")).toBe("https://bandcamp.com/album/x");
  });
  test("a query of tracking params only is dropped (R2)", () => {
    expect(bandcampPageUrl("https://x.bandcamp.com/album/a?from=fanpub_fnb")).toBe("https://x.bandcamp.com/album/a");
    expect(bandcampPageUrl("https://x.bandcamp.com/album/a?utm_source=e&utm_medium=email")).toBe("https://x.bandcamp.com/album/a");
    expect(bandcampPageUrl("https://x.bandcamp.com/track/t?utm_campaign=c&utm_term=t&utm_content=x&ref=y#f")).toBe("https://x.bandcamp.com/track/t");
  });
  test.each([
    "https://x.bandcamp.com/album/a?pk=1",
    "https://x.bandcamp.com/album/a?from=x&pk=1",
    "http://x.bandcamp.com/album/a?from=fanpub_fnb",
    "https://bandcamp.com.evil.example/album/a?from=fanpub_fnb",
    "https://user@x.bandcamp.com/album/a?from=fanpub_fnb",
    "https://x.bandcamp.com:8443/album/a?from=fanpub_fnb",
    "https://x.bandcamp.com/merch?from=fanpub_fnb",
  ])("refuses %s even with tracking params around (R2)", (u) => {
    expect(bandcampPageUrl(u)).toBeNull();
  });
  test.each([
    "http://x.bandcamp.com/album/a",
    "https://bandcamp.com.evil.example/album/a",
    "https://evilbandcamp.com/album/a",
    "https://user@x.bandcamp.com/album/a",
    "https://user:pw@x.bandcamp.com/album/a",
    "https://x.bandcamp.com:8443/album/a",
    "https://x.bandcamp.com/album/a?pk=123",
    "https://x.bandcamp.com/album/a?",
    "https://x.bandcamp.com/merch",
    "https://x.bandcamp.com/album/",
    "https://x.bandcamp.com/album/a/b",
    "https://x.bandcamp.com/album/A-B",
    "not a url",
  ])("refuses %s", (u) => {
    expect(bandcampPageUrl(u)).toBeNull();
  });
});

describe("readBandcampEmbed", () => {
  test("reads the meta fixtures", () => {
    expect(readBandcampEmbed(readFixture("bandcamp/album-meta.html"))).toEqual({ kind: "album", id: "1234567890" });
    expect(readBandcampEmbed(readFixture("bandcamp/track-meta.html"))).toEqual({ kind: "track", id: "987654321" });
  });
  test("an og:video pointing elsewhere is null", () => {
    expect(readBandcampEmbed('<meta property="og:video" content="https://evil.example/EmbeddedPlayer/album=1/">')).toBeNull();
    expect(readBandcampEmbed('<meta property="og:video" content="https://bandcamp.com.evil.example/EmbeddedPlayer/album=1/">')).toBeNull();
    expect(readBandcampEmbed("<html>no meta</html>")).toBeNull();
  });
  test("bandcampEmbedSrc holds only the fixed host, the kind and the digits", () => {
    const src = bandcampEmbedSrc({ kind: "album", id: "1234567890" });
    expect(src).toBe("https://bandcamp.com/EmbeddedPlayer/album=1234567890/size=large/bgcol=ffffff/linkcol=0e6a5b/tracklist=false/artwork=small/transparent=true/");
    expect(() => bandcampEmbedSrc({ kind: "album", id: "1/../../evil" })).toThrow();
    expect(() => bandcampEmbedSrc({ kind: "x" as "album", id: "1" })).toThrow();
  });
});

describe("dates and embargo", () => {
  test("findDates reads the four forms, year-less dates roll forward from receipt", () => {
    expect(findDates("Out 2026-11-07. Also November 8, 2026, 9 November 2026 and 11/10/2026.", OCT29)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(findDates("Released November 7", OCT29)).toEqual(["2026-11-07"]);
    expect(findDates("Back on Oct. 1", OCT29)).toEqual(["2027-10-01"]);
    expect(findDates("Today, October 29", OCT29)).toEqual(["2026-10-29"]);
    expect(findDates("Bad 2/30/2026 and 13/1/2026", OCT29)).toEqual([]);
  });
  test("embargoed until a date", () => {
    expect(findEmbargo("Embargoed until November 7", OCT29)).toEqual({ until: "2026-11-07" });
    expect(findEmbargo("Not for broadcast before 11/7/2026.", OCT29)).toEqual({ until: "2026-11-07" });
    expect(findEmbargo("Please do not play before Nov 7. Thanks.", OCT29)).toEqual({ until: "2026-11-07" });
    expect(findEmbargo("Hold until November 7, 2026!", OCT29)).toEqual({ until: "2026-11-07" });
  });
  test("wording with no readable date is undated", () => {
    expect(findEmbargo("Strictly embargoed, please hold", OCT29)).toEqual({ until: null });
  });
  test("a release date alone is no embargo", () => {
    expect(findEmbargo("Released November 7", OCT29)).toBeNull();
    expect(findDates("Released November 7", OCT29)).toContain("2026-11-07");
  });
  test("the date must sit in the embargo's sentence", () => {
    expect(findEmbargo("Out November 14.\nThis one is embargoed.", OCT29)).toEqual({ until: null });
  });
  test("'no embargo' is not an embargo", () => {
    expect(findEmbargo("No embargo, play away.", OCT29)).toBeNull();
  });
  test("the fixtures", () => {
    expect(findEmbargo(inbound("cosign-embargo").text, OCT29)).toEqual({ until: "2026-11-07" });
    expect(findEmbargo(inbound("cosign-embargo-nodate").text, OCT29)).toEqual({ until: null });
    expect(findEmbargo(inbound("cosign-forwarded").text, OCT29)).toBeNull();
  });
});

describe("checkExtraction (Review Focus 1)", () => {
  const email = unwrapForward(inbound("cosign-forwarded").text).body;
  const good = { artist: "[Artist Name]", title: "[Song Title]", label: "[Label Name]", type: "single", releasedOn: "2026-11-14" };
  test("a grounded candidate passes", () => {
    expect(checkExtraction(good, email, OCT29)).toEqual({ ok: true, release: { artist: "[Artist Name]", title: "[Song Title]", label: "[Label Name]", type: "single", releasedOn: "2026-11-14" }, notes: [] });
  });
  test("an artist or title not in the email is refused with a plain reason", () => {
    const r = checkExtraction({ ...good, artist: "Somebody Else", title: "" }, email, OCT29);
    expect(r).toMatchObject({ ok: false });
    if (r.ok || !("reasons" in r)) throw new Error("expected reasons");
    expect(r.reasons).toContain("The artist 'Somebody Else' is not in the email");
    expect(r.reasons).toContain("The title is missing");
  });
  test("a URL in the label is dropped with a note", () => {
    const r = checkExtraction({ ...good, label: "https://evil.example" }, email, OCT29);
    if (!r.ok) throw new Error("expected ok");
    expect(r.release.label).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/label/i);
  });
  test("a releasedOn the code did not find is dropped with a note", () => {
    const r = checkExtraction({ ...good, releasedOn: "2026-12-25" }, email, OCT29);
    if (!r.ok) throw new Error("expected ok");
    expect(r.release.releasedOn).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/date/i);
  });
  test("extra keys never reach the release", () => {
    const r = checkExtraction({ ...good, status: "played", approve: "pkg-10-16-26", sendTo: "x@evil.example" }, email, OCT29);
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.release).sort()).toEqual(["artist", "label", "releasedOn", "title", "type"]);
  });
  test("notRelease", () => {
    expect(checkExtraction({ notRelease: true }, email, OCT29)).toEqual({ ok: false, notRelease: true });
  });
  test("not an object", () => {
    expect(checkExtraction("hi", email, OCT29)).toMatchObject({ ok: false, reasons: [expect.any(String)] });
  });
  test("the embargo is set when code or model finds one; the date only from code-found dates", () => {
    const emb = unwrapForward(inbound("cosign-embargo").text).body;
    const base = { artist: "[Artist Name]", title: "[Album Title]" };
    // code finds it, model says nothing
    expect(checkExtraction(base, emb, OCT29)).toMatchObject({ ok: true, release: { embargo: { until: "2026-11-07" } } });
    // model finds one in an email where code does not, with an invented date
    const r = checkExtraction({ ...good, embargo: { until: "2026-12-01" } }, email, OCT29);
    expect(r).toMatchObject({ ok: true, release: { embargo: { until: null } } });
    // model's date is kept when code found it in the email
    expect(checkExtraction({ ...good, embargo: { until: "2026-11-14" } }, email, OCT29)).toMatchObject({ ok: true, release: { embargo: { until: "2026-11-14" } } });
    // nobody finds one
    const none = checkExtraction(good, email, OCT29);
    if (!none.ok) throw new Error("expected ok");
    expect(none.release.embargo).toBeUndefined();
    // undated wording
    const nod = unwrapForward(inbound("cosign-embargo-nodate").text).body;
    expect(checkExtraction({ artist: "[Artist Name]", title: "[EP Title]" }, nod, OCT29)).toMatchObject({ ok: true, release: { embargo: { until: null } } });
  });
  test("the compromised reader on the injection fixture yields only the release", () => {
    const body = unwrapForward(inbound("cosign-injection").text).body;
    const clean = stripLinks(body).text;
    const r = checkExtraction({ artist: "[Artist Name]", title: "[Song Title]", label: "https://evil.example/a", status: "played", approve: "pkg-10-16-26", sendTo: "x@evil.example" }, clean, OCT29);
    expect(r).toMatchObject({ ok: true, release: { artist: "[Artist Name]", title: "[Song Title]" } });
    if (!r.ok) throw new Error("expected ok");
    expect(r.release).not.toHaveProperty("label");
    expect(JSON.stringify(r.release)).not.toMatch(/evil|played|pkg-/);
  });
  test("MAX_EMAIL_CHARS", () => {
    expect(MAX_EMAIL_CHARS).toBe(12_000);
  });
});

describe("parseBandcampEmail", () => {
  const parse = (name: string) => {
    const m = inbound(name);
    return parseBandcampEmail(m.subject, stripLinks(unwrapForward(m.text).body).text);
  };
  test("label release", () => {
    expect(parse("bandcamp-label")).toEqual({ artist: "Ferro Lane", title: "Glass Weather", label: "Pale Signal Records", releasedOn: "2026-10-24" });
  });
  test("artist release (HTML-only mail)", () => {
    expect(parse("bandcamp-artist")).toEqual({ artist: "Ferro Lane", title: "Night Rooms", releasedOn: "2026-10-27" });
  });
  test("pre-order", () => {
    expect(parse("bandcamp-preorder")).toEqual({ artist: "Ama Ferrell", title: "Low Tide Radio", label: "Pale Signal Records", releasedOn: "2026-11-21" });
  });
  test("hand-forwarded Bandcamp mail parses the same", () => {
    expect(parse("bandcamp-hand-forwarded")).toMatchObject({ artist: "Ferro Lane", title: "Glass Weather" });
  });
  test("a co-sign is not Bandcamp's template", () => {
    expect(parse("cosign-forwarded")).toBeNull();
    expect(parse("cosign-injection")).toBeNull();
  });
});

describe("releaseKey", () => {
  test("normalized parts joined by |", () => {
    expect(releaseKey("Ferro Lané", "Glass Weather!")).toBe("ferro lane|glass weather");
  });
});

describe("embargo helpers", () => {
  const dated = { artist: "Ferro Lane", title: "Glass Weather", until: "2026-11-07" };
  const undated = { artist: "Ama Ferrell", title: "Low Tide Radio", until: null };
  test("isEmbargoActive", () => {
    expect(isEmbargoActive(undefined, "2026-10-30")).toBe(false);
    expect(isEmbargoActive({ until: null }, "2030-01-01")).toBe(true);
    expect(isEmbargoActive({ until: "2026-11-07" }, "2026-10-30")).toBe(true);
    expect(isEmbargoActive({ until: "2026-11-07" }, "2026-11-07")).toBe(false);
  });
  test("describeEmbargo", () => {
    expect(describeEmbargo(dated)).toBe("'Glass Weather' by Ferro Lane is embargoed until 2026-11-07");
    expect(describeEmbargo(undated)).toBe("'Low Tide Radio' by Ama Ferrell is embargoed (date not known)");
  });
  test("an exact normalized artist and title in the tracks blocks", () => {
    const r = embargoHits({ tracks: [{ artist: "FERRO LANE", title: "Glass Weather" }] }, [dated, undated]);
    expect(r).toEqual({ blocking: [describeEmbargo(dated)], sameArtist: [] });
  });
  test("the title in the description blocks: case- and accent-insensitive, word-bounded", () => {
    expect(embargoHits({ description: "A set built around GLASS WEATHÉR and friends." }, [dated]).blocking).toEqual([describeEmbargo(dated)]);
    expect(embargoHits({ description: "Glass Weathers are not the same." }, [dated]).blocking).toEqual([]);
    expect(embargoHits({ description: "A tune feat. someone, then Glass Weather." }, [dated]).blocking).toHaveLength(1);
  });
  test("titles under 4 characters do not match descriptions", () => {
    expect(embargoHits({ description: "we go up and up" }, [{ artist: "X", title: "Up", until: null }]).blocking).toEqual([]);
  });
  test("the same artist with a different title is sameArtist only", () => {
    expect(embargoHits({ tracks: [{ artist: "Ferro Lane", title: "Night Rooms" }] }, [dated])).toEqual({ blocking: [], sameArtist: [describeEmbargo(dated)] });
  });
});
