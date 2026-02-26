"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const DEVNET_EXPLORER = "https://explorer.solana.com";
const DEVNET_ENDPOINT = "https://api.devnet.solana.com";

interface VoteRecord {
  encrypted?: string;
  vote: string;
  timestamp: number;
  publicKey?: string;
  error?: string;
}

export default function TestPage() {
  const { connected, publicKey } = useWallet();
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [storageKeys, setStorageKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("votes");
    const parsed = raw ? JSON.parse(raw) : [];
    setVotes(Array.isArray(parsed) ? parsed : []);

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    setStorageKeys(keys);
  }, []);

  const totalVotes = votes.length;
  const exportData = () => {
    const data = {
      network: "Devnet",
      endpoint: DEVNET_ENDPOINT,
      walletConnected: connected,
      publicKey: publicKey?.toBase58() ?? null,
      exportedAt: new Date().toISOString(),
      totalVotes,
      votes,
      storageKeys: storageKeys.reduce(
        (acc, k) => ({ ...acc, [k]: localStorage.getItem(k)?.length ?? 0 }),
        {} as Record<string, number>
      ),
    };
    return JSON.stringify(data, null, 2);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(exportData());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadJson = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arcium-votes-verify-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const explorerUrl = publicKey
    ? `${DEVNET_EXPLORER}/address/${publicKey.toBase58()}?cluster=devnet`
    : null;

  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
      <h1>Data check (test)</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        This page shows where data is stored, how much, and how to export it for verification.
      </p>

      <section
        style={{
          marginBottom: 24,
          padding: 20,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          backgroundColor: "#fafafa",
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>1. Network and Phantom</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Network:</strong> Devnet (endpoint: {DEVNET_ENDPOINT})
          </li>
          <li>
            <strong>Wallet:</strong>{" "}
            {connected && publicKey ? (
              <>
                Connected —{" "}
                <code style={{ fontSize: 12 }}>
                  {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                </code>
                {explorerUrl && (
                  <>
                    {" "}
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                      Open in Solana Explorer (Devnet)
                    </a>
                  </>
                )}
              </>
            ) : (
              "Not connected"
            )}
          </li>
        </ul>
      </section>

      <section
        style={{
          marginBottom: 24,
          padding: 20,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          backgroundColor: "#fafafa",
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>2. Stored data count</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Votes in storage:</strong> {totalVotes}
          </li>
          <li>
            <strong>localStorage keys:</strong>{" "}
            {storageKeys.length ? storageKeys.join(", ") : "—"}
          </li>
          <li>
            <strong>Size (approx):</strong>{" "}
            {typeof window !== "undefined"
              ? (JSON.stringify(localStorage.getItem("votes") || "").length + " chars")
              : "—"}
          </li>
        </ul>
      </section>

      <section
        style={{
          marginBottom: 24,
          padding: 20,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          backgroundColor: "#fafafa",
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>3. Data (last votes)</h2>
        {votes.length === 0 ? (
          <p style={{ color: "#666" }}>No records. Vote on /vote.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {votes.slice(-10).reverse().map((v, i) => (
              <div
                key={i}
                style={{
                  padding: 12,
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <div>
                  <strong>Option:</strong> {v.vote}
                </div>
                <div>
                  <strong>Time:</strong>{" "}
                  {new Date(v.timestamp).toLocaleString()}
                </div>
                {v.publicKey && (
                  <div>
                    <strong>Wallet:</strong>{" "}
                    <code style={{ fontSize: 11 }}>{v.publicKey.slice(0, 12)}...</code>
                  </div>
                )}
                {v.encrypted && (
                  <div>
                    <strong>Encrypted (start):</strong>{" "}
                    <code style={{ fontSize: 11 }}>{v.encrypted.slice(0, 40)}...</code>
                  </div>
                )}
                {v.error && (
                  <div style={{ color: "#c00" }}>
                    <strong>Error:</strong> {v.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        style={{
          marginBottom: 24,
          padding: 20,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          backgroundColor: "#fafafa",
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>4. Export for testing</h2>
        <p style={{ marginBottom: 12, color: "#666" }}>
          Download JSON or copy to clipboard to verify what is stored.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={copyToClipboard}
            style={{
              padding: "10px 16px",
              backgroundColor: copied ? "#2e7d32" : "#1976d2",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
          <button
            onClick={downloadJson}
            style={{
              padding: "10px 16px",
              backgroundColor: "#333",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Download JSON
          </button>
        </div>
      </section>

      <p style={{ fontSize: 12, color: "#999" }}>
        After Arcium Devnet integration you can add here: transaction signature, Explorer link, and MXE write status.
      </p>
    </main>
  );
}
