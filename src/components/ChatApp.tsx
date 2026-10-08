"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiFailure, api } from "./api";
import { AnnaMark } from "./AnnaMark";
import { Composer } from "./Composer";
import { IconMenu } from "./icons";
import { MessageList } from "./MessageList";
import { isNewChatShortcut } from "./shortcuts";
import { Sidebar } from "./Sidebar";
import { StartScreen } from "./StartScreen";
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
  const [drawerOpen, setDrawerOpen] = useState(false); // the sidebar on narrow screens
  const [focusKey, setFocusKey] = useState(0); // bumped to put the cursor back in the composer
  // The conversation currently shown. Kept in a ref so async handlers see the latest value.
  const activeIdRef = useRef<string | null>(null);

  const focusComposer = useCallback(() => setFocusKey((k) => k + 1), []);

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
  async function send(text: string, selectedOption = false): Promise<boolean> {
    const pending: ClientMessage = {
      id: `pending-${Date.now()}`,
      conversationId: activeIdRef.current ?? "",
      role: "user",
      content: text,
      selectedOption,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, pending]);
    setBusy(true);
    setError(null);
    focusComposer(); // a tapped starter or option leaves focus on a button that is about to go away
    try {
      const result = await api.chat(activeIdRef.current ?? undefined, text, selectedOption);
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
      focusComposer();
    }
  }

  function startNewChat() {
    if (busy) return;
    setDrawerOpen(false);
    if (selectedId) router.push("/");
    focusComposer();
  }

  function selectConversation(id: string) {
    setDrawerOpen(false);
    if (id !== selectedId) router.push(`/?c=${encodeURIComponent(id)}`);
    focusComposer();
  }

  async function renameConversation(id: string, title: string) {
    try {
      await api.renameConversation(id, title);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) void refreshConversations(); // it is gone; the list catches up
      throw e;
    }
    await refreshConversations();
  }

  async function deleteConversation(id: string) {
    try {
      await api.deleteConversation(id);
    } catch (e) {
      // Already gone elsewhere: same end state as a successful delete.
      if (!(e instanceof ApiFailure && e.status === 404)) throw e;
    }
    // If it was the open one, ?c= goes away and the effect above clears the pane back to the start screen.
    if (id === activeIdRef.current) router.push("/");
    await refreshConversations();
    focusComposer();
  }

  // Ctrl+Shift+O (Cmd+Shift+O on Mac) starts a new chat. Ctrl+N is the browser's, so it is not used.
  const startNewChatRef = useRef(startNewChat);
  startNewChatRef.current = startNewChat;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewChatShortcut(event)) return;
      event.preventDefault();
      startNewChatRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Esc closes the drawer on narrow screens.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const lastMessage = messages[messages.length - 1];
  const canRetry = Boolean(error && activeIdRef.current && lastMessage?.role === "user" && !lastMessage.id.startsWith("pending-"));
  const showStart = messages.length === 0 && !busy && !loading;
  const title = conversations.find((c) => c.id === selectedId)?.title ?? "New chat";

  const errorCard = error && (
    <div className={styles.error} role="alert">
      <span className={styles.errorText}>{error}</span>
      {canRetry && (
        <button type="button" className="btn btn-sm" onClick={retry} disabled={busy}>
          Retry
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.layout}>
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        busy={busy}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={selectConversation}
        onNew={startNewChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
      />
      <main className={styles.main}>
        <div className={styles.topbar}>
          <button type="button" className={styles.menuButton} onClick={() => setDrawerOpen(true)} aria-label="Open conversations">
            <IconMenu size={20} />
          </button>
          <AnnaMark size={22} />
          <span className={styles.topbarTitle}>{title}</span>
        </div>
        {showStart ? (
          <StartScreen disabled={busy} onStarter={(text) => void send(text)} footer={errorCard} />
        ) : (
          <MessageList messages={messages} thinking={busy} onSelectOption={(text) => void send(text, true)} footer={errorCard} />
        )}
        <Composer busy={busy} focusKey={focusKey} onSend={(text) => send(text)} />
      </main>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
