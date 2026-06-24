"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ConversationList } from "@/components/ConversationList";
import { MessageComposer } from "@/components/MessageComposer";
import { LockIndicator } from "@/components/LockIndicator";
import {
  fetchConversation,
  acquireLock,
  releaseLock,
  isAuthenticated,
  logout,
} from "@/lib/api";
import { usePollMessages } from "@/hooks/usePollMessages";
import type { LockState, UIMessage } from "@/types";

export default function ConversationDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const conversationId = Number(params.id);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [lock, setLock] = useState<LockState | null>(null);
  const latestIdRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated()) router.replace("/login");
  }, [router]);

  // Initial thread load
  const { data, isLoading, isError } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => fetchConversation(conversationId),
    enabled: !Number.isNaN(conversationId),
  });

  // Seed messages once loaded
  useEffect(() => {
    if (data) {
      setMessages(data.messages);
      const maxId = data.messages.reduce((m, x) => Math.max(m, x.id), 0);
      latestIdRef.current = maxId;
    }
  }, [data]);

  // Acquire lock on open; release on unmount
  useEffect(() => {
    if (Number.isNaN(conversationId)) return;
    let active = true;

    acquireLock(conversationId)
      .then((l) => active && setLock(l))
      .catch(() => {});

    // Refresh lock status periodically so we see other agents' holds
    const statusTimer = setInterval(() => {
      acquireLock(conversationId)
        .then((l) => active && setLock(l))
        .catch(() => {});
    }, 15000);

    return () => {
      active = false;
      clearInterval(statusTimer);
      releaseLock(conversationId).catch(() => {});
    };
  }, [conversationId]);

  // Real-time: poll for new messages
  const handleNew = useCallback((incoming: UIMessage[]) => {
    setMessages((prev) => {
      const known = new Set(prev.filter((m) => m.id > 0).map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      const maxId = incoming.reduce((m, x) => Math.max(m, x.id), latestIdRef.current);
      latestIdRef.current = maxId;
      return [...prev, ...fresh];
    });
  }, []);

  usePollMessages(conversationId, handleNew, latestIdRef, 3000, !Number.isNaN(conversationId));

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Optimistic UI handlers ───────────────────────────────
  const onOptimistic = useCallback((msg: UIMessage): number => {
    setMessages((prev) => [...prev, msg]);
    return msg.id; // temp id (negative)
  }, []);

  const onConfirm = useCallback((tempId: number, serverMsg: UIMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? serverMsg : m)));
    if (serverMsg.id > latestIdRef.current) latestIdRef.current = serverMsg.id;
  }, []);

  const onRollback = useCallback((tempId: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
  }, []);

  const canReply = lock ? lock.owned_by_me || !lock.locked : true;

  return (
    <div className="h-screen flex">
      <div className="w-80 shrink-0">
        <ConversationList activeId={conversationId} />
      </div>

      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-14 shrink-0 border-b border-slate-200 bg-white flex items-center justify-between px-6">
          <div>
            <span className="font-semibold text-slate-900">
              {data?.customer_name ?? "Conversation"}
            </span>
            {data && (
              <span className="ml-3 text-xs text-slate-400 capitalize">
                {data.status} · sentiment: {data.sentiment}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <LockIndicator lock={lock} />
            <button
              onClick={() => { logout(); router.replace("/login"); }}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {isLoading && <p className="text-center text-sm text-slate-400">Loading thread…</p>}
          {isError && <p className="text-center text-sm text-red-500">Failed to load conversation.</p>}
          <div className="max-w-2xl mx-auto space-y-3">
            {messages.map((m, i) => (
              <div
                key={m.id > 0 ? m.id : `temp-${i}`}
                className={`flex ${m.sender === "agent" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    m.sender === "agent"
                      ? `bg-indigo-600 text-white rounded-tr-sm ${m.optimistic ? "opacity-60" : ""} ${m.failed ? "bg-red-500" : ""}`
                      : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"
                  }`}
                >
                  {m.message}
                  {m.optimistic && (
                    <span className="ml-2 text-[10px] opacity-70">sending…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Composer */}
        <MessageComposer
          conversationId={conversationId}
          canReply={canReply}
          onOptimistic={onOptimistic}
          onConfirm={onConfirm}
          onRollback={onRollback}
        />
      </div>
    </div>
  );
}
