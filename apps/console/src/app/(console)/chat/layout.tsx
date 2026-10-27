"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { ChatScreen } from "@/components/ChatScreen";

// The screen lives in the layout so it stays mounted from /chat to /chat/<id>: the first message does not flicker away.
export default function ChatLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  void children;
  return <ChatScreen conversationId={id} />;
}
