import { NextResponse } from "next/server";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
  getCompDefAccOffset,
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK");
const CLUSTER_OFFSET = 456;
const POOL_ACCOUNT = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const CLOCK_ACCOUNT = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const VOTE_DISCRIMINATOR = new Uint8Array([227, 110, 155, 23, 136, 126, 172, 25]);

function u64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, value, true);
  return new Uint8Array(buf);
}
function u32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return new Uint8Array(buf);
}
function u128LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  view.setBigUint64(0, value & BigInt("0xFFFFFFFFFFFFFFFF"), true);
  view.setBigUint64(8, (value >> BigInt(64)) & BigInt("0xFFFFFFFFFFFFFFFF"), true);
  return new Uint8Array(buf);
}

function getSignPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    PROGRAM_ID
  );
}

function getPollPDA(authority: PublicKey, pollId: number): [PublicKey, number] {
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, pollId, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), authority.toBytes(), idBytes],
    PROGRAM_ID
  );
}

function getVoteReceiptPDA(pollAcc: PublicKey, voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote_receipt"), pollAcc.toBuffer(), voter.toBuffer()],
    PROGRAM_ID
  );
}

function getVoteCompDefPDA(): PublicKey {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offsetBytes = getCompDefAccOffset("vote");
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), PROGRAM_ID.toBuffer(), offsetBytes],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function serializeVoteData(
  computationOffset: bigint,
  pollId: number,
  vote: Uint8Array,
  voteEncryptionPubkey: Uint8Array,
  voteNonce: bigint
): Uint8Array {
  const parts = [
    VOTE_DISCRIMINATOR,
    u64LE(computationOffset),
    u32LE(pollId),
    vote,
    voteEncryptionPubkey,
    u128LE(voteNonce),
  ];
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function randomU64(): bigint {
  const buf = new Uint8Array(8);
  const nodeCrypto = require("crypto") as { randomFillSync: (b: Uint8Array) => void };
  nodeCrypto.randomFillSync(buf);
  return new DataView(buf.buffer).getBigUint64(0, true);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      publicKey: voterStr,
      pollId = 0,
      authority: authorityStr,
      vote: voteBase64,
      voteEncryptionPubkey: pubkeyBase64,
      voteNonce: nonceBase64,
    } = body;

    if (!voterStr || !authorityStr || !voteBase64 || !pubkeyBase64 || !nonceBase64) {
      return NextResponse.json(
        { error: "publicKey, authority, vote, voteEncryptionPubkey, voteNonce required" },
        { status: 400 }
      );
    }

    const payer = new PublicKey(voterStr);
    const authority = new PublicKey(authorityStr);
    const vote = new Uint8Array(Buffer.from(voteBase64, "base64"));
    const voteEncryptionPubkey = new Uint8Array(Buffer.from(pubkeyBase64, "base64"));
    const nonceBuf = Buffer.from(nonceBase64, "base64");
    if (vote.length !== 32 || voteEncryptionPubkey.length !== 32 || nonceBuf.length !== 16) {
      return NextResponse.json(
        { error: "vote and voteEncryptionPubkey must be 32 bytes, nonce 16 bytes" },
        { status: 400 }
      );
    }
    const nonceArr = new Uint8Array(nonceBuf);
    const nonceView = new DataView(nonceArr.buffer);
    const voteNonce =
      nonceView.getBigUint64(0, true) + (nonceView.getBigUint64(8, true) << BigInt(64));

    const [signPda] = getSignPDA();
    const [pollAcc] = getPollPDA(authority, Number(pollId));
    const [voteReceiptPda] = getVoteReceiptPDA(pollAcc, payer);
    const computationOffset = randomU64();

    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
    const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
    const compDefAccount = getVoteCompDefPDA();
    const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
    const computationOffsetBnLike = {
      toArrayLike: (_: unknown, __: string, len: number) =>
        Buffer.from(u64LE(computationOffset).buffer, 0, len),
    };
    const computationAccount = getComputationAccAddress(
      CLUSTER_OFFSET,
      computationOffsetBnLike as { toArrayLike: (b: unknown, le: string, l: number) => Buffer }
    );

    const data = serializeVoteData(
      computationOffset,
      Number(pollId),
      vote,
      voteEncryptionPubkey,
      voteNonce
    );

    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: signPda, isSigner: false, isWritable: true },
        { pubkey: mxeAccount, isSigner: false, isWritable: false },
        { pubkey: mempoolAccount, isSigner: false, isWritable: true },
        { pubkey: executingPool, isSigner: false, isWritable: true },
        { pubkey: computationAccount, isSigner: false, isWritable: true },
        { pubkey: compDefAccount, isSigner: false, isWritable: false },
        { pubkey: clusterAccount, isSigner: false, isWritable: true },
        { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
        { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: pollAcc, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: voteReceiptPda, isSigner: false, isWritable: true },
      ],
      data: Buffer.from(data),
    });

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");
    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;

    const serialized = transaction.serialize({ requireAllSignatures: false });
    const base64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({ transaction: base64 });
  } catch (e) {
    console.error("vote API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build transaction" },
      { status: 500 }
    );
  }
}
