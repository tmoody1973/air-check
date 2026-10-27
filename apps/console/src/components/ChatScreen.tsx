"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";
import { ChatThread } from "./ChatThread";
import { ConversationList } from "./ConversationList";
import { Shell } from "./Shell";

const useRun = (runId: string) => useQuery(api.runs.get, runId ? { runId } : "skip");
const usePackage = (packageId: string | undefined) => useQuery(api.packages.get, packageId ? { packageId } : "skip");

/** Convex wiring for /chat and /chat/[id]. All behaviour lives in ChatThread. */
export function ChatScreen({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const conversations = useQuery(api.chat.list, {});
  const messages = useQuery(api.chat.messages, conversationId ? { conversationId } : "skip");
  const sendMessage = useMutation(api.chat.send);

  async function send(text: string) {
    const r = await sendMessage({ conversationId, text });
    if (!conversationId) router.push(`/chat/${r.conversationId}`);
  }

  return (
    <Shell title="Chat" active="chat">
      <div className="flex flex-col gap-6 min-[900px]:grid min-[900px]:grid-cols-[220px_minmax(0,1fr)] min-[900px]:gap-8">
        <ConversationList conversations={conversations} activeId={conversationId} />
        <ChatThread
          key={conversationId ?? "new"}
          messages={conversationId ? messages : []}
          send={send}
          useRun={useRun}
          usePackage={usePackage}
          /* Task 8 wires the Sandbox chip here. */
          headerSlot={null}
        />
      </div>
    </Shell>
  );
}
