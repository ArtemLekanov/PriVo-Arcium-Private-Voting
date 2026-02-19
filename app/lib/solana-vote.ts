import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK");

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
    data,
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
    nonce: string; // base64
    x25519PublicKey: string; // base64
    voteIndex: number;
  },
  pollId: bigint = BigInt(0)
): SubmitVoteParams {
  const ciphertext = new Uint8Array(encryptedVote.ciphertext[0] || new Array(32).fill(0));

  // nonce — base64
  const nonce = Uint8Array.from(atob(encryptedVote.nonce), (c) => c.charCodeAt(0));

  // x25519PublicKey — base64
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

export interface RevealResultCounts {
  yes: number;
  no: number;
  maybe: number;
}

const MAX_REASONABLE_VOTES = 1_000_000_000;
const MAX_RELAXED_VOTES = 1_000_000_000_000_000;

function looksLikeVoteCounts(yes: number, no: number, maybe: number): boolean {
  return (
    yes <= MAX_REASONABLE_VOTES &&
    no <= MAX_REASONABLE_VOTES &&
    maybe <= MAX_REASONABLE_VOTES &&
    yes >= 0 &&
    no >= 0 &&
    maybe >= 0
  );
}

function looksRelaxed(yes: number, no: number, maybe: number): boolean {
  return (
    yes <= MAX_RELAXED_VOTES && no <= MAX_RELAXED_VOTES && maybe <= MAX_RELAXED_VOTES &&
    yes >= 0 && no >= 0 && maybe >= 0
  );
}

const REVEAL_EVENT_NAMES = [
  "event:RevealResultEvent",
  "event:reveal_result_event",
  "event:arcium_hello::RevealResultEvent",
  "event:arcium_hello::reveal_result_event",
  "RevealResultEvent",
  "event:RevealResult",
  "event:reveal_result",
  "RevealResult",
  "event:RevealVotingResult",
  "event:reveal_voting_result",
];

async function getRevealResultEventDiscriminators(): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const name of REVEAL_EVENT_NAMES) {
    const msg = new TextEncoder().encode(name);
    const hash = await crypto.subtle.digest("SHA-256", msg);
    out.push(new Uint8Array(hash, 0, 8));
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function parseRevealResultFromLogs(
  logMessages: string[] | null
): Promise<RevealResultCounts | null> {
  if (!logMessages?.length) return null;
  const discriminators = await getRevealResultEventDiscriminators();
  const candidates: RevealResultCounts[] = [];

  const relaxedCandidates: { counts: RevealResultCounts; sum: number }[] = [];

  for (const line of logMessages) {
    const dataIdx = line.indexOf("Program data:");
    const loggedIdx = line.indexOf("Program logged:");
    const i = dataIdx >= 0 ? dataIdx : loggedIdx >= 0 ? loggedIdx : -1;
    if (i === -1) continue;
    const prefix = dataIdx >= 0 ? "Program data:" : "Program logged:";
    const after = line.slice(i + prefix.length).replace(/\s/g, "");
    if (!after) continue;
    try {
      const bin = Uint8Array.from(atob(after), (c) => c.charCodeAt(0));
      if (bin.length < 24) continue;
      const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

      const tryOffsets = (yesOff: number, noOff: number, maybeOff: number): RevealResultCounts | null => {
        if (maybeOff + 8 > bin.length) return null;
        const yes = Number(view.getBigUint64(yesOff, true));
        const no = Number(view.getBigUint64(noOff, true));
        const maybe = Number(view.getBigUint64(maybeOff, true));
        return looksLikeVoteCounts(yes, no, maybe) ? { yes, no, maybe } : null;
      };

      const tryOffsetsRelaxed = (yesOff: number, noOff: number, maybeOff: number): RevealResultCounts | null => {
        if (maybeOff + 8 > bin.length) return null;
        const yes = Number(view.getBigUint64(yesOff, true));
        const no = Number(view.getBigUint64(noOff, true));
        const maybe = Number(view.getBigUint64(maybeOff, true));
        return looksRelaxed(yes, no, maybe) ? { yes, no, maybe } : null;
      };

      if (bin.length >= 32) {
        const match = discriminators.some((d) => bytesEqual(bin.subarray(0, 8), d));
        if (match) {
          const r = tryOffsets(8, 16, 24);
          if (r) return r;
        }
        const r1 = tryOffsets(8, 16, 24);
        if (r1) candidates.push(r1);
        if (bin.length >= 40) {
          const r2 = tryOffsets(16, 24, 32);
          if (r2) candidates.push(r2);
        }
        if (bin.length === 48 && candidates.length === 0) {
          const a = tryOffsetsRelaxed(8, 16, 24);
          if (a) relaxedCandidates.push({ counts: a, sum: a.yes + a.no + a.maybe });
          const b = tryOffsetsRelaxed(16, 24, 32);
          if (b) relaxedCandidates.push({ counts: b, sum: b.yes + b.no + b.maybe });
        }
      } else {
        const r = tryOffsets(0, 8, 16);
        if (r) candidates.push(r);
      }
    } catch {
      continue;
    }
  }
  if (candidates.length > 0) return candidates[0];
  if (relaxedCandidates.length > 0) {
    relaxedCandidates.sort((a, b) => a.sum - b.sum);
    return relaxedCandidates[0].counts;
  }
  return null;
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}

export function getSolanaFMUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}
