import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

import { PROGRAM_ID } from "./program-id";
export { PROGRAM_ID };

const SUBMIT_VOTE_DISCRIMINATOR = new Uint8Array([189, 14, 111, 5, 156, 59, 54, 120]);

const DEVNET_RPC = "https://api.devnet.solana.com";

function bigintToUint8ArrayLE(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, value, true);
  return new Uint8Array(buffer);
}

export function getVoteAccountPDA(pollId: bigint, voterPubkey: PublicKey): [PublicKey, number] {
  const pollIdBytes = bigintToUint8ArrayLE(pollId);

  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("vote"),
      pollIdBytes,
      voterPubkey.toBytes(),
    ],
    PROGRAM_ID
  );
}

export interface SubmitVoteParams {
  pollId: bigint;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  x25519Pubkey: Uint8Array;
  voteIndex: number;
}

function serializeSubmitVoteData(params: SubmitVoteParams): Uint8Array {
  const { pollId, ciphertext, nonce, x25519Pubkey, voteIndex } = params;

  const buffer = new Uint8Array(97);
  let offset = 0;

  buffer.set(SUBMIT_VOTE_DISCRIMINATOR, offset);
  offset += 8;

  buffer.set(bigintToUint8ArrayLE(pollId), offset);
  offset += 8;

  buffer.set(ciphertext, offset);
  offset += 32;

  buffer.set(nonce, offset);
  offset += 16;

  buffer.set(x25519Pubkey, offset);
  offset += 32;

  buffer[offset] = voteIndex;

  return buffer;
}

export function createSubmitVoteInstruction(
  voterPubkey: PublicKey,
  params: SubmitVoteParams
): TransactionInstruction {
  const [voteAccount] = getVoteAccountPDA(params.pollId, voterPubkey);

  const data = serializeSubmitVoteData(params);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: voterPubkey, isSigner: true, isWritable: true },
      { pubkey: voteAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export async function createVoteTransaction(
  connection: Connection,
  voterPubkey: PublicKey,
  params: SubmitVoteParams
): Promise<Transaction> {
  const instruction = createSubmitVoteInstruction(voterPubkey, params);

  const transaction = new Transaction().add(instruction);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = voterPubkey;

  return transaction;
}

export function getConnection(): Connection {
  return new Connection(DEVNET_RPC, "confirmed");
}

export function encryptedVoteToParams(
  encryptedVote: {
    ciphertext: number[][];
    nonce: string;
    x25519PublicKey: string;
    voteIndex: number;
  },
  pollId: bigint = BigInt(0)
): SubmitVoteParams {
  const ciphertext = new Uint8Array(encryptedVote.ciphertext[0] || new Array(32).fill(0));

  const nonce = Uint8Array.from(atob(encryptedVote.nonce), (c) => c.charCodeAt(0));

  const x25519Pubkey = Uint8Array.from(atob(encryptedVote.x25519PublicKey), (c) => c.charCodeAt(0));

  return {
    pollId,
    ciphertext,
    nonce,
    x25519Pubkey,
    voteIndex: encryptedVote.voteIndex,
  };
}

export function encryptedVoteToVoteApiBody(
  encryptedVote: {
    ciphertext: number[][];
    nonce: string;
    x25519PublicKey: string;
  },
  pollId: number = 0
): { vote: string; voteEncryptionPubkey: string; voteNonce: string } {
  const ciphertext = new Uint8Array(encryptedVote.ciphertext[0] || new Array(32).fill(0));
  const nonce = Uint8Array.from(atob(encryptedVote.nonce), (c) => c.charCodeAt(0));
  const x25519Pubkey = Uint8Array.from(atob(encryptedVote.x25519PublicKey), (c) => c.charCodeAt(0));
  const toBase64 = (u: Uint8Array) =>
    btoa(String.fromCharCode(...u));
  return {
    vote: toBase64(ciphertext),
    voteEncryptionPubkey: toBase64(x25519Pubkey),
    voteNonce: toBase64(nonce),
  };
}

export interface RevealResult {
  yesWins: boolean;
}

export interface RevealResultCounts {
  yes: number;
  no: number;
  maybe: number;
}

const REVEAL_EVENT_NAMES = [
  "event:RevealResultEvent",
  "event:reveal_result_event",
  "event:arcium_hello::RevealResultEvent",
  "event:arcium_hello::reveal_result_event",
  "RevealResultEvent",
];

async function getRevealResultEventDiscriminators(): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const name of REVEAL_EVENT_NAMES) {
    const msg = new TextEncoder().encode(name);
    const hash = await crypto.subtle.digest("SHA-256", msg as unknown as ArrayBuffer);
    out.push(new Uint8Array(hash, 0, 8));
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function parseRevealResultBoolFromLogs(
  logMessages: string[] | null
): Promise<RevealResult | null> {
  if (!logMessages?.length) return null;
  const discriminators = await getRevealResultEventDiscriminators();

  for (const line of logMessages) {
    const dataIdx = line.indexOf("Program data:");
    if (dataIdx === -1) continue;
    const after = line.slice(dataIdx + "Program data:".length).replace(/\s/g, "");
    if (!after) continue;
    try {
      const bin = Uint8Array.from(atob(after), (c) => c.charCodeAt(0));
      if (bin.length < 9) continue;
      const match = discriminators.some((d) => bytesEqual(bin.subarray(0, 8), d));
      if (match) {
        return { yesWins: bin[8] !== 0 };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function parseRevealResultFromLogs(
  logMessages: string[] | null
): Promise<RevealResultCounts | null> {
  if (!logMessages?.length) return null;
  return null;
}

export async function findRevealCallbackResult(
  connection: Connection,
  programId: PublicKey,
  afterSlot: number,
  maxAttempts: number = 20
): Promise<{ result: RevealResult; callbackSignature: string } | null> {
  const sigs = await connection.getSignaturesForAddress(programId, {
    limit: maxAttempts,
  });

  for (const sigInfo of sigs) {
    if (sigInfo.slot <= afterSlot) continue;
    if (sigInfo.err) continue;

    try {
      const tx = await connection.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta?.logMessages) continue;

      const hasCallback = tx.meta.logMessages.some(
        (l) => l.includes("reveal_result_callback") || l.includes("RevealResultCallback")
      );
      if (!hasCallback) continue;

      const result = await parseRevealResultBoolFromLogs(tx.meta.logMessages);
      if (result) {
        return { result, callbackSignature: sigInfo.signature };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}

export function getSolanaFMUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}
