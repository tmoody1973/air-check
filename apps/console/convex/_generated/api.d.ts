/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agentSubmit from "../agentSubmit.js";
import type * as applyEvents from "../applyEvents.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as cutoff from "../cutoff.js";
import type * as demoLimits from "../demoLimits.js";
import type * as enqueue from "../enqueue.js";
import type * as gate from "../gate.js";
import type * as http from "../http.js";
import type * as packageStore from "../packageStore.js";
import type * as packages from "../packages.js";
import type * as relay from "../relay.js";
import type * as runDefaults from "../runDefaults.js";
import type * as runs from "../runs.js";
import type * as sandbox from "../sandbox.js";
import type * as scripted from "../scripted.js";
import type * as scriptedEvents from "../scriptedEvents.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as today from "../today.js";
import type * as tracklist from "../tracklist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agentSubmit: typeof agentSubmit;
  applyEvents: typeof applyEvents;
  chat: typeof chat;
  crons: typeof crons;
  cutoff: typeof cutoff;
  demoLimits: typeof demoLimits;
  enqueue: typeof enqueue;
  gate: typeof gate;
  http: typeof http;
  packageStore: typeof packageStore;
  packages: typeof packages;
  relay: typeof relay;
  runDefaults: typeof runDefaults;
  runs: typeof runs;
  sandbox: typeof sandbox;
  scripted: typeof scripted;
  scriptedEvents: typeof scriptedEvents;
  seed: typeof seed;
  seedData: typeof seedData;
  today: typeof today;
  tracklist: typeof tracklist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
