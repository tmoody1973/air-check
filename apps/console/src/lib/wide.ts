import { useSyncExternalStore } from "react";

// R15: cards below Tailwind's md (768px), where a 720px table would scroll sideways. One layout is rendered, not
// both hidden by CSS, so ids, labels and anchor links stay unique. No matchMedia (tests, server) = table.
const WIDE = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export const useWide = () => useSyncExternalStore(subscribe, () => !window.matchMedia || window.matchMedia(WIDE).matches, () => true);
