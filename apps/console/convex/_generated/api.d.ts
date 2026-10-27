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
import type * as crons from "../crons.js";
import type * as cutoff from "../cutoff.js";
import type * as gate from "../gate.js";
import type * as packageStore from "../packageStore.js";
import type * as packages from "../packages.js";
import type * as runs from "../runs.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as today from "../today.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  crons: typeof crons;
  cutoff: typeof cutoff;
  gate: typeof gate;
  packageStore: typeof packageStore;
  packages: typeof packages;
  runs: typeof runs;
  seed: typeof seed;
  seedData: typeof seedData;
  today: typeof today;
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
