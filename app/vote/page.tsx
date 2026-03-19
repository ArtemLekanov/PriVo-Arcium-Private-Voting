"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";
import { encryptedVoteToVoteApiBody, getExplorerUrl } from "../lib/solana-vote";
import { Transaction } from "@solana/web3.js";

export type PollEntry = {
  authority: string;
  pollId: number;
  question: string;
  description?: string;
  createdAt?: number;
  whitelist?: string[];
};

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
  const [submitting, setSubmitting] = useState(false);
  const [listSection, setListSection] = useState<"all" | "profile" | "manual">("all");
  const [pollsMy, setPollsMy] = useState<PollEntry[]>([]);
  const [pollsMyLoading, setPollsMyLoading] = useState(false);
  const [pollsMyError, setPollsMyError] = useState<string | null>(null);
  const [allPollsSort, setAllPollsSort] = useState<"created_desc" | "created_asc" | "az" | "za">("created_desc");
  const [myPollsSort, setMyPollsSort] = useState<"created_desc" | "created_asc" | "az" | "za">("created_desc");
  const [allSortOpen, setAllSortOpen] = useState(false);
  const [mySortOpen, setMySortOpen] = useState(false);
  const allSortRef = useRef<HTMLDivElement | null>(null);
  const mySortRef = useRef<HTMLDivElement | null>(null);

  const options = [
    "Yes, absolutely",
    "No, not really",
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

  useEffect(() => {
    if (listSection !== "profile") return;
    if (!connected) {
      setPollsMy([]);
      setPollsMyLoading(false);
      setPollsMyError(null);
      return;
    }
    if (!publicKey) {
      setPollsMyLoading(true);
      return;
    }
    const authority = publicKey.toBase58();
    setPollsMyError(null);
    setPollsMyLoading(true);
    fetch(`/api/polls?authority=${encodeURIComponent(authority)}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data.polls)) setPollsMy(data.polls);
      })
      .catch((e) => {
        console.error("Failed to load my polls:", e);
        setPollsMyError("Could not load your polls.");
      })
      .finally(() => setPollsMyLoading(false));
  }, [listSection, connected, publicKey]);

  useEffect(() => {
    if (!allSortOpen && !mySortOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAllSortOpen(false);
        setMySortOpen(false);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const allEl = allSortRef.current;
      const myEl = mySortRef.current;
      if (!(e.target instanceof Node)) return;
      if (allEl && !allEl.contains(e.target)) setAllSortOpen(false);
      if (myEl && !myEl.contains(e.target)) setMySortOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [allSortOpen]);

  const pollsSorted = useMemo(() => {
    const getTitle = (p: PollEntry) => (p.question?.trim() ? p.question.trim() : `Poll ${p.pollId}`);
    const list = [...polls];

    if (allPollsSort === "az" || allPollsSort === "za") {
      list.sort((a, b) => getTitle(a).localeCompare(getTitle(b), undefined, { sensitivity: "base" }));
      if (allPollsSort === "za") list.reverse();
      return list;
    }

    list.sort((a, b) => {
      const ax = a.createdAt ?? null;
      const bx = b.createdAt ?? null;
      if (ax === null && bx === null) return 0;
      if (ax === null) return 1;
      if (bx === null) return -1;
      return allPollsSort === "created_desc" ? bx - ax : ax - bx;
    });
    return list;
  }, [polls, allPollsSort]);

  const pollsMySorted = useMemo(() => {
    const getTitle = (p: PollEntry) => (p.question?.trim() ? p.question.trim() : `Poll ${p.pollId}`);
    const list = [...pollsMy];

    if (myPollsSort === "az" || myPollsSort === "za") {
      list.sort((a, b) => getTitle(a).localeCompare(getTitle(b), undefined, { sensitivity: "base" }));
      if (myPollsSort === "za") list.reverse();
      return list;
    }

    list.sort((a, b) => {
      const ax = a.createdAt ?? null;
      const bx = b.createdAt ?? null;
      if (ax === null && bx === null) return 0;
      if (ax === null) return 1;
      if (bx === null) return -1;
      return myPollsSort === "created_desc" ? bx - ax : ax - bx;
    });
    return list;
  }, [pollsMy, myPollsSort]);

  const allSortLabel = useMemo(() => {
    switch (allPollsSort) {
      case "created_desc":
        return "Newest first";
      case "created_asc":
        return "Oldest first";
      case "az":
        return "A → Z";
      case "za":
        return "Z → A";
      default:
        return "Sort";
    }
  }, [allPollsSort]);

  const mySortLabel = useMemo(() => {
    switch (myPollsSort) {
      case "created_desc":
        return "Newest first";
      case "created_asc":
        return "Oldest first";
      case "az":
        return "A → Z";
      case "za":
        return "Z → A";
      default:
        return "Sort";
    }
  }, [myPollsSort]);

  const effectivePoll: PollEntry | null = selectedPoll ?? (manualAuthority.trim() && manualPollId.trim()
    ? { authority: manualAuthority.trim(), pollId: parseInt(manualPollId, 10) || 0, question: "" }
    : null);

  const checkHasVoted = useCallback((voter: string, authority: string, pollId: number) => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`hasVoted_${voter}_${authority}_${pollId}`) === "true";
  }, []);

  useEffect(() => {
    if (!effectivePoll) {
      setHasVoted(false);
      setSubmitted(false);
      return;
    }
    if (!connected || !publicKey) {
      setHasVoted(false);
      setSubmitted(false);
      return;
    }
    const voted = checkHasVoted(publicKey.toBase58(), effectivePoll.authority, effectivePoll.pollId);
    setHasVoted(voted);
    setSubmitted(voted);
  }, [effectivePoll?.authority, effectivePoll?.pollId, checkHasVoted, connected, publicKey]);

  const submitVote = async (option: string) => {
    if (!connected || !publicKey) {
      setStatus("Please connect your wallet first.");
      return;
    }
    if (hasVoted) return;
    if (submitting) return;
    setSubmitting(true);

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
        maxRetries: 0,
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
      localStorage.setItem(`hasVoted_${publicKey.toBase58()}_${authority}_${pollId}`, "true");
      localStorage.setItem("voteChoice", option);
      setHasVoted(true);
      setSubmitted(true);
      setSubmitting(false);
      setStatus("Vote submitted on-chain successfully!");
    } catch (err: unknown) {
      setSubmitting(false);
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

      if (errorMessage.includes("insufficient lamports") || errorMessage.includes("insufficient funds")) {
        setStatus("Not enough SOL in your wallet to pay for the transaction. Please top up your balance.");
        return;
      }

      if (errorMessage.includes("Custom\":4") || errorMessage.includes("Custom\": 4") || errorMessage.includes("Custom\":6004") || errorMessage.includes("0x1774")) {
        setStatus("Your wallet is not in the whitelist for this poll. Only whitelisted addresses can vote.");
        return;
      }

      if (
        errorMessage.includes("already in use") ||
        errorMessage.includes("account already exists")
      ) {
        setStatus("Your vote is already recorded on-chain! You can only vote once per poll.");
        if (effectivePoll && publicKey) {
          localStorage.setItem(`hasVoted_${publicKey.toBase58()}_${effectivePoll.authority}_${effectivePoll.pollId}`, "true");
        }
        setHasVoted(true);
        setSubmitted(true);
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

  if ((submitted || hasVoted) && effectivePoll && viewMode === "poll") {
    return (
      <PageLayout>
        <main className="max-w-3xl mx-auto py-20 px-6 text-center">
          <h1 className="text-2xl md:text-4xl font-bold mb-4">Thank you!</h1>
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
          <div className="flex flex-wrap items-center justify-center gap-4">
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
            <a
              href="/results"
              className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[200px]"
            >
              Results
            </a>
          </div>
        </main>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <main className="max-w-3xl mx-auto py-20 px-4 md:px-6">
        {viewMode === "list" && (
          <>
            <div className="flex flex-col items-center justify-center gap-2 mb-8 md:mb-10">
              <h1 className="text-3xl md:text-5xl font-bold text-center">DAO Governance Vote</h1>
              <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 px-2.5 py-0.5 text-xs font-medium text-fuchsia-300 border border-fuchsia-500/30">
                Devnet
              </span>
            </div>

            <div className="flex gap-2 md:gap-3 mb-6 md:mb-8 border-b border-fuchsia-500/30 pb-3">
              <button
                type="button"
                onClick={() => setListSection("all")}
                className={`flex-1 py-2.5 md:py-3.5 px-2 md:px-4 rounded-xl text-sm md:text-base font-bold tracking-wide transition shadow-sm ${
                  listSection === "all"
                    ? "bg-fuchsia-500/32 text-fuchsia-100 border border-fuchsia-400/70 shadow-[0_0_0_1px_rgba(232,121,249,0.22),0_10px_26px_-18px_rgba(232,121,249,0.85)]"
                    : "bg-fuchsia-500/14 text-zinc-100 border border-fuchsia-500/25 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/50"
                }`}
              >
                All Polls
              </button>
              <button
                type="button"
                onClick={() => setListSection("profile")}
                className={`flex-1 py-2.5 md:py-3.5 px-2 md:px-4 rounded-xl text-sm md:text-base font-bold tracking-wide transition shadow-sm ${
                  listSection === "profile"
                    ? "bg-fuchsia-500/32 text-fuchsia-100 border border-fuchsia-400/70 shadow-[0_0_0_1px_rgba(232,121,249,0.22),0_10px_26px_-18px_rgba(232,121,249,0.85)]"
                    : "bg-fuchsia-500/14 text-zinc-100 border border-fuchsia-500/25 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/50"
                }`}
              >
                My Polls
              </button>
              <button
                type="button"
                onClick={() => setListSection("manual")}
                className={`flex-1 py-2.5 md:py-3.5 px-2 md:px-4 rounded-xl text-sm md:text-base font-bold tracking-wide transition shadow-sm ${
                  listSection === "manual"
                    ? "bg-fuchsia-500/32 text-fuchsia-100 border border-fuchsia-400/70 shadow-[0_0_0_1px_rgba(232,121,249,0.22),0_10px_26px_-18px_rgba(232,121,249,0.85)]"
                    : "bg-fuchsia-500/14 text-zinc-100 border border-fuchsia-500/25 hover:bg-fuchsia-500/20 hover:border-fuchsia-400/50"
                }`}
              >
                Manual
              </button>
            </div>

            {listSection === "all" && (
              <>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="inline-flex items-center px-4 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/25 text-zinc-100 text-sm font-semibold cursor-default select-none">
                    All polls
                  </div>
                  <div ref={allSortRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setAllSortOpen((v) => !v)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/25 text-zinc-100 text-sm font-semibold hover:bg-fuchsia-500/15 hover:border-fuchsia-400/40 transition"
                      aria-haspopup="menu"
                      aria-expanded={allSortOpen}
                      aria-label="Sort polls"
                    >
                      <span className="text-zinc-100">{allSortLabel}</span>
                      <svg
                        className={`w-4 h-4 text-zinc-300 transition ${allSortOpen ? "rotate-180" : ""}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>

                    {allSortOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-fuchsia-500/25 bg-zinc-950/40 backdrop-blur-md shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
                      >
                        {(
                          [
                            ["created_desc", "Newest first"],
                            ["created_asc", "Oldest first"],
                            ["az", "A → Z"],
                            ["za", "Z → A"],
                          ] as const
                        ).map(([value, label]) => {
                          const active = allPollsSort === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setAllPollsSort(value);
                                setAllSortOpen(false);
                              }}
                              className={`w-full text-left px-4 py-3 text-sm transition ${
                                active
                                  ? "bg-fuchsia-500/25 text-fuchsia-100"
                                  : "text-zinc-200 hover:bg-fuchsia-500/15"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {pollsLoading && <p className="text-zinc-400 mb-4 text-center">Loading polls...</p>}
                {!pollsLoading && pollsError && (
                  <p className="text-amber-400 text-sm mb-4 text-center">{pollsError}</p>
                )}
                {!pollsLoading && !pollsError && polls.length === 0 && (
                  <p className="text-zinc-500 text-sm mb-4 text-center">
                    No polls yet. Create a poll on the &quot;Create poll&quot; page or use Manual search.
                  </p>
                )}
                {!pollsLoading && polls.length > 0 && (
                  <div className="mb-6">
                    <div className="poll-list-scroll space-y-4 max-h-96 overflow-y-auto">
                      {pollsSorted.map((poll) => (
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
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg">{poll.question || `Poll ${poll.pollId}`}</span>
                              {poll.whitelist && poll.whitelist.length > 0 && (
                                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                                  WL
                                </span>
                              )}
                            </div>
                            {poll.description && (
                              <span className="text-xs text-zinc-300 mt-0.5 truncate block" title={poll.description}>
                                {poll.description.length > 50 ? poll.description.slice(0, 50) + "…" : poll.description}
                              </span>
                            )}
                          </div>
                          <div className="mt-auto flex flex-col items-end text-xs text-zinc-300 pt-2">
                            <span>Poll ID: {poll.pollId}</span>
                            <span className="truncate max-w-full" title={poll.authority}>
                              Creator: {poll.authority.slice(0, 4)}…{poll.authority.slice(-4)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {listSection === "profile" && (
              <>
                {!connected && (
                  <p className="text-zinc-500 text-sm mb-4 text-center py-4">
                    Connect your wallet to see polls you created.
                  </p>
                )}
                {connected && !publicKey && (
                  <p className="text-zinc-400 text-sm mb-4 text-center py-4">
                    Loading wallet…
                  </p>
                )}
                {connected && publicKey && (
                  <>
                    {pollsMyLoading && <p className="text-zinc-400 mb-4 text-center">Loading your polls...</p>}
                    {!pollsMyLoading && pollsMyError && (
                      <p className="text-amber-400 text-sm mb-4 text-center">{pollsMyError}</p>
                    )}
                    {!pollsMyLoading && !pollsMyError && pollsMy.length === 0 && (
                      <p className="text-zinc-500 text-sm mb-4 text-center py-4">
                        You have not created any polls yet. Create one on the &quot;Create poll&quot; page.
                      </p>
                    )}
                    {!pollsMyLoading && pollsMy.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="inline-flex items-center px-4 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/25 text-zinc-100 text-sm font-semibold cursor-default select-none">
                            My polls
                          </div>
                          <div ref={mySortRef} className="relative">
                            <button
                              type="button"
                              onClick={() => setMySortOpen((v) => !v)}
                              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/25 text-zinc-100 text-sm font-semibold hover:bg-fuchsia-500/15 hover:border-fuchsia-400/40 transition"
                              aria-haspopup="menu"
                              aria-expanded={mySortOpen}
                              aria-label="Sort my polls"
                            >
                              <span className="text-zinc-100">{mySortLabel}</span>
                              <svg
                                className={`w-4 h-4 text-zinc-300 transition ${mySortOpen ? "rotate-180" : ""}`}
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>

                            {mySortOpen && (
                              <div
                                role="menu"
                                className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-fuchsia-500/25 bg-zinc-950/40 backdrop-blur-md shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
                              >
                                {(
                                  [
                                    ["created_desc", "Newest first"],
                                    ["created_asc", "Oldest first"],
                                    ["az", "A → Z"],
                                    ["za", "Z → A"],
                                  ] as const
                                ).map(([value, label]) => {
                                  const active = myPollsSort === value;
                                  return (
                                    <button
                                      key={value}
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setMyPollsSort(value);
                                        setMySortOpen(false);
                                      }}
                                      className={`w-full text-left px-4 py-3 text-sm transition ${
                                        active
                                          ? "bg-fuchsia-500/25 text-fuchsia-100"
                                          : "text-zinc-200 hover:bg-fuchsia-500/15"
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="poll-list-scroll space-y-4 max-h-96 overflow-y-auto">
                          {pollsMySorted.map((poll) => (
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
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-lg">{poll.question || `Poll ${poll.pollId}`}</span>
                                  {poll.whitelist && poll.whitelist.length > 0 && (
                                    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                                      WL
                                    </span>
                                  )}
                                </div>
                                {poll.description && (
                                  <span className="text-xs text-zinc-300 mt-0.5 truncate block" title={poll.description}>
                                    {poll.description.length > 50 ? poll.description.slice(0, 50) + "…" : poll.description}
                                  </span>
                                )}
                              </div>
                              <div className="mt-auto flex flex-col items-end text-xs text-zinc-300 pt-2">
                                <span>Poll ID: {poll.pollId}</span>
                                <span className="truncate max-w-full" title={poll.authority}>
                                  Creator: {poll.authority.slice(0, 4)}…{poll.authority.slice(-4)}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {listSection === "manual" && (
              <div className="mb-6 p-4 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
                <p className="text-sm font-medium text-zinc-300 mb-3">Enter creator address and Poll ID:</p>
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
                <p className="text-xs text-zinc-500 mt-2">
                  Use this if you know the poll creator&apos;s address and its ID.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 md:gap-4">
              <BackButton />
              <button
                onClick={() => setViewMode("poll")}
                disabled={!effectivePoll}
                className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-6 py-3 md:px-8 md:py-4 text-lg md:text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px] md:min-w-[200px]"
              >
                Enter
              </button>
            </div>
          </>
        )}

        {viewMode === "poll" && effectivePoll && (
          <div className="max-w-2xl mx-auto">
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
              {effectivePoll.whitelist && effectivePoll.whitelist.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <p className="text-sm font-medium text-amber-300">
                    Whitelist only
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 md:gap-4 mb-8">
              {options.map((option) => (
                <label
                  key={option}
                  className="flex flex-1 items-center justify-center gap-2 md:gap-3 p-3 md:p-4 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 transition cursor-pointer min-w-0"
                >
                  <input
                    type="radio"
                    name="vote"
                    value={option}
                    onChange={() => setSelectedOption(option)}
                    disabled={hasVoted}
                    className="w-5 h-5 shrink-0 accent-fuchsia-500"
                  />
                  <span className="text-base md:text-lg text-zinc-100">{option}</span>
                </label>
              ))}
            </div>

            {!connected && (
              <p className="text-center text-red-400 mb-4">
                Please connect your wallet to vote.
              </p>
            )}

            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center justify-between gap-3 md:gap-4 w-full">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-6 py-3 md:px-8 md:py-4 text-lg md:text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[120px] md:min-w-[200px]"
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
                <button
                  onClick={handleSubmit}
                  disabled={!selectedOption || hasVoted || !connected || submitting}
                  className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-6 py-3 md:px-8 md:py-4 text-lg md:text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px] md:min-w-[200px]"
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
          </div>
        )}
      </main>
    </PageLayout>
  );
}
