"use client";

import { useEffect, useRef } from "react";
import { fetchMessages } from "@/lib/api";
import type { MessageItem } from "@/types";

/**
 * usePollMessages — polls the backend for new messages every `intervalMs`.
 *
 * Why polling (vs WebSockets/SSE)? See README. Short version: polling needs
 * zero extra infra (no ASGI server, no channel layer), works behind any proxy,
 * and 3s latency is perfectly acceptable for a support inbox. The transport is
 * isolated in this hook, so swapping to SSE/WS later touches only this file.
 *
 * It fetches only messages with id greater than the latest known id (`after`),
 * so each poll is cheap.
 */
export function usePollMessages(
  conversationId: number,
  onNew: (messages: MessageItem[]) => void,
  latestIdRef: React.MutableRefObject<number>,
  intervalMs = 3000,
  enabled = true
) {
  const savedOnNew = useRef(onNew);
  savedOnNew.current = onNew;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const after = latestIdRef.current || undefined;
        const msgs = await fetchMessages(conversationId, after);
        if (!cancelled && msgs.length > 0) {
          savedOnNew.current(msgs);
        }
      } catch {
        // swallow poll errors; next tick retries
      }
    };

    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, intervalMs, enabled, latestIdRef]);
}
