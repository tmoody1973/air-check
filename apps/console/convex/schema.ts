import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const workspaceV = v.union(v.literal("real"), v.literal("demo"));
export const resultV = v.union(v.literal("needs_you"), v.literal("done"), v.literal("allowed"), v.literal("blocked"));
export const kindV = v.union(v.literal("waiting"), v.literal("action"), v.literal("network"));

export const radarTabV = v.union(v.literal("bandcamp"), v.literal("cosign"));
export const releaseStatusV = v.union(v.literal("new"), v.literal("considering"), v.literal("played"), v.literal("passed"));
export const releaseTypeV = v.union(v.literal("album"), v.literal("single"), v.literal("ep"));
export const embargoV = v.object({ until: v.union(v.string(), v.null()) });
export const inboxStateV = v.union(
  v.literal("received"), v.literal("saved"), v.literal("merged"), v.literal("not-a-release"),
  v.literal("refused"), v.literal("ignored"), v.literal("failed"),
);

export const mixcloudStatusFields = {
  state: v.union(v.literal("connected"), v.literal("needs_reconnect"), v.literal("not_connected")),
  account: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
};

export const runStatusV = v.union(
  v.literal("queued"), v.literal("running"), v.literal("stopping"),
  v.literal("completed"), v.literal("cancelled"), v.literal("failed"),
);

// Plan 6: one 2026 show as the ingest service found it. Strict objects, so no credential, URL or start time can be stored
// (Hard Rules 2 and 11). Real workspace only (Hard Rule 9). `notes.text` is Paper text: draft input and Tarik's view
// only, never returned by a list and never sent anywhere public (Hard Rule 12).
const fileV = v.object({ id: v.string(), name: v.string(), size: v.number() });
export const episodeTrackV = v.object({
  hour: v.union(v.literal(1), v.literal(2)),
  position: v.number(),
  artist: v.string(),
  title: v.string(),
  feat: v.optional(v.string()),
  raw: v.string(),
  closing: v.boolean(),
  status: v.union(v.literal("confirmed"), v.literal("spelling-fixed"), v.literal("unverified-in-notes"), v.literal("closing-track")),
});
export const questionKindV = v.union(v.literal("audio"), v.literal("date"), v.literal("tracklist"), v.literal("rerun"));
// Plan 6b: what the console can offer to settle a question (mirrors the ingest service's Fix). Convex accepts only ids
// a question offered (Review Focus 5).
export const fixSourceV = v.union(v.literal("box"), v.literal("drive"), v.literal("paper"));
const choiceV = v.object({ id: v.string(), name: v.string() });
export const fixV = v.union(
  v.object({ type: v.literal("tracklist") }),
  v.object({ type: v.literal("pick"), source: fixSourceV, choices: v.array(choiceV) }),
  v.object({ type: v.literal("hours"), choices: v.array(choiceV) }),
  v.object({ type: v.literal("stamp"), folderDate: v.string(), stampDate: v.string() }),
);
/** What the scan finds; the ingest service sends exactly this. */
export const scannedEpisodeFields = {
  showDate: v.string(),
  audio: v.object({
    status: v.union(v.literal("ready"), v.literal("incomplete"), v.literal("ask"), v.literal("none")),
    folderId: v.optional(v.string()),
    hour1: v.optional(fileV),
    hour2: v.optional(fileV),
    pattern: v.optional(v.string()),
    flags: v.array(v.string()),
  }),
  // `text`: the chosen Drive doc's text (at most 20,000 characters), for the tracklist editor only: never in a list,
  // read one show at a time by a signed-in real human (corrections.tracklistText).
  tracklist: v.object({ status: v.union(v.literal("found"), v.literal("missing")), docId: v.optional(v.string()), tracks: v.optional(v.array(episodeTrackV)), text: v.optional(v.string()) }),
  notes: v.object({ status: v.union(v.literal("found"), v.literal("missing")), docId: v.optional(v.string()), text: v.optional(v.string()) }),
  // `rerunOf` on a rerun question is the candidate original; "" means unknown (R8). `action`: fixed in the source, never
  // answered (M6).
  questions: v.array(v.object({ id: v.string(), text: v.string(), kind: questionKindV, rerunOf: v.optional(v.string()), action: v.optional(v.literal(true)), fix: v.optional(fixV) })),
  audioOnDisk: v.optional(v.boolean()),
  // R1 (Plan 6b): the show's correction points at something no source has any more, so the scan did not use it.
  correctionStale: v.optional(v.literal(true)),
  // R4 (Plan 6b): the updatedAt of the correction this scan applied; absent when it applied none. Until it matches the
  // show's correction, the row still holds the pre-fix scan and the show is not drafted.
  appliedCorrectionAt: v.optional(v.number()),
};
export const sourceStateV = v.union(v.literal("connected"), v.literal("needs_reconnect"), v.literal("not_connected"));

// Plan 7: sourced research. Shapes mirror core's research types; claims are judged by code (core judgeClaim) before they
// are stored, and a source's matching text is never kept. Embargoes are not stored here: every read checks Plan 8's
// activeEmbargoes(), so a later, cleared or date-less embargo is always current.
export const researchKindV = v.union(v.literal("show-notes"), v.literal("verify"), v.literal("deep-dive"));
export const researchStatusV = v.union(
  v.literal("queued"), v.literal("running"), v.literal("taken-over"), v.literal("done"), v.literal("stopped"), v.literal("failed"),
);
export const researchTrackV = v.object({
  key: v.string(), hour: v.union(v.literal(1), v.literal(2)), position: v.number(), artist: v.string(), title: v.string(), feat: v.optional(v.string()), closing: v.boolean(),
});
export const noteLineV = v.object({ id: v.string(), text: v.string(), trackKey: v.optional(v.string()), closing: v.boolean() });
export const claimKindV = v.union(
  v.literal("release"), v.literal("release-date"), v.literal("label"), v.literal("credit"), v.literal("track-number"), v.literal("length"),
  v.literal("bio"), v.literal("detail"), v.literal("thread"), v.literal("connection"),
  v.literal("chart"), v.literal("story"), v.literal("song"), v.literal("samples"), v.literal("video"), v.literal("fun-fact"),
  // Oct 30 (decision 023): a deep dive's article sections and infobox rows.
  v.literal("lead"), v.literal("origins"), v.literal("career"), v.literal("sound"), v.literal("records"), v.literal("legacy"), v.literal("infobox"),
);
export const judgedClaimV = v.object({
  kind: claimKindV,
  text: v.string(),
  value: v.optional(v.string()),
  status: v.union(v.literal("confirmed"), v.literal("sourced"), v.literal("conflict"), v.literal("could-not-verify")),
  sources: v.array(v.object({ url: v.string(), host: v.string(), title: v.string(), via: v.string(), says: v.optional(v.string()), primary: v.boolean(), matched: v.boolean() })),
  check: v.optional(v.string()),
});

export default defineSchema({
  episodes: defineTable({
    ...scannedEpisodeFields,
    questions: v.array(v.object({
      id: v.string(), text: v.string(), kind: questionKindV, rerunOf: v.optional(v.string()), action: v.optional(v.literal(true)), fix: v.optional(fixV),
      answer: v.optional(v.string()), answeredAt: v.optional(v.number()),
    })),
    scannedAt: v.number(), // 0 for a row a person created before the scan found the show (a rerun marked ahead of time)
    fetch: v.optional(v.object({ status: v.union(v.literal("fetching"), v.literal("fetched"), v.literal("failed")), at: v.number(), error: v.optional(v.string()) })),
    rerunOf: v.optional(v.string()),
    rerunSource: v.optional(v.union(v.literal("chat"), v.literal("episodes"), v.literal("detected"))),
    rerunDeclined: v.optional(v.literal(true)), // Tarik answered No to "is this a rerun?"; never asked again
    retryAt: v.optional(v.number()), // R9: Tarik's "Try again" on a draft-failed show; draft runs before it stop counting
  }).index("by_showDate", ["showDate"]),
  // Plan 6b (decision 017): Tarik's fixes for one show, used by the scanner instead of what Drive, Paper or Box say.
  // Written only by a signed-in real human (corrections.ts); never written back to a source.
  corrections: defineTable({
    showDate: v.string(),
    tracklistText: v.optional(v.string()), // used exactly as typed
    drive: v.optional(v.string()),
    paper: v.optional(v.string()),
    box: v.optional(v.string()),
    hours: v.optional(v.object({ hour1: v.string(), hour2: v.string() })),
    folderDate: v.optional(v.literal(true)),
    updatedAt: v.number(),
  }).index("by_showDate", ["showDate"]),
  // Docs and folders whose names the scanner could not date; replaced whole after each complete scan.
  unplaced: defineTable({ source: fixSourceV, id: v.string(), name: v.string(), reason: v.string(), seenAt: v.number() }).index("by_source_id", ["source", "id"]),
  // Tarik's date for one of them. Never written back as a rename.
  // `name`: the undated name at place time, so "Placed by you" can show it after a scan drops it from `unplaced` (I1).
  placements: defineTable({ source: fixSourceV, id: v.string(), date: v.string(), name: v.optional(v.string()), updatedAt: v.number() })
    .index("by_source_id", ["source", "id"])
    .index("by_date", ["date"]),
  // One row: when a placement was last removed. A delete leaves no updatedAt behind, so ingest.list's rescanAfter
  // counts this too and Undo rescans as promptly as a save. (A removed fix keeps its row and updatedAt, I2.)
  rescanAsks: defineTable({ at: v.number() }),
  // The 2025 Fridays Tarik added on Episodes, one by one: the scanner reads these dates as well as 2026 (the backlog is
  // otherwise 2026 only). Written only by a signed-in real human (episodes.addShowDate / removeShowDate).
  extraDates: defineTable({ date: v.string(), addedAt: v.number() }).index("by_date", ["date"]),
  // One row per source the ingest service reads. Hard Rule 2: state and account only, never a credential.
  ingestSources: defineTable({
    source: v.union(v.literal("box"), v.literal("google"), v.literal("dropbox")),
    state: sourceStateV,
    account: v.optional(v.string()),
    lastError: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_source", ["source"]),
  packages: defineTable({
    packageId: v.string(),
    workspace: workspaceV,
    status: v.string(),
    // PackageDraft is validated by core's types and the gate, not re-declared here.
    draft: v.any(),
    fingerprint: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    // `at`: when the publisher reported the result (ISO); paces the 3-per-day limit.
    result: v.optional(v.object({ url: v.optional(v.string()), error: v.optional(v.string()), at: v.optional(v.string()) })),
  })
    .index("by_packageId", ["packageId"])
    .index("by_workspace_status", ["workspace", "status"]),
  activity: defineTable({
    workspace: workspaceV,
    at: v.number(),
    kind: kindV,
    title: v.string(),
    destination: v.optional(v.string()),
    result: resultV,
    reason: v.optional(v.string()),
    packageId: v.optional(v.string()),
    // Audit-log dedupe key (network rows written by the relay).
    key: v.optional(v.string()),
  })
    .index("by_workspace_at", ["workspace", "at"])
    .index("by_workspace_key", ["workspace", "key"]),
  // Plan 5c Task 4: a new description for a show already on Mixcloud. At most one open (proposed, approved, pushing)
  // per package; the package row itself never changes. `attempts` counts pushes that ended without an answer.
  descriptionUpdates: defineTable({
    packageId: v.string(),
    description: v.string(),
    descriptionSources: v.optional(v.array(v.object({ claim: v.string(), source: v.string() }))),
    status: v.union(v.literal("proposed"), v.literal("approved"), v.literal("pushing"), v.literal("pushed"), v.literal("failed")),
    proposedBy: v.union(v.literal("agent"), v.literal("human")),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.string()),
    fingerprint: v.string(),
    attempts: v.number(),
    error: v.optional(v.string()),
    pushedAt: v.optional(v.string()),
  })
    .index("by_packageId", ["packageId"])
    .index("by_status", ["status"]),
  // Why a show's audio is not ready yet. The media service replaces the whole set on every scan (media.waiting).
  audioIssues: defineTable({ showDate: v.string(), reason: v.string(), updatedAt: v.number() }),
  // One row (real workspace). Hard Rule 2: no credential here; the Mixcloud token lives only in the publisher's token file.
  mixcloudStatus: defineTable(mixcloudStatusFields),
  // One row per workspace, upserted by the relay every few minutes (relay.status).
  sandboxStatus: defineTable({
    workspace: workspaceV,
    phase: v.union(v.string(), v.null()),
    allowedHosts: v.number(),
    at: v.number(),
  }).index("by_workspace", ["workspace"]),
  // unused since Plan 7; dropped in Task 6 after the demo reseed empties it
  verifications: defineTable({
    workspace: workspaceV,
    claim: v.string(),
    status: v.union(v.literal("conflict"), v.literal("could-not-verify"), v.literal("confirmed")),
    show: v.optional(v.string()),
  }).index("by_workspace_status", ["workspace", "status"]),
  // Plan 8: one record per release from forwarded email. Every new field is optional, so rows written before the deploy
  // (the hourly demo seed) stay valid; radar.statusOf reads a missing status as "new". No email text is kept here, and
  // `links`, `bandcampPage`, `embed` and `senders` never reach the agent (radar.agentList).
  releases: defineTable({
    workspace: workspaceV,
    artist: v.string(),
    title: v.string(),
    label: v.optional(v.string()),
    type: v.optional(releaseTypeV),
    releasedOn: v.optional(v.string()),
    playedNote: v.optional(v.string()),
    genre: v.optional(v.string()),
    embargo: v.optional(embargoV),
    status: v.optional(releaseStatusV),
    statusAt: v.optional(v.number()),
    passReason: v.optional(v.string()),
    source: v.optional(radarTabV),
    senders: v.optional(v.array(v.object({ name: v.optional(v.string()), address: v.optional(v.string()), messageId: v.string(), at: v.number() }))),
    links: v.optional(v.array(v.string())),
    bandcampPage: v.optional(v.string()),
    embed: v.optional(v.object({ kind: v.union(v.literal("album"), v.literal("track")), id: v.string() })),
    embedState: v.optional(v.union(v.literal("queued"), v.literal("ready"), v.literal("failed"))),
    embedError: v.optional(v.string()),
    embedQueuedAt: v.optional(v.number()), // when the page was last queued: the player shows a stale hint after 10 minutes
    key: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    editedFields: v.optional(v.array(v.string())),
    // R5: Tarik set or cleared the embargo by hand, and a later email mentions one. Shown, never enforced.
    laterEmbargoNotice: v.optional(v.object({ at: v.number(), until: v.union(v.string(), v.null()) })),
    // Task 6b, from the one Bandcamp page fetch: the cover art URL (never the image), checked tags, and the about.
    // `about` is untrusted page text, display-only: no agent-facing path returns it. All optional: older rows validate.
    art: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    about: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    // Artist, title, label, tags and about, folded; rewritten on every write that changes one of them.
    searchText: v.optional(v.string()),
  })
    .index("by_workspace", ["workspace"])
    .index("by_workspace_key", ["workspace", "key"])
    .index("by_workspace_source_receivedAt", ["workspace", "source", "receivedAt"])
    .index("by_embedState", ["embedState"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["workspace", "source", "status", "favorite"] }),
  // Plan 8: forwarded email as the console stored it, real workspace only (Hard Rule 9). `body` is cleaned (no link or
  // address) and deleted once the ingest worker has read it; an ignored sender's body is never stored.
  inbox: defineTable({
    messageId: v.string(),
    receivedAt: v.number(),
    from: v.string(),
    subject: v.string(),
    state: inboxStateV,
    tab: v.optional(radarTabV),
    sender: v.optional(v.object({ name: v.optional(v.string()), address: v.optional(v.string()) })),
    body: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    bandcampPages: v.optional(v.array(v.string())),
    reasons: v.optional(v.array(v.string())),
    releaseId: v.optional(v.id("releases")),
    linkCount: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_state_receivedAt", ["state", "receivedAt"])
    .index("by_receivedAt", ["receivedAt"]),
  runs: defineTable({
    workspace: workspaceV,
    runId: v.string(),
    title: v.string(),
    state: v.any(), // RunState, typed by core
    // Display-only Next/Skipped rows; the seed (Task 13) stores them.
    upcoming: v.optional(v.array(v.object({ label: v.string(), text: v.string(), status: v.union(v.literal("next"), v.literal("skipped")) }))),
    updatedAt: v.number(),
    // Plan 4b fields are optional so Plan-3-era rows still satisfy the schema (see runDefaults.ts).
    kind: v.optional(v.union(v.literal("chat"), v.literal("draft-package"), v.literal("research"))),
    source: v.optional(v.union(v.literal("live"), v.literal("scripted"))),
    status: v.optional(runStatusV),
    input: v.optional(v.string()), // the Hermes instruction, built at queue time
    instructions: v.optional(v.string()), // core RUN_INSTRUCTIONS, sent as Hermes `instructions` (live runs only)
    stopRequested: v.optional(v.boolean()),
    hermesRunId: v.optional(v.string()),
    conversationId: v.optional(v.string()), // also Hermes's session_id
    sessionKey: v.optional(v.string()), // demo rate-limit key
    packageId: v.optional(v.string()),
    form: v.optional(v.object({ showDate: v.string(), tracklistText: v.string(), notes: v.string() })),
    lastSeq: v.optional(v.number()), // highest relay event seq applied
    createdAt: v.optional(v.number()),
    jobId: v.optional(v.string()), // Plan 7: the research job a `research` run works on
  })
    .index("by_runId", ["runId"])
    .index("by_status", ["status"])
    .index("by_session_created", ["sessionKey", "createdAt"])
    .index("by_workspace_source_created", ["workspace", "source", "createdAt"])
    .index("by_kind_showDate", ["kind", "form.showDate"]),
  // Plan 7: one row per research job. `sessionKey`: the demo visitor's rate-limit key, so a continuation (queued with no
  // signed-in caller) counts against the same visitor (D11b) and one visitor's job never blocks another's.
  research: defineTable({
    workspace: workspaceV,
    jobId: v.string(),
    kind: researchKindV,
    showDate: v.optional(v.string()),
    subject: v.optional(v.object({ type: v.union(v.literal("artist"), v.literal("label"), v.literal("release")), name: v.string(), fromKey: v.optional(v.string()) })),
    tracks: v.optional(v.array(researchTrackV)),
    lines: v.optional(v.array(noteLineV)),
    notesSource: v.optional(v.union(v.literal("air-check"), v.literal("paper"), v.literal("pasted"))),
    angles: v.boolean(),
    status: researchStatusV,
    runIds: v.array(v.string()),
    continuations: v.number(),
    lastProblems: v.optional(v.array(v.string())),
    playContext: v.optional(v.array(v.object({ artist: v.string(), station: v.union(v.literal("88nine"), v.literal("hyfin")), lastPlayed: v.optional(v.string()) }))),
    sessionKey: v.optional(v.string()),
    scope: v.optional(v.array(v.string())), // Regenerate: the one key this request covers, so it queues no continuation
    // Regenerate confirmed over an edit that existed then: the agent's save may replace that edit. A newer edit drops the key.
    overwriteKeys: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_workspace_created", ["workspace", "createdAt"])
    .index("by_workspace_kind_showDate", ["workspace", "kind", "showDate"]),
  // Plan 7: one row per block. `savedAt`: when the agent last saved it (absent on a row only Tarik has touched).
  // `suppliedNote`, a `private` mark by Tarik and `edited` are his and survive every agent save.
  researchEntries: defineTable({
    workspace: workspaceV,
    jobId: v.string(),
    key: v.string(),
    block: v.union(v.literal("track"), v.literal("intro"), v.literal("threads"), v.literal("line"), v.literal("brief")),
    claims: v.array(judgedClaimV),
    intro: v.optional(v.string()),
    angle: v.optional(v.string()),
    note: v.optional(v.string()),
    replacement: v.optional(v.string()),
    private: v.optional(v.object({ by: v.union(v.literal("agent"), v.literal("tarik")), reason: v.optional(v.string()) })),
    suppliedNote: v.optional(v.string()),
    edited: v.optional(v.object({ text: v.string(), at: v.number() })),
    stale: v.optional(v.literal(true)),
    savedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_jobId_key", ["jobId", "key"]),
  // Plan 7: source_search calls per workspace per America/Chicago day (`day` = chicagoDayKey). `source` absent = web
  // (Tavily); "apple_music" is counted apart. Kept here so a bridge restart never resets it.
  // credits: Tavily credits spent that day (web row only), as the bridge reports them (Oct 29 prefetch).
  searchUsage: defineTable({ workspace: workspaceV, day: v.string(), source: v.optional(v.literal("apple_music")), count: v.number(), credits: v.optional(v.number()) })
    .index("by_workspace_day", ["workspace", "day"]),
  conversations: defineTable({
    workspace: workspaceV,
    title: v.string(),
    createdAt: v.number(),
  }).index("by_workspace_created", ["workspace", "createdAt"]),
  messages: defineTable({
    workspace: workspaceV,
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    runId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_conversation", ["conversationId"]) // creation order
    .index("by_runId", ["runId"]),
});
