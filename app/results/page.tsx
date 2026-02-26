"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";
import {
  findRevealCallbackResult,
  getExplorerUrl,
  PROGRAM_ID,
  type RevealResult,
} from "../lib/solana-vote";

function getAvailablePolls(): MyPollEntry[] {
  if (typeof window === "undefined") return [];
  const list: MyPollEntry[] = [];
  for (let id = 0; id <= 99; id++) {
    const a = localStorage.getItem(`pollAuthority_${id}`);
    if (a) {
      const q = localStorage.getItem(`pollQuestion_${id}`);
      const d = localStorage.getItem(`pollDescription_${id}`);
      list.push({ authority: a, pollId: id, question: q ?? undefined, description: d ?? undefined });
    }
  }
  return list.sort((a, b) => a.pollId - b.pollId);
}

type MyPollEntry = {
  authority: string;
  pollId: number;
  question?: string;
  description?: string;
  revealedAt?: number;
  yesWins?: boolean;
  revealSignature?: string;
};

export default function ResultsPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [availablePolls, setAvailablePolls] = useState<MyPollEntry[]>([]);
  const [selectedPollId, setSelectedPollId] = useState<number>(0);
  const [revealTxSig, setRevealTxSig] = useState<string | null>(null);
  const [revealResult, setRevealResult] = useState<RevealResult | null>(null);
  const [callbackSig, setCallbackSig] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [loadingFetch, setLoadingFetch] = useState(true);
  const [manualPollId, setManualPollId] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [revealedPolls, setRevealedPolls] = useState<{ authority: string; pollId: number; question?: string; description?: string; revealedAt: number; yesWins: boolean; revealSignature?: string }[]>([]);
  const [resultsSection, setResultsSection] = useState<"all" | "my">("all");

  const pollFromStorage = availablePolls.find((p) => p.pollId === selectedPollId);
  const effectivePollInfo = pollFromStorage ?? (connected && publicKey && manualPollId.trim() !== ""
    ? { authority: publicKey.toBase58(), pollId: parseInt(manualPollId, 10) || 0, question: undefined, description: undefined }
    : null);

  const isAuthority =
    connected &&
    publicKey &&
    effectivePollInfo &&
    publicKey.toBase58() === effectivePollInfo.authority;

  const searchForCallback = useCallback(
    async (revealSig: string): Promise<{ result: RevealResult; callbackSignature: string } | null> => {
      setFetchError(null);
      try {
        const revealTx = await connection.getTransaction(revealSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!revealTx) {
          setFetchError("Reveal transaction not found yet. Try again later.");
          return null;
        }
        const afterSlot = revealTx.slot;

        const found = await findRevealCallbackResult(connection, PROGRAM_ID, afterSlot);
        if (found) {
          setRevealResult(found.result);
          setCallbackSig(found.callbackSignature);
          localStorage.setItem(
            `revealResult_${effectivePollInfo?.pollId}`,
            JSON.stringify({ yesWins: found.result.yesWins, callbackSig: found.callbackSignature })
          );
          return found;
        }

        setFetchError("Callback transaction not found yet. MXE may still be computing (usually 15 to 60 seconds on Devnet). Try again.");
        return null;
      } catch (e) {
        const msg = String(e);
        console.error("searchForCallback error:", e);
        if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("rate limit")) {
          setFetchError("RPC rate limit. Try again in a minute.");
        } else {
          setFetchError("Something went wrong. Try again.");
        }
        return null;
      }
    },
    [connection, effectivePollInfo]
  );

  const saveRevealedToServer = useCallback(
    async (authority: string, pollId: number, yesWins: boolean, revealSignature: string | null) => {
      try {
        await fetch("/api/polls/revealed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authority, pollId, yesWins, revealSignature }),
        });
      } catch (e) {
        console.error("Failed to save revealed result to server:", e);
      }
    },
    []
  );

  useEffect(() => {
    if (connected && publicKey) {
      fetch(`/api/polls?authority=${encodeURIComponent(publicKey.toBase58())}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.polls)) {
            setAvailablePolls(data.polls);
            if (data.polls.length > 0) {
              setSelectedPollId(Math.max(...data.polls.map((p: { pollId: number }) => p.pollId)));
            }
          }
        })
        .catch(() => setAvailablePolls(getAvailablePolls()));
    } else {
      const polls = getAvailablePolls();
      setAvailablePolls(polls);
      if (polls.length > 0) {
        setSelectedPollId(Math.max(...polls.map((p) => p.pollId)));
      }
    }
  }, [connected, publicKey]);

  useEffect(() => {
    fetch("/api/polls")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.polls)) {
          const revealed = data.polls.filter(
            (p: { revealedAt?: number }) => p.revealedAt != null
          ) as { authority: string; pollId: number; question?: string; description?: string; revealedAt: number; yesWins: boolean; revealSignature?: string }[];
          setRevealedPolls([...revealed].sort((a, b) => b.revealedAt - a.revealedAt));
        }
      })
      .catch(() => setRevealedPolls([]));
  }, []);

  useEffect(() => {
    if (!effectivePollInfo) {
      setLoadingFetch(false);
      setRevealTxSig(null);
      setRevealResult(null);
      setCallbackSig(null);
      setFetchError(null);
      return;
    }
    setRevealResult(null);
    setCallbackSig(null);
    setFetchError(null);

    const storedResult = typeof window !== "undefined"
      ? localStorage.getItem(`revealResult_${effectivePollInfo.pollId}`)
      : null;
    if (storedResult) {
      try {
        const parsed = JSON.parse(storedResult);
        setRevealResult({ yesWins: parsed.yesWins });
        setCallbackSig(parsed.callbackSig ?? null);
        setLoadingFetch(false);
        return;
      } catch { }
    }

    const storedSig = typeof window !== "undefined"
      ? localStorage.getItem(`revealTxSignature_${effectivePollInfo.pollId}`)
      : null;
    if (storedSig) {
      setRevealTxSig(storedSig);
      setLoadingFetch(true);
      searchForCallback(storedSig).then((found) => {
        if (found && effectivePollInfo) {
          saveRevealedToServer(effectivePollInfo.authority, effectivePollInfo.pollId, found.result.yesWins, found.callbackSignature);
          fetch("/api/polls").then((r) => r.json()).then((data) => {
            if (Array.isArray(data.polls)) {
              const rev = data.polls.filter((p: { revealedAt?: number }) => p.revealedAt != null) as { authority: string; pollId: number; question?: string; description?: string; revealedAt: number; yesWins: boolean; revealSignature?: string }[];
              setRevealedPolls([...rev].sort((a, b) => b.revealedAt - a.revealedAt));
            }
          }).catch(() => {});
          if (publicKey) {
            fetch(`/api/polls?authority=${encodeURIComponent(publicKey.toBase58())}`)
              .then((r) => r.json())
              .then((data) => { if (Array.isArray(data.polls)) setAvailablePolls(data.polls); })
              .catch(() => {});
          }
        }
      }).finally(() => setLoadingFetch(false));
    } else {
      setRevealTxSig(null);
      setLoadingFetch(false);
    }
  }, [effectivePollInfo, searchForCallback, saveRevealedToServer]);

  const handleReveal = async (poll?: MyPollEntry) => {
    const targetPoll = poll ?? effectivePollInfo;
    if (!connected || !publicKey || !targetPoll || publicKey.toBase58() !== targetPoll.authority) {
      setStatus("Only the poll creator (authority) can reveal results.");
      return;
    }
    if (poll) setSelectedPollId(poll.pollId);

    setLoadingReveal(true);
    setStatus("");

    try {
      setStatus("Creating reveal_result transaction...");
      const res = await fetch("/api/reveal-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          pollId: targetPoll.pollId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error: ${res.status}`);
      }
      const { transaction: txBase64 } = await res.json();
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const transaction = Transaction.from(txBytes);

      setStatus("Sign the transaction in your wallet...");
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: true,
        maxRetries: 3,
      });
      setRevealTxSig(signature);
      localStorage.setItem(`revealTxSignature_${targetPoll.pollId}`, signature);

      setStatus("Waiting for confirmation...");
      await connection.confirmTransaction(signature, "confirmed");
      setStatus("Reveal confirmed. Waiting for MXE callback (usually 15 to 60 seconds)...");

      await new Promise((r) => setTimeout(r, 15000));

      let result: RevealResult | null = null;
      let callbackSignature: string | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        setStatus(`Looking for callback transaction\u2026 (${attempt + 1}/8)`);
        const found = await searchForCallback(signature);
        if (found) {
          result = found.result;
          callbackSignature = found.callbackSignature;
          setStatus("Result found!");
          await saveRevealedToServer(targetPoll.authority, targetPoll.pollId, found.result.yesWins, found.callbackSignature);
          fetch("/api/polls").then((r) => r.json()).then((data) => {
            if (Array.isArray(data.polls)) {
              const rev = data.polls.filter((p: { revealedAt?: number }) => p.revealedAt != null) as { authority: string; pollId: number; question?: string; description?: string; revealedAt: number; yesWins: boolean; revealSignature?: string }[];
              setRevealedPolls([...rev].sort((a, b) => b.revealedAt - a.revealedAt));
            }
          }).catch(() => {});
          if (publicKey) {
            fetch(`/api/polls?authority=${encodeURIComponent(publicKey.toBase58())}`)
              .then((r) => r.json())
              .then((data) => {
                if (Array.isArray(data.polls)) setAvailablePolls(data.polls);
              })
              .catch(() => {});
          }
          break;
        }
        if (attempt < 7) await new Promise((r) => setTimeout(r, 8000));
      }
      if (!result) {
        setStatus("Reveal sent. Callback not found yet. Click «Load results» in 30 to 60 seconds.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User rejected") || msg.includes("cancelled")) {
        setStatus("Signature cancelled.");
      } else {
        let statusMsg = `Error: ${msg}`;
        if (msg.includes("429") || msg.includes("rate limit") || msg.includes("Too Many Requests")) {
          statusMsg += " RPC rate limit. Try again later.";
        }
        setStatus(statusMsg);
      }
    } finally {
      setLoadingReveal(false);
    }
  };

  return (
    <PageLayout>
      <main className="max-w-4xl mx-auto py-20 px-6">
        <div className="mb-6">
          <BackButton />
        </div>
        <div className="flex items-center justify-center gap-3 mb-8">
          <h1 className="text-4xl font-bold">Voting Results</h1>
          <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 px-2.5 py-0.5 text-xs font-medium text-fuchsia-300 border border-fuchsia-500/30">
            Devnet
          </span>
        </div>

        <div className="relative mb-8 px-5 pt-3 pb-5 rounded-xl bg-zinc-700/30 border border-zinc-600 text-center">
          <span
            className="absolute top-2 left-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-600/80 text-zinc-400 text-[10px] font-semibold"
            aria-hidden
          >
            i
          </span>
          <span
            className="absolute top-2 right-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-600/80 text-zinc-400 text-[10px] font-semibold"
            aria-hidden
          >
            i
          </span>
          <p className="text-zinc-200 font-medium text-xl">Private Voting Results</p>
          <p className="text-base text-zinc-400 mt-2 mx-auto">
            After voting, the poll creator clicks &quot;Reveal results&quot;. The encrypted computation runs on the Arcium MXE and returns the winner (Yes or No) without revealing exact vote counts. When the creator reveals, the result and the date of the last reveal are saved. You can reveal again, the date shown is always the latest See <a href="/how-it-works" className="text-fuchsia-400 hover:underline">How it works</a>.
          </p>
        </div>

        <div className="flex gap-3 mb-8 border-b border-fuchsia-500/30 pb-3">
          <button
            type="button"
            onClick={() => setResultsSection("all")}
            className={`flex-1 py-3.5 px-4 rounded-xl text-base font-bold tracking-wide transition shadow-sm ${
              resultsSection === "all"
                ? "bg-fuchsia-500/32 text-fuchsia-100 border border-fuchsia-400/70 shadow-[0_0_0_1px_rgba(232,121,249,0.22),0_10px_26px_-18px_rgba(232,121,249,0.85)]"
                : "bg-fuchsia-500/14 text-zinc-100 border border-fuchsia-500/25 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/50"
            }`}
          >
            All Results
          </button>
          <button
            type="button"
            onClick={() => setResultsSection("my")}
            className={`flex-1 py-3.5 px-4 rounded-xl text-base font-bold tracking-wide transition shadow-sm ${
              resultsSection === "my"
                ? "bg-fuchsia-500/32 text-fuchsia-100 border border-fuchsia-400/70 shadow-[0_0_0_1px_rgba(232,121,249,0.22),0_10px_26px_-18px_rgba(232,121,249,0.85)]"
                : "bg-fuchsia-500/14 text-zinc-100 border border-fuchsia-500/25 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/50"
            }`}
          >
            My Results
          </button>
        </div>

        {resultsSection === "all" && (
          <section className="mb-10">
            {revealedPolls.length === 0 ? (
              <p className="text-center text-zinc-500 py-8">
                No revealed results yet. Creators can reveal results in the &quot;My results&quot; tab.
              </p>
            ) : (
                <div className="poll-list-scroll space-y-4 max-h-96 overflow-y-auto">
                  {revealedPolls.map((p) => (
                    <div
                      key={`${p.authority}-${p.pollId}`}
                      className="w-full text-left px-4 py-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-h-[4.5rem]"
                    >
                      <div className="flex flex-col items-start min-w-0 flex-1">
                        <span className="font-bold text-lg text-zinc-100">{p.question || `Poll ${p.pollId}`}</span>
                        {p.description && (
                          <span className="text-xs text-zinc-300 mt-0.5 truncate block" title={p.description}>
                            {p.description.length > 50 ? p.description.slice(0, 50) + "…" : p.description}
                          </span>
                        )}
                        <p className="text-xs text-zinc-400 mt-1">
                          <span>Poll ID: {p.pollId}</span>
                          <span className="block truncate max-w-full" title={p.authority}>
                            Creator: {p.authority.slice(0, 4)}…{p.authority.slice(-4)}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-col sm:items-end gap-1 shrink-0">
                        <div className={`px-4 py-2 rounded-lg text-lg font-bold border ${p.yesWins ? "bg-green-500/20 text-green-300 border-green-500/50" : "bg-red-500/20 text-red-300 border-red-500/50"}`}>
                          {p.yesWins ? "Yes wins" : "No wins"}
                        </div>
                        <p className="text-xs text-zinc-400">
                          Results revealed on {new Date(p.revealedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC
                        </p>
                        {p.revealSignature && (
                          <a
                            href={getExplorerUrl(p.revealSignature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fuchsia-400 hover:text-fuchsia-300 underline text-xs"
                          >
                            Callback tx →
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
            )}
          </section>
        )}

        {resultsSection === "my" && (
          <>
            {effectivePollInfo && revealResult && (
              <div className="mb-10 text-center">
                <h2 className="text-4xl font-bold mb-4">Thank you!</h2>
                <p className="text-xl text-zinc-300 mb-4 text-center">
                  Your results have been revealed.
                  <span className="inline-flex align-middle ml-2 text-green-400" aria-hidden>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                </p>
                {revealTxSig && (
                  <div className="mb-2">
                    <a
                      href={getExplorerUrl(revealTxSig)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fuchsia-400 hover:text-fuchsia-300 underline text-sm"
                    >
                      View reveal transaction on Solscan
                    </a>
                  </div>
                )}
                {callbackSig && (
                  <div className="mb-4">
                    <a
                      href={getExplorerUrl(callbackSig)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-zinc-300 underline text-sm"
                    >
                      View callback transaction
                    </a>
                  </div>
                )}
                <div className={`inline-block px-8 py-4 rounded-2xl text-2xl font-bold mb-4 border ${revealResult.yesWins ? "bg-green-500/20 text-green-300 border-green-500/50" : "bg-red-500/20 text-red-300 border-red-500/50"}`}>
                  {revealResult.yesWins ? "Yes wins" : "No wins"}
                </div>
                <p className="text-base text-zinc-300 max-w-md mx-auto mb-8">
                  Exact vote counts are never revealed - only the winner is computed privately on the Arcium MXE.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (effectivePollInfo) {
                      localStorage.removeItem(`revealResult_${effectivePollInfo.pollId}`);
                      localStorage.removeItem(`revealTxSignature_${effectivePollInfo.pollId}`);
                    }
                    setRevealResult(null);
                    setCallbackSig(null);
                    setRevealTxSig(null);
                    setStatus("");
                  }}
                  className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back
                </button>
              </div>
            )}

            {!revealResult && (loadingReveal || (revealTxSig && effectivePollInfo)) && (
              <div className="mb-10 text-center py-12">
                <p className="text-xl text-zinc-300 mb-2">Loading results...</p>
                {status && <p className="text-xl font-medium text-fuchsia-400 mt-4">{status}</p>}
              </div>
            )}

            {!revealResult && !loadingReveal && (!revealTxSig || !effectivePollInfo) && (
              <div className="max-w-5xl mx-auto space-y-6">
                {!connected && availablePolls.length === 0 && (
                  <div className="p-6 rounded-xl border border-zinc-600 bg-zinc-800/30 text-center">
                    <p className="text-zinc-400">Connect the creator wallet to see your polls.</p>
                  </div>
                )}
                {connected && availablePolls.length === 0 && (
                  <div className="p-6 rounded-xl border border-zinc-600 bg-zinc-800/30 text-center">
                    <p className="text-zinc-400">You have not created any polls yet.</p>
                  </div>
                )}
                {availablePolls.length > 0 && (
                  <ul className="poll-list-scroll space-y-4 max-h-96 overflow-y-auto list-none pl-0">
                      {availablePolls.map((p) => (
                      <li
                        key={`${p.authority}-${p.pollId}`}
                        className="w-full text-left px-4 py-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-h-[4.5rem]"
                      >
                        <div className="flex flex-col items-start min-w-0 flex-1">
                          <span className="font-bold text-lg text-zinc-100">{p.question || `Poll ${p.pollId}`}</span>
                          {p.description && (
                            <span className="text-xs text-zinc-300 mt-0.5 truncate block" title={p.description}>
                              {p.description.length > 50 ? p.description.slice(0, 50) + "…" : p.description}
                            </span>
                          )}
                          <p className="text-xs text-zinc-400 mt-1">
                            <span>Poll ID: {p.pollId}</span>
                            <span className="block truncate max-w-full" title={p.authority}>
                              Creator: {p.authority.slice(0, 4)}…{p.authority.slice(-4)}
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-col sm:items-end gap-2 shrink-0">
                          {p.revealedAt != null ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2 justify-end">
                                <div className={`px-4 py-2 rounded-lg text-lg font-bold border ${p.yesWins ? "bg-green-500/20 text-green-300 border-green-500/50" : "bg-red-500/20 text-red-300 border-red-500/50"}`}>
                                  {p.yesWins ? "Yes wins" : "No wins"}
                                </div>
                                {connected && publicKey && publicKey.toBase58() === p.authority && (
                                  <button
                                    type="button"
                                    onClick={() => { setSelectedPollId(p.pollId); handleReveal(p); }}
                                    disabled={loadingReveal}
                                    className="px-4 py-2 rounded-lg text-lg font-bold bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-200 hover:bg-fuchsia-500/30 disabled:opacity-50"
                                  >
                                    Reveal again
                                  </button>
                                )}
                              </div>
                              <p className="text-xs text-zinc-400">
                                Results revealed on {new Date(p.revealedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC
                              </p>
                              {p.revealSignature && (
                                <a
                                  href={getExplorerUrl(p.revealSignature)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-fuchsia-400 hover:text-fuchsia-300 underline text-xs"
                                >
                                  Callback tx →
                                </a>
                              )}
                            </>
                          ) : (
                            <>
                              {connected && publicKey && publicKey.toBase58() === p.authority ? (
                                <button
                                  type="button"
                                  onClick={() => { setSelectedPollId(p.pollId); handleReveal(p); }}
                                  disabled={loadingReveal}
                                  className="px-4 py-2 rounded-lg text-lg font-bold bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-200 hover:bg-fuchsia-500/30 disabled:opacity-50"
                                >
                                  {loadingReveal ? "Sending..." : "Reveal results"}
                                </button>
                              ) : (
                                <span className="text-zinc-500 text-sm">Not revealed yet</span>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                    </ul>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </PageLayout>
  );
}
