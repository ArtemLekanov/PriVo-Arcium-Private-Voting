"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";
import { createNewPollTransaction, getExplorerUrl } from "../lib/solana-create-poll";

const QUESTION_MAX_LEN = 50; // limit in on-chain program

export default function CreatePollPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [question, setQuestion] = useState("Should this proposal be accepted?");
  const [description, setDescription] = useState("");
  const [pollId, setPollId] = useState(0);
  const [status, setStatus] = useState("");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const questionForChain = question.slice(0, QUESTION_MAX_LEN);

  const handleCreatePoll = async () => {
    if (!connected || !publicKey) {
      setStatus("Connect your wallet.");
      return;
    }

    try {
      setStatus("Creating transaction...");
      const transaction = await createNewPollTransaction(connection, publicKey, {
        pollId,
        question: questionForChain,
      });

      setStatus("Sign the transaction in your wallet...");
      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: true,
        maxRetries: 3,
      });
      setTxSignature(signature);

      setStatus("Waiting for confirmation...");
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Transaction rejected on network: ${JSON.stringify(confirmation.value.err)}`);
      }
      setDone(true);
      setStatus("Poll created.");
      try {
        localStorage.setItem(`pollAuthority_${pollId}`, publicKey.toBase58());
        localStorage.setItem(`pollQuestion_${pollId}`, questionForChain);
        if (description.trim()) localStorage.setItem(`pollDescription_${pollId}`, description.slice(0, 500));
        await fetch("/api/polls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authority: publicKey.toBase58(),
            pollId,
            question: questionForChain,
            ...(description.trim() && { description: description.slice(0, 500) }),
          }),
        });
      } catch (_) {}
    } catch (err: unknown) {
      console.error("Create poll error:", err);
      const anyErr = err as Record<string, unknown>;
      let msg = err instanceof Error ? err.message : "";
      if (msg === "[object Object]") msg = "";

      const findInstructionError = (o: unknown): [number, number] | null => {
        if (o && typeof o === "object") {
          const v = o as { InstructionError?: [number, { Custom?: number }] };
          if (Array.isArray(v.InstructionError)) {
            const [, code] = v.InstructionError;
            return [v.InstructionError[0], typeof code === "object" && code && "Custom" in code ? (code as { Custom: number }).Custom : 0];
          }
          for (const key of ["error", "cause", "transactionError"]) {
            const found = findInstructionError((o as Record<string, unknown>)[key]);
            if (found) return found;
          }
        }
        return null;
      };

      let ierr = findInstructionError(err);
      if (!ierr && msg.includes("InstructionError") && msg.includes("Custom")) {
        const match = msg.match(/Custom":?\s*(\d+)/);
        if (match) ierr = [0, parseInt(match[1], 10)];
      }
      if (ierr) {
        const [ixIndex, custom] = ierr;
        if (custom === 0) {
          setStatus("This Poll ID is likely already in use by your wallet. Choose another Poll ID (e.g. 1 or 2) and try again.");
          return;
        }
        msg = `Program error: instruction #${ixIndex}, code ${custom}. ` + msg;
        if (custom === 6300) {
          msg += " Arcium code 6300: after initializing on your backend, upload circuits (uploadCircuit) for init_vote_stats, vote, reveal_result (see your deployment scripts).";
        }
      }
      const logs = (anyErr.logs as string[] | undefined)?.slice(-5).join(" ");
      if (logs) msg += " Logs: " + logs;
      const causeMsg = anyErr.cause && anyErr.cause instanceof Error ? anyErr.cause.message : "";
      if (causeMsg) msg += " Cause: " + causeMsg;
      if (!msg || msg === "{}") {
        msg = "The question may be too long (max 50 characters on-chain). Shorten it and try again.";
      }
      if (msg.includes("User rejected") || msg.includes("cancelled")) {
        setStatus("Signature cancelled.");
      } else {
        setStatus(msg ? `Error: ${msg}` : `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  if (done && txSignature) {
    return (
      <PageLayout>
        <main className="max-w-2xl mx-auto py-20 px-6 text-center">
          <div className="mb-10">
            <BackButton />
          </div>
          <h1 className="text-4xl font-bold mb-4">Poll created</h1>
          <p className="text-xl text-zinc-300 mb-4">
            Wallet <code className="text-fuchsia-300">{publicKey?.toBase58().slice(0, 8)}…</code> is the authority.
            Only this wallet can run &quot;Reveal results&quot;.
          </p>
          <p className="text-zinc-400 mb-2">Poll ID: {pollId}</p>
          <a
            href={getExplorerUrl(txSignature)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fuchsia-400 hover:text-fuchsia-300 underline"
          >
            View transaction on Solscan →
          </a>
        </main>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <main className="max-w-2xl mx-auto py-20 px-6">
        <div className="mb-6">
          <BackButton />
        </div>
        <h1 className="text-4xl font-bold mb-2">Create Poll</h1>
        <p className="text-zinc-400 mb-8">
          One-time setup before users can vote. This wallet becomes the authority and can run &quot;Reveal results&quot;.
        </p>

        {!connected ? (
          <p className="text-zinc-400">Connect your wallet to create a poll.</p>
        ) : (
          <div className="space-y-6">
            <div>
              <label className="block text-lg font-medium text-zinc-300 mb-2">Poll ID</label>
              <input
                type="number"
                min={0}
                value={pollId}
                onChange={(e) => setPollId(parseInt(e.target.value, 10) || 0)}
                className="w-full px-4 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/30 text-zinc-100"
              />
              <p className="text-xs text-zinc-400 mt-1">
                0 for the first poll. If you see &quot;Custom Program Error: 0&quot; or &quot;allocate: already in use&quot;, this Poll ID is already taken - use another (1, 2, ...).
              </p>
            </div>
            <div>
              <label className="block text-lg font-medium text-zinc-300 mb-2">
                Question <span className="text-zinc-400 font-normal">(up to {QUESTION_MAX_LEN} characters - stored on-chain)</span>
              </label>
              <input
                type="text"
                maxLength={QUESTION_MAX_LEN}
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, QUESTION_MAX_LEN))}
                className="w-full px-4 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/30 text-zinc-100"
                placeholder="Should this proposal be accepted?"
              />
              <p className="text-xs text-zinc-400 mt-1">{question.length}/{QUESTION_MAX_LEN}</p>
            </div>
            <div>
              <label className="block text-lg font-medium text-zinc-300 mb-2">Description</label>
              <textarea
                rows={3}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                className="w-full px-4 py-2 rounded-lg bg-zinc-800/80 border border-fuchsia-500/30 text-zinc-100 resize-y"
                placeholder="Poll details, context..."
              />
              <p className="text-xs text-zinc-400 mt-1">{description.length}/500</p>
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleCreatePoll}
                disabled={!!status && !status.startsWith("Error") && status !== "Signature cancelled." && !status.includes("Poll ID is likely already in use")}
                className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-10 py-4 text-2xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[220px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Poll
              </button>
            </div>
            {status && (
              <p className={`text-sm ${(status.startsWith("Error") || status.includes("Poll ID is likely already in use")) ? "text-red-400" : "text-zinc-400"}`}>
                {status}
              </p>
            )}
          </div>
        )}
      </main>
    </PageLayout>
  );
}
