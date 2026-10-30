"use client";

import { SKILL_CATALOG } from "@aircheck/core";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Shell, useWorkspace } from "@/components/Shell";
import { SkillsMemoryView } from "@/components/SkillsMemoryView";

// Oct 30: Skills and memory (spec 6.1's nav item). Skills come from the generated catalog; what was learned from Tarik's
// fixes and edits from memory.learned.
export default function SkillsPage() {
  const learned = useQuery(api.memory.learned, {});
  const workspace = useWorkspace();
  return (
    <Shell title="Skills and memory">
      <SkillsMemoryView skills={SKILL_CATALOG} learned={learned} workspace={workspace} />
    </Shell>
  );
}
