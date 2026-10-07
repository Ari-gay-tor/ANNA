"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiFailure, api } from "./api";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { Sidebar } from "./Sidebar";
import type { ClientConversation, ClientMessage } from "./types";
import styles from "./ChatApp.module.css";

const UNANSWERED_NOTICE = "ANNA has not replied to your last message yet.";

export function ChatApp() {
  const router = useRouter();
  const selectedId = useSearchParams().get("c");

  const [conversations, setConversations] = useState<ClientConversation[]>([]);
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(selectedId !== null); // fetching the selected conversation
  const [error, setError] = useState<string | null>(null);
  // The conversation currently shown. Kept in a ref so async handlers see the latest value.
  const activeIdRef = useRef<string | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations((await api.listConversations()).conversations);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  // On load: tell the server the browser's timezone, and fetch the sidebar.
  useEffect(() => {
    api.saveTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {});
    void refreshConversations();
  }, [refreshConversations]);

  // Follow ?c=<id>: load that conversation (or clear the pane when there is none).
  useEffect(() => {
    if (selectedId === activeIdRef.current) return;
    activeIdRef.current = selectedId;
    setError(null);
    if (!selectedId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getConversation(selectedId)
      .then((r) => {
        if (activeIdRef.current === selectedId) {
          setMessages(r.messages);
          setLoading(false);
          // A saved user message with no reply (e.g. the page was refreshed after a failure) still needs Retry.
          if (r.messages[r.messages.length - 1]?.role === "user") setError(UNANSWERED_NOTICE);
        }
      })
      .catch((e) => {
        if (activeIdRef.current !== selectedId) return;
        setLoading(false);
        setMessages([]);
        if (e instanceof ApiFailure && e.status === 404) {
          activeIdRef.current = null;
          router.replace("/");
        } else {
          setError(messageOf(e));
        }
      });
  }, [selectedId, router]);

  /** Switch the pane to a conversation that was just created, without reloading it. */
  function adopt(conversationId: string) {
    if (activeIdRef.current === conversationId) return;
    activeIdRef.current = conversationId;
    router.replace(`/?c=${encodeURIComponent(conversationId)}`);
  }

  /** Returns true if the user's message was accepted (saved), even when the reply failed. */
  async function send(text: string): Promise<boolean> {
    const pending: ClientMessage = {
      id: `pending-${Date.now()}`,
      conversationId: activeIdRef.current ?? "",
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, pending]);
    setBusy(true);
    setError(null);
    try {
      const result = await api.chat(activeIdRef.current ?? undefined, text);
      adopt(result.conversationId);
      setMessages((m) => [...m.filter((x) => x.id !== pending.id), result.userMessage, result.assistantMessage]);
      return true;
    } catch (e) {
      if (e instanceof ApiFailure && e.conversationId && e.userMessage) {
        const saved = e.userMessage;
        adopt(e.conversationId);
        setMessages((m) => [...m.filter((x) => x.id !== pending.id), saved]);
        setError(e.message);
        return true;
      }
      setMessages((m) => m.filter((x) => x.id !== pending.id));
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
      void refreshConversations();
    }
  }

  async function retry() {
    const id = activeIdRef.current;
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.retryReply(id);
      setMessages((m) => [...m, result.assistantMessage]);
    } catch (e) {
      if (e instanceof ApiFailure && e.kind === "REPLY_NOT_NEEDED") {
        // The reply already exists on the server; show it instead of an error.
        const reloaded = await api.getConversation(id).catch(() => null);
        if (reloaded) setMessages(reloaded.messages);
      } else {
        setError(messageOf(e));
      }
    } finally {
      setBusy(false);
      void refreshConversations();
    }
  }

  const lastMessage = messages[messages.length - 1];
  const canRetry = Boolean(error && activeIdRef.current && lastMessage?.role === "user" && !lastMessage.id.startsWith("pending-"));

  return (
    <div className={styles.layout}>
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        disabled={busy}
        onSelect={(id) => router.push(`/?c=${encodeURIComponent(id)}`)}
        onNew={() => router.push("/")}
      />
      <main className={styles.main}>
        <MessageList messages={messages} thinking={busy} loading={loading} />
        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            {canRetry && (
              <button type="button" onClick={retry} disabled={busy}>
                Retry
              </button>
            )}
          </div>
        )}
        <Composer disabled={busy} onSend={send} />
      </main>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
