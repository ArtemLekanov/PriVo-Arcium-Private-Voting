"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";
import { encryptedVoteToVoteApiBody, getExplorerUrl } from "../lib/solana-vote";
import { Transaction } from "@solana/web3.js";

export type PollEntry = { authority: string; pollId: number; question: string; description?: string };

export default function VotePage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [status, setStatus] = useState("");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [manualAuthority, setManualAuthority] = useState("");
  const [manualPollId, setManualPollId] = useState("0");
  const [polls, setPolls] = useState<PollEntry[]>([]);
  const [pollsLoading, setPollsLoading] = useState(true);
  const [pollsError, setPollsError] = useState<string | null>(null);
  const [selectedPoll, setSelectedPoll] = useState<PollEntry | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "poll">("list");

  const options = [
    "Yes, absolutely",
    "No, not really",
    "I’m not sure yet",
  ];

  useEffect(() => {
    setPollsError(null);
    fetch("/api/polls")
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data.polls)) setPolls(data.polls);
      })
      .catch((e) => {
        console.error("Failed to load polls:", e);
        setPollsError("Could not load polls right now. Please try again later.");
      })
      .finally(() => setPollsLoading(false));
  }, []);

  const effectivePoll: PollEntry | null = selectedPoll ?? (manualAuthority.trim() && manualPollId.trim()
    ? { authority: manualAuthority.trim(), pollId: parseInt(manualPollId, 10) || 0, question: "" }
    : null);

  const checkHasVoted = useCallback((authority: string, pollId: number) => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`hasVoted_${authority}_${pollId}`) === "true";
  }, []);

  useEffect(() => {
    if (!effectivePoll) {
      setHasVoted(false);
      setSubmitted(false);
      return;
    }
    const voted = checkHasVoted(effectivePoll.authority, effectivePoll.pollId);
    setHasVoted(voted);
    setSubmitted(voted);
  }, [effectivePoll?.authority, effectivePoll?.pollId, checkHasVoted]);

  const submitVote = async (option: string) => {
    if (!connected || !publicKey) {
      setStatus("Please connect your wallet first.");
      return;
    }
    if (hasVoted) return;

    try {
      setStatus("Encrypting your vote...");
      
      const response = await fetch("/api/encrypt-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          vote: option,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to encrypt vote");
      }

      const { encryptedVote } = await response.json();

      if (!effectivePoll) {
        setStatus("Select a poll from the list or enter authority and Poll ID manually.");
        return;
      }
      const authority = effectivePoll.authority;
      const pollId = effectivePoll.pollId;

      setStatus("Creating transaction...");
      const body = encryptedVoteToVoteApiBody(encryptedVote, pollId);
      const voteRes = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          pollId,
          authority,
          vote: body.vote,
          voteEncryptionPubkey: body.voteEncryptionPubkey,
          voteNonce: body.voteNonce,
        }),
      });
      if (!voteRes.ok) {
        const err = await voteRes.json().catch(() => ({}));
        throw new Error(err.error || `Vote API error: ${voteRes.status}`);
      }
      const { transaction: txBase64 } = await voteRes.json();
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const transaction = Transaction.from(txBytes);

      setStatus("Simulating transaction...");
      const sim = await connection.simulateTransaction(transaction);
      if (sim.value.err) {
        const logs = sim.value.logs?.join("\n") ?? "";
        console.error("Vote simulation failed:", sim.value.err, logs);
        throw new Error(
          `Simulation failed: ${JSON.stringify(sim.value.err)}. ${logs.slice(-500)}`
        );
      }

      setStatus("Please sign the transaction in your wallet...");
      
      const signature = await sendTransaction(transaction, connection, {
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
      setTxSignature(signature);

      setStatus("Waiting for confirmation...");
      
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }


      const votes = JSON.parse(localStorage.getItem("votes") || "[]");
      votes.push({
        ...encryptedVote,
        vote: option,
        timestamp: Date.now(),
        txSignature: signature,
        onChain: true,
      });
      localStorage.setItem("votes", JSON.stringify(votes));
      localStorage.setItem(`hasVoted_${authority}_${pollId}`, "true");
      localStorage.setItem("voteChoice", option);
      setHasVoted(true);
      setSubmitted(true);

      setStatus("Vote submitted on-chain successfully!");
    } catch (err: unknown) {
      console.error("Error submitting vote:", err);

      let errorMessage = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err.cause : null;
      if (cause && cause instanceof Error && cause.message) {
        errorMessage = cause.message;
      }
      const anyErr = err as { logs?: string[]; message?: string };
      if (anyErr.logs?.length) {
        errorMessage = anyErr.logs.join(" ").slice(0, 300);
      }

      if (
        errorMessage.includes("User rejected") ||
        errorMessage.includes("cancelled") ||
        errorMessage.includes("rejected")
      ) {
        setStatus("Transaction cancelled by user.");
        return;
      }

      if (
        errorMessage.includes("already in use") ||
        errorMessage.includes("account already exists")
      ) {
        setStatus("Your vote is already recorded on-chain! You can only vote once per poll.");
        if (effectivePoll) {
          localStorage.setItem(`hasVoted_${effectivePoll.authority}_${effectivePoll.pollId}`, "true");
        }
        setHasVoted(true);
        return;
      }

      setStatus(
        `Transaction failed: ${errorMessage.slice(0, 350)}${errorMessage.length > 350 ? "…" : ""}`
      );
    }
  };

  const handleSubmit = () => {
    if (!selectedOption) return;
    submitVote(selectedOption);
  };

  if (submitted) {
    return (
      <PageLayout>
        <main className="max-w-2xl mx-auto py-20 px-6 text-center">
          <h1 className="text-4xl font-bold mb-4">Thank you!</h1>
          <p className="text-xl text-zinc-300 mb-2">Your vote has been submitted.</p>
          
          {txSignature && (
            <div className="mb-4">
              <p className="text-sm text-green-400 mb-2">
                ✓ Vote recorded on Solana Devnet
              </p>
              <div className="flex gap-4 justify-center">
                <a
                  href={getExplorerUrl(txSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-fuchsia-400 hover:text-fuchsia-300 underline"
                >
                  Solscan →
                </a>
              </div>
            </div>
          )}
          
          <p className="text-sm text-zinc-400 mb-6">
            (You cannot vote again)
          </p>
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setViewMode("list");
                setSubmitted(false);
              }}
              className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[200px]"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back
            </button>
          </div>
        </main>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <main className="max-w-2xl mx-auto py-20 px-6">
        {viewMode === "list" && (
          <>
            <div className="flex items-center justify-center gap-3 mb-10">
              <h1 className="text-4xl font-bold">DAO Governance Vote</h1>
              <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 px-2.5 py-0.5 text-xs font-medium text-fuchsia-300 border border-fuchsia-500/30">
                Devnet
              </span>
            </div>
            {pollsLoading && <p className="text-zinc-400 mb-4 text-center">Loading polls...</p>}
            {!pollsLoading && pollsError && (
              <p className="text-amber-400 text-sm mb-4 text-center">
                {pollsError}
              </p>
            )}
            {!pollsLoading && polls.length === 0 && (
              <p className="text-zinc-500 text-sm mb-4 text-center">
                No polls yet. Create a poll on the &quot;Create poll&quot; page or enter an authority and Poll ID below.
              </p>
            )}
            {polls.length > 0 && (
              <div className="mb-6">
                <p className="text-2xl font-bold text-zinc-200 mb-6 text-center">Select Poll</p>
                <div className="poll-list-scroll space-y-4 max-h-60 overflow-y-auto">
                  {polls.map((poll) => (
                    <button
                      key={`${poll.authority}-${poll.pollId}`}
                      type="button"
                      onClick={() => {
                        setSelectedPoll(poll);
                        setSelectedOption(null);
                        setStatus("");
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition flex flex-col min-h-[4.5rem] ${
                        selectedPoll?.authority === poll.authority && selectedPoll?.pollId === poll.pollId
                          ? "border-fuchsia-500 bg-fuchsia-500/20 text-zinc-100"
                          : "border-fuchsia-500/30 bg-fuchsia-500/10 text-zinc-300 hover:border-fuchsia-500/50"
                      }`}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-bold text-lg">{poll.question || `Poll ${poll.pollId}`}</span>
                        {poll.description && <span className="text-xs text-zinc-300 mt-0.5 truncate block" title={poll.description}>{poll.description.length > 50 ? poll.description.slice(0, 50) + "…" : poll.description}</span>}
                      </div>
                      <div className="mt-auto flex flex-col items-end text-xs text-zinc-300 pt-2">
                        <span>Poll ID: {poll.pollId}</span>
                        <span className="truncate max-w-full" title={poll.authority}>Creator: {poll.authority.slice(0, 4)}…{poll.authority.slice(-4)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-6 p-4 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
              <p className="text-sm font-medium text-zinc-300 mb-3">Or enter manually (address + poll ID):</p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Creator address (authority)"
                  value={manualAuthority}
                  onChange={(e) => {
                    setManualAuthority(e.target.value);
                    setSelectedPoll(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/20 text-zinc-100 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="Poll ID (0, 1, 2...)"
                  value={manualPollId}
                  onChange={(e) => {
                    setManualPollId(e.target.value);
                    setSelectedPoll(null);
                  }}
                  className="w-32 px-3 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/20 text-zinc-100 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <BackButton />
              <button
                onClick={() => setViewMode("poll")}
                disabled={!effectivePoll}
                className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px]"
              >
                Enter
              </button>
            </div>
          </>
        )}

        {viewMode === "poll" && effectivePoll && (
          <>
            <div className="mb-6">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[200px]"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                Back
              </button>
            </div>

            <div className="p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 mb-8">
              <h2 className="text-2xl font-bold text-zinc-100 mb-2">
                {effectivePoll.question || `Poll ${effectivePoll.pollId}`}
              </h2>
              {effectivePoll.description && (
                <p className="text-zinc-400 mb-4 whitespace-pre-wrap">{effectivePoll.description}</p>
              )}
              <p className="text-xs text-zinc-400 break-all font-mono">
                Poll ID: {effectivePoll.pollId}  Creator: {effectivePoll.authority}
              </p>
            </div>

            <div className="space-y-4 mb-8">
              {options.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-3 p-4 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 transition cursor-pointer"
                >
                  <input
                    type="radio"
                    name="vote"
                    value={option}
                    onChange={() => setSelectedOption(option)}
                    disabled={hasVoted}
                    className="w-5 h-5 text-fuchsia-500"
                  />
                  <span className="text-lg text-zinc-100">{option}</span>
                </label>
              ))}
            </div>

            {!connected && (
              <p className="text-center text-red-400 mb-4">
                Please connect your wallet to vote.
              </p>
            )}

            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleSubmit}
                  disabled={!selectedOption || hasVoted || !connected}
                  className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px]"
                >
                  Submit vote
                </button>
              </div>

              {status && (
                <p className={`text-lg font-medium text-center ${
                  status.includes("already recorded") || status.includes("cancelled")
                    ? "text-yellow-400"
                    : status.includes("successfully")
                      ? "text-green-400"
                      : "text-zinc-300"
                }`}>
                  {status}
                </p>
              )}

            </div>
          </>
        )}
      </main>
    </PageLayout>
  );
}
