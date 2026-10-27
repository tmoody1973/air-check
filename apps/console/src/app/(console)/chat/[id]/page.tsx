"use client";

import { useParams } from "next/navigation";
import { ChatScreen } from "@/components/ChatScreen";

export default function ChatConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <ChatScreen conversationId={id} />;
}
