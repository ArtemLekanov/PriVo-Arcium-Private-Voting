"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";
import {
  parseRevealResultFromLogs,
  getExplorerUrl,
  type RevealResultCounts,
} from "../lib/solana-vote";

const OPTIONS = ["Yes, absolutely", "No, not really", "I'm not sure yet"];

function getAvailablePolls(): { authority: string; pollId: number; question?: string; description?: string }[] {
  if (typeof window === "undefined") return [];
  const list: { authority: string; pollId: number; question?: string; description?: string }[] = [];
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

export default function ResultsPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [availablePolls, setAvailablePolls] = useState<{ authority: string; pollId: number; question?: string; description?: string }[]>([]);
  const [selectedPollId, setSelectedPollId] = useState<number>(0);
  const [revealTxSig, setRevealTxSig] = useState<string | null>(null);
  const [onChainResults, setOnChainResults] = useState<RevealResultCounts | null>(null);
  const [resultsHint, setResultsHint] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [loadingFetch, setLoadingFetch] = useState(true);
  const [manualPollId, setManualPollId] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pastedSignature, setPastedSignature] = useState("");
  const [debugLogs, setDebugLogs] = useState<{
    programDataBlobs: { length: number; first8Hex: string }[];
    expectedDiscriminators: Record<string, string>;
    matchingEventNames?: string[] | string;
    conclusion?: string;
  } | null>(null);

  const pollFromStorage = availablePolls.find((p) => p.pollId === selectedPollId);
  const effectivePollInfo = pollFromStorage ?? (connected && publicKey && manualPollId.trim() !== ""
    ? { authority: publicKey.toBase58(), pollId: parseInt(manualPollId, 10) || 0, question: undefined, description: undefined }
    : null);

  const isAuthority =
    connected &&
    publicKey &&
    effectivePollInfo &&
    publicKey.toBase58() === effectivePollInfo.authority;

  /** First try to read results from the poll account (if the program writes revealed_yes/no/maybe). */
  const fetchResultsFromAccount = useCallback(
    async (): Promise<
      | { counts: RevealResultCounts; hint?: string }
      | { error: string; hint?: string }
      | null
    > => {
      if (!effectivePollInfo) return null;
      try {
        const r = await fetch(
          `/api/poll-results?authority=${encodeURIComponent(effectivePollInfo.authority)}&pollId=${effectivePollInfo.pollId}`
        );
        const data = await r.json();
        if (data.yes !== undefined && data.no !== undefined && data.maybe !== undefined) {
          return {
            counts: { yes: data.yes, no: data.no, maybe: data.maybe },
            hint: data.hint,
          };
        }
        if (data.error === "old_poll_account" && data.hint) {
          return { error: data.error, hint: data.hint };
        }
        return null;
      } catch {
        return null;
      }
    },
    [effectivePollInfo]
  );

  const fetchRevealResult = useCallback(
    async (signature: string): Promise<{ counts: RevealResultCounts | null; error?: string }> => {
      setFetchError(null);
      const fromAccount = await fetchResultsFromAccount();
      if (fromAccount && "counts" in fromAccount) {
        setOnChainResults(fromAccount.counts);
        setResultsHint(fromAccount.hint ?? null);
        setFetchError(null);
        return { counts: fromAccount.counts };
      }
      if (fromAccount && "error" in fromAccount) {
        setFetchError(fromAccount.hint || fromAccount.error);
        return { counts: null, error: fromAccount.error };
      }
      try {
        const tx = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) {
          setFetchError("Transaction not found or not yet indexed. Try again later.");
          return { counts: null, error: "tx_not_found" };
        }
        const logs = tx.meta.logMessages;
        const counts = await parseRevealResultFromLogs(logs);
        if (counts) {
          setOnChainResults(counts);
          setFetchError(null);
          return { counts };
        }
        setFetchError("Could not read results from this transaction. Try again later.");
        return { counts: null, error: "parse_failed" };
      } catch (e) {
        const msg = String(e);
        console.error("Fetch reveal result:", e);
        if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("rate limit")) {
          setFetchError("RPC rate limit. Try again in a minute.");
          return { counts: null, error: "429" };
        }
        setFetchError("Something went wrong. Try again.");
        return { counts: null, error: "network" };
      }
    },
    [connection, fetchResultsFromAccount]
  );

  // Load polls: from API by wallet when connected, else from localStorage (same device only)
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
    if (!effectivePollInfo) {
      setLoadingFetch(false);
      setRevealTxSig(null);
      setOnChainResults(null);
      setResultsHint(null);
      setFetchError(null);
      return;
    }
    setOnChainResults(null);
    setResultsHint(null);
    setFetchError(null);
    const stored = typeof window !== "undefined" ? localStorage.getItem(`revealTxSignature_${effectivePollInfo.pollId}`) : null;
    if (stored) {
      setRevealTxSig(stored);
      setLoadingFetch(true);
      fetchRevealResult(stored).finally(() => setLoadingFetch(false));
    } else {
      setRevealTxSig(null);
      setLoadingFetch(false);
    }
  }, [effectivePollInfo, fetchRevealResult]);

  const handleReveal = async () => {
    if (!connected || !publicKey || !effectivePollInfo || publicKey.toBase58() !== effectivePollInfo.authority) {
      setStatus("Only the poll creator (authority) can reveal results.");
      return;
    }

    setLoadingReveal(true);
    setStatus("");

    try {
      setStatus("Creating reveal_result transaction...");
      const res = await fetch("/api/reveal-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          pollId: effectivePollInfo.pollId,
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
      localStorage.setItem(`revealTxSignature_${effectivePollInfo.pollId}`, signature);

      setStatus("Waiting for confirmation...");
      await connection.confirmTransaction(signature, "confirmed");
      setStatus("Loading results from network...");
      await new Promise((r) => setTimeout(r, 5000));
      let counts: RevealResultCounts | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetchRevealResult(signature);
        counts = result.counts;
        if (counts && counts.yes + counts.no + counts.maybe > 0) break;
        await new Promise((r) => setTimeout(r, 8000));
      }
      setStatus(
        counts && counts.yes + counts.no + counts.maybe > 0
          ? "Results revealed."
          : "Reveal sent."
      );
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
        <h1 className="text-4xl font-bold mb-8 text-center">Voting Results</h1>

        <div className="mb-8 p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center">
          <p className="text-amber-200/95 font-medium text-xl">Results will appear later</p>
          <p className="text-base text-zinc-400 mt-2 max-w-xl mx-auto">
            Results are temporarily unavailable due to Devnet limitations (callback). Votes are already stored on-chain; when the infrastructure is updated, the creator will be able to reveal results and they will appear here.
          </p>
        </div>

        <details open className="mb-6 rounded-xl border border-zinc-600 bg-zinc-800/30 overflow-hidden">
          <summary className="px-4 py-3 text-zinc-300 text-sm cursor-pointer hover:text-zinc-200">
            For poll creator: reveal results
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-3">
        {availablePolls.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            <span className="text-zinc-400 text-sm self-center">Poll:</span>
            {availablePolls.map((p) => (
              <button
                key={p.pollId}
                type="button"
                onClick={() => setSelectedPollId(p.pollId)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition text-left max-w-xs min-w-[8rem] ${
                  selectedPollId === p.pollId
                    ? "bg-fuchsia-500/30 border border-fuchsia-500 text-fuchsia-200"
                    : "bg-zinc-800/50 border border-zinc-600 text-zinc-400 hover:border-fuchsia-500/30 hover:text-zinc-200"
                }`}
              >
                {p.question ? (
                  <>
                    <span className="font-medium block truncate" title={p.question}>{p.question.length > 35 ? p.question.slice(0, 35) + "…" : p.question}</span>
                    {p.description && <span className="block text-xs text-zinc-500 truncate mt-0.5" title={p.description}>{p.description.length > 30 ? p.description.slice(0, 30) + "…" : p.description}</span>}
                    <span className="block text-xs text-zinc-500 mt-0.5">Poll ID: {p.pollId}</span>
                  </>
                ) : (
                  `Poll ${p.pollId}`
                )}
              </button>
            ))}
          </div>
        )}

        {!effectivePollInfo && (
          <div className="space-y-3 text-center">
            <p className="text-zinc-400">
              Create a poll in this browser or enter Poll ID (if you&apos;re the creator from another device):
            </p>
            <input
              type="number"
              min={0}
              placeholder="Poll ID (0, 1, 2...)"
              value={manualPollId}
              onChange={(e) => setManualPollId(e.target.value)}
              className="w-32 px-3 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/20 text-zinc-100 text-sm"
            />
            <p className="text-xs text-zinc-500">Connect the creator wallet and enter the poll ID.</p>
          </div>
        )}

        {effectivePollInfo && loadingFetch && (
          <p className="text-center text-zinc-400">Loading results...</p>
        )}

        {effectivePollInfo && !loadingFetch && !onChainResults && (
          <div className="space-y-4">
            {!revealTxSig ? (
              <>
                <p className="text-center text-zinc-300">
                  Voting in progress. Results are visible only after reveal (Reveal results).
                </p>
                {isAuthority ? (
                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={handleReveal}
                      disabled={loadingReveal}
                      className="px-8 py-4 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-200 font-medium hover:bg-fuchsia-500/30 disabled:opacity-50"
                    >
                      {loadingReveal ? "Sending..." : "Reveal results"}
                    </button>
                    <p className="text-xs text-zinc-500">Only your wallet (authority) can reveal results.</p>
                  </div>
                ) : (
                  <p className="text-center text-zinc-500 text-sm">
                    The &quot;Reveal results&quot; button is only available to the poll creator (authority).
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 max-w-lg mx-auto">
                <p className="text-center text-zinc-400 text-sm">
                  Reveal transaction sent. Results are fetched via callback (may not appear on Devnet yet).
                </p>
                <a
                  href={getExplorerUrl(pastedSignature.trim() || revealTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fuchsia-400 hover:text-fuchsia-300 underline text-sm"
                >
                  View transaction on Solscan →
                </a>
                <details className="w-full rounded-lg border border-zinc-600 bg-zinc-900/50">
                  <summary className="px-3 py-2 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
                    Debug: load by signature and logs
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-3">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Transaction signature:</label>
                      <input
                        type="text"
                        placeholder="Paste from Solscan..."
                        value={pastedSignature}
                        onChange={(e) => setPastedSignature(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/20 text-zinc-100 text-sm font-mono"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        const sig = pastedSignature.trim() || revealTxSig;
                        if (!sig) return;
                        setLoadingFetch(true);
                        setFetchError(null);
                        for (let attempt = 0; attempt < 3; attempt++) {
                          const result = await fetchRevealResult(sig);
                          if (result.counts) break;
                          if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
                        }
                        setLoadingFetch(false);
                      }}
                      disabled={loadingFetch || !(pastedSignature.trim() || revealTxSig)}
                      className="px-4 py-2 rounded-lg bg-zinc-700 border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-600 disabled:opacity-50"
                    >
                      {loadingFetch ? "Loading…" : "Load results"}
                    </button>
                    {fetchError && (
                      <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1">
                        {fetchError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const sig = pastedSignature.trim() || revealTxSig;
                        if (!sig) return;
                        try {
                          const r = await fetch(`/api/debug-reveal-logs?signature=${encodeURIComponent(sig)}`);
                          const data = await r.json();
                          if (data.ok && data.programDataBlobs) {
                            setDebugLogs({
                              programDataBlobs: data.programDataBlobs,
                              expectedDiscriminators: data.expectedDiscriminators ?? {},
                              matchingEventNames: data.matchingEventNames,
                              conclusion: data.conclusion,
                            });
                          } else {
                            setDebugLogs(null);
                            setFetchError(data.error || "Debug error");
                          }
                        } catch (e) {
                          setFetchError(String(e));
                        }
                      }}
                      className="text-xs text-zinc-500 hover:text-zinc-300 underline block"
                    >
                      Debug logs (Program data)
                    </button>
                    {debugLogs && (
                      <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all bg-zinc-800 rounded p-2">
                        {JSON.stringify(
                          {
                            programDataBlobs: debugLogs.programDataBlobs,
                            expectedDiscriminators: debugLogs.expectedDiscriminators,
                            matchingEventNames: debugLogs.matchingEventNames,
                            conclusion: debugLogs.conclusion,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                    {debugLogs?.conclusion && (
                      <p className="text-amber-400/90 text-xs border border-amber-500/30 rounded p-2">
                        {debugLogs.conclusion}
                      </p>
                    )}
                  </div>
                </details>
              </div>
            )}
            {status && (
              <p className={`text-center text-sm ${status.startsWith("Error") ? "text-red-400" : "text-zinc-400"}`}>
                {status}
              </p>
            )}
          </div>
        )}
          </div>
        </details>

        {effectivePollInfo && !loadingFetch && onChainResults && (
          <div className="space-y-6">
            <p className="text-center text-zinc-400">
              {effectivePollInfo.question ? (
                <>
                  <span className="text-zinc-200">{effectivePollInfo.question}</span>
                  <span className="text-zinc-500 ml-2">(Poll ID: {effectivePollInfo.pollId})</span>
                </>
              ) : (
                `Poll ID: ${effectivePollInfo.pollId}`
              )}
            </p>
            {effectivePollInfo.description && (
              <p className="text-center text-sm text-zinc-500 max-w-xl mx-auto">{effectivePollInfo.description}</p>
            )}
            <div className="space-y-4">
              {OPTIONS.map((option, idx) => {
                const key = idx === 0 ? "yes" : idx === 1 ? "no" : "maybe";
                const count = onChainResults[key];
                const total = onChainResults.yes + onChainResults.no + onChainResults.maybe;
                const percentage = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div
                    key={option}
                    className="p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-lg font-medium text-zinc-100">{option}</span>
                      <span className="text-xl font-bold text-fuchsia-300">
                        {count} {count === 1 ? "vote" : "votes"}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-fuchsia-500 transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="mt-2 text-sm text-zinc-400">{percentage.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-zinc-400">
              Total votes:{" "}
              <strong className="text-fuchsia-300">
                {onChainResults.yes + onChainResults.no + onChainResults.maybe}
              </strong>
            </p>
            {(() => {
              const storedSig = typeof window !== "undefined" && effectivePollInfo ? localStorage.getItem(`revealTxSignature_${effectivePollInfo.pollId}`) : null;
              const sig = revealTxSig ?? storedSig ?? "";
              if (!sig) return null;
              return (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setLoadingFetch(true);
                      setFetchError(null);
                      const result = await fetchRevealResult(sig);
                      if (result.counts) setOnChainResults(result.counts);
                      setLoadingFetch(false);
                    }}
                    disabled={loadingFetch}
                    className="px-5 py-2.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-200 text-sm font-medium hover:bg-fuchsia-500/30 disabled:opacity-50"
                  >
                    {loadingFetch ? "Loading…" : "Load results again"}
                  </button>
                  <a
                    href={getExplorerUrl(sig)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fuchsia-400 hover:text-fuchsia-300 underline text-sm"
                  >
                    View reveal transaction on Solscan →
                  </a>
                </div>
              );
            })()}
          </div>
        )}
    </main>
    </PageLayout>
  );
}
