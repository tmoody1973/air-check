// Spike V3 (throwaway): does Nemotron on Token Factory write valid OpenUI Lang for a PackageCard?
// Pass: 9 of 10 generations parse with root PackageCard, no validation errors, nothing unresolved or incomplete.
// Run: node --env-file=../../.env.local v3.mjs [runs]
import { createLibrary, createParser, defineComponent } from "@openuidev/lang-core";
import { z } from "zod";

const TagRow = defineComponent({
  name: "TagRow",
  description: "Up to five Mixcloud tag pills.",
  props: z.object({ tags: z.array(z.string()).max(5) }),
  component: null,
});
const StatRow = defineComponent({
  name: "StatRow",
  description: "Three counts shown under the title.",
  props: z.object({ tracks: z.number(), closingTracks: z.number(), tags: z.number() }),
  component: null,
});
const FlagList = defineComponent({
  name: "FlagList",
  description: "The 'For your review' bullet list: what was changed or left out, and why.",
  props: z.object({ items: z.array(z.string()) }),
  component: null,
});
const ApprovalBar = defineComponent({
  name: "ApprovalBar",
  description: "Approve, Review and Edit buttons. Buttons call the app with the package id, never the model.",
  props: z.object({ packageId: z.string(), demoMode: z.boolean() }),
  component: null,
});
const PackageCard = defineComponent({
  name: "PackageCard",
  description: "A draft Mixcloud package for one Rhythm Lab Radio episode, for a human to approve.",
  props: z.object({
    title: z.string(),
    alternates: z.array(z.string()),
    tagRow: TagRow.ref,
    stats: StatRow.ref,
    flags: FlagList.ref,
    actions: ApprovalBar.ref,
  }),
  component: null,
});

const library = createLibrary({ root: "PackageCard", components: [PackageCard, TagRow, StatRow, FlagList, ApprovalBar] });
const parser = createParser(library.toJSONSchema(), "PackageCard");

const system = library.prompt({
  preamble: "You are Air Check, a producer's assistant. Output ONLY OpenUI Lang, no prose and no code fences.",
  additionalRules: [
    "The root must be a PackageCard.",
    "Copy titles, tags and counts exactly from the facts; never invent artists or numbers.",
    "No on-air talk, scripts or social copy.",
  ],
  examples: [
    [
      'root = PackageCard("RLR 1.9.26 | A, B, C, D and more", ["RLR 1.9.26: A, B, E, F and more"], tags, stats, flags, actions)',
      'tags = TagRow(["Jazz", "Soul"])',
      "stats = StatRow(28, 2, 2)",
      'flags = FlagList(["Closing tracks included as aired."])',
      'actions = ApprovalBar("pkg-1-9-26", false)',
    ].join("\n"),
  ],
});

const facts = `Build the PackageCard for this package (id pkg-10-2-26, real workspace, demoMode false).
Title: RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more
Alternates: "RLR 10.2.26: Michael Kiwanuka, Tinashe, Bicep, Seun Kuti, Hermanos Gutiérrez and more"; "RLR 10.2.26 | Walter Bishop Jr., Hiatus Kaiyote, Logic1000, Kaytranada, Tinashe and more"
Tags: Jazz, Electronic, R&B, Soul, Hip Hop
Counts: 31 tracks, 2 closing tracks, 5 tags
For your review: Spellings taken from the Paper notes (Lý Qua Dub, Quiñones, Gutiérrez). Left out of the description: the pre-air verify list and one personal detail from the notes. Time-relative phrases from the notes were avoided.`;

const EXPECTED_TITLE = "RLR 10.2.26 | Michael Kiwanuka, Tinashe, Bicep, Kaytranada, Hiatus Kaiyote and more";
const MODELS = ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b"];
const RUNS = Number(process.argv[2] ?? 10);

async function generate(model) {
  const started = Date.now();
  const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 6000, // Nemotron spends part of the budget in a separate `reasoning` field (spike V2 gotcha)
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: facts },
      ],
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, ms: Date.now() - started };
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? "").replace(/^```\w*\n?|```$/gm, "").trim();
  return { text, usage: data.usage, ms: Date.now() - started };
}

function judge(text) {
  if (!text) return { ok: false, why: "empty content" };
  const r = parser.parse(text);
  const why = [];
  if (r.root?.typeName !== "PackageCard") why.push(`root=${r.root?.typeName ?? "none"}`);
  if (r.meta.incomplete) why.push("incomplete");
  if (r.meta.unresolved.length) why.push(`unresolved ${r.meta.unresolved.join(",")}`);
  if (r.meta.errors.length) why.push(`errors: ${r.meta.errors.map((e) => e.code ?? e.message).join(",")}`);
  const exactTitle = r.root?.props?.title === EXPECTED_TITLE;
  return { ok: why.length === 0, why: why.join("; "), exactTitle };
}

for (const model of MODELS) {
  let valid = 0;
  let exact = 0;
  let tokens = 0;
  for (let i = 1; i <= RUNS; i++) {
    const g = await generate(model);
    const j = g.error ? { ok: false, why: g.error } : judge(g.text);
    if (j.ok) valid++;
    if (j.exactTitle) exact++;
    tokens += g.usage?.total_tokens ?? 0;
    console.log(`${model.split("/")[1]} #${i}: ${j.ok ? "VALID" : `INVALID (${j.why})`}${j.exactTitle ? "" : " | title differs"} | ${g.ms} ms`);
    if (i === 1 && g.text) console.log(`  sample:\n${g.text.split("\n").map((l) => `    ${l}`).join("\n")}`);
  }
  console.log(`== ${model}: ${valid}/${RUNS} valid, ${exact}/${RUNS} exact title, ${tokens} tokens total\n`);
}
