"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { SandboxChip } from "./SandboxChip";

/** Convex wiring for SandboxChip; re-checks the clock every 30 s so a silent relay turns the chip to "unknown". */
export function SandboxChipLive() {
  const row = useQuery(api.sandbox.get, {});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <SandboxChip row={row} now={now} />;
}
