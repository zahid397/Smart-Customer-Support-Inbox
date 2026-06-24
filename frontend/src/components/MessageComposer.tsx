"use client";

import { useState } from "react";
import { sendReply, suggestReply, apiErrorMessage } from "@/lib/api";
import { useToast } from "@/components/Toast";
import type { UIMessage } from "@/types";

interface Props {
  conversationId: number;
  canReply: boolean;
  /** Insert an optimistic message; returns its temporary id. */
  onOptimistic: (msg: UIMessage) => number;
  /** Replace the optimistic message with the confirmed server message. */
  onConfirm: (tempId: number, serverMsg: UIMessage) => void;
  /** Remove an optimistic message that failed to send. */
  onRollback: (tempId: number) => void;
}

export function MessageComposer({
  conversationId,
  canReply,
  onOptimistic,
  onConfirm,
  onRollback,
}: Props) {
  const { show } = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  async function handleSend() {
    const message = text.trim();
    if (!message || sending) return;

    // 1. Optimistically insert immediately (before server confirms)
    const tempId = onOptimistic({
      id: -Date.now(),
      sender: "agent",
      message,
      created_at: new Date().toISOString(),
      optimistic: true,
    });
    setText("");
    setSending(true);

    try {
      // 2. Send to server
      const serverMsg = await sendReply(conversationId, message);
      // 3. Replace optimistic with confirmed
      onConfirm(tempId, { ...serverMsg, optimistic: false });
    } catch (err) {
      // 4. Rollback on failure + toast
      onRollback(tempId);
      show(apiErrorMessage(err) || "Failed to send message", "error");
      setText(message); // restore so the agent doesn't lose their text
    } finally {
      setSending(false);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    try {
      const suggestion = await suggestReply(conversationId, text || "");
      setText(suggestion);
    } catch (err) {
      show(apiErrorMessage(err) || "Could not get suggestion", "error");
    } finally {
      setSuggesting(false);
    }
  }

  if (!canReply) {
    return (
      <div className="border-t border-slate-200 p-4 bg-slate-50 text-center text-sm text-slate-500">
        This conversation is locked by another agent. You can read but not reply.
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 p-4 bg-white">
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={2}
          placeholder="Type your reply… (Enter to send)"
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 whitespace-nowrap"
          >
            {suggesting ? "…" : "✨ Suggest"}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
