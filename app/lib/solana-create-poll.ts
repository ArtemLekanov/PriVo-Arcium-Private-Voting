import { Connection, PublicKey, Transaction } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK");

export function getPollPDA(payer: PublicKey, pollId: number): [PublicKey, number] {
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, pollId, true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("poll"), payer.toBytes(), idBytes],
    PROGRAM_ID
  );
}

export interface CreateNewPollParams {
  pollId: number;
  question: string;
}

export async function createNewPollTransaction(
  _connection: Connection,
  payer: PublicKey,
  params: CreateNewPollParams
): Promise<Transaction> {
  const res = await fetch("/api/create-poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: payer.toBase58(),
      pollId: params.pollId,
      question: params.question,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  const { transaction: base64 } = await res.json();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return Transaction.from(bytes);
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}
