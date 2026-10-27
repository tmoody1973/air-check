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

  // A real conversation always has messages; an id that is in neither the list nor the messages is bogus or not ours.
  const missing = Boolean(conversationId) && conversations !== undefined && messages?.length === 0 && !conversations.some((c) => c._id === conversationId);

  async function send(text: string) {
    const r = await sendMessage({ conversationId, text });
    if (!conversationId) router.push(`/chat/${r.conversationId}`);
  }

  return (
    <Shell title="Chat" active="chat">
      <div className="flex flex-col gap-6 min-[900px]:grid min-[900px]:grid-cols-[220px_minmax(0,1fr)] min-[900px]:gap-8">
        <ConversationList conversations={conversations} activeId={conversationId} />
        <ChatThread
          // A fresh thread per conversation: a draft or in-flight send never carries over to another one.
          key={conversationId ?? "new"}
          messages={conversationId ? messages : []}
          missing={missing}
          send={send}
          useRun={useRun}
          usePackage={usePackage}
        />
      </div>
    </Shell>
  );
}
