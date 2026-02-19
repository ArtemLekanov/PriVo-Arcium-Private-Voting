/**
 * API: builds create_new_poll transaction on the server.
 * Client gets serialized transaction, signs in wallet, and sends.
 */

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

const CREATE_NEW_POLL_DISCRIMINATOR = new Uint8Array([18, 23, 205, 123, 193, 24, 162, 162]);

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
function stringBytes(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + utf8.length);
  new DataView(out.buffer).setUint32(0, utf8.length, true);
  out.set(utf8, 4);
  return out;
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

function getInitVoteStatsCompDefPDA(): PublicKey {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offsetBytes = getCompDefAccOffset("init_vote_stats");
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), PROGRAM_ID.toBuffer(), offsetBytes],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function randomU64(): bigint {
  const buf = new Uint8Array(8);
  const nodeCrypto = require("crypto") as { randomFillSync: (b: Uint8Array) => void };
  nodeCrypto.randomFillSync(buf);
  return new DataView(buf.buffer).getBigUint64(0, true);
}

function randomU128(): bigint {
  const buf = new Uint8Array(16);
  const nodeCrypto = require("crypto") as { randomFillSync: (b: Uint8Array) => void };
  nodeCrypto.randomFillSync(buf);
  const view = new DataView(buf.buffer);
  return view.getBigUint64(0, true) + (view.getBigUint64(8, true) << BigInt(64));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicKey: payerStr, pollId = 0, question = "" } = body as {
      publicKey?: string;
      pollId?: number;
      question?: string;
    };

    if (!payerStr || typeof question !== "string") {
      return NextResponse.json(
        { error: "publicKey and question required" },
        { status: 400 }
      );
    }

    const payer = new PublicKey(payerStr);
    const pollIdNum = Number(pollId);
    const questionSlice = question.slice(0, 200);

    const computationOffset = randomU64();
    const nonce = randomU128();

    const [signPda] = getSignPDA();
    const [pollAcc] = getPollPDA(payer, pollIdNum);

    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
    const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
    const compDefAccount = getInitVoteStatsCompDefPDA();
    const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
    const computationOffsetBnLike = {
      toArrayLike: (_: unknown, __: string, len: number) =>
        Buffer.from(u64LE(computationOffset).buffer, 0, len),
    };
    const computationAccount = getComputationAccAddress(
      CLUSTER_OFFSET,
      computationOffsetBnLike as { toArrayLike: (_b: unknown, _le: string, l: number) => Buffer }
    );

    const dataParts = [
      CREATE_NEW_POLL_DISCRIMINATOR,
      u64LE(computationOffset),
      u32LE(pollIdNum),
      stringBytes(questionSlice),
      u128LE(nonce),
    ];
    const dataLen = dataParts.reduce((acc, p) => acc + p.length, 0);
    const data = new Uint8Array(dataLen);
    let off = 0;
    for (const p of dataParts) {
      data.set(p, off);
      off += p.length;
    }

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
      ],
      data: Buffer.from(data),
    });

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");

    let blockhash: string;
    try {
      const result = await connection.getLatestBlockhash();
      blockhash = result.blockhash;
    } catch (rpcErr) {
      const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      console.error("create-poll RPC error:", rpcErr);
      const hint = msg.includes("fetch failed") || msg.includes("get recent blockhash")
        ? " RPC request failed (network/firewall or RPC down). Try setting NEXT_PUBLIC_SOLANA_RPC_URL in .env to a working Devnet RPC (e.g. Helius)."
        : "";
      return NextResponse.json(
        { error: msg + hint },
        { status: 500 }
      );
    }

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;

    const serialized = transaction.serialize({ requireAllSignatures: false });
    const base64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({ transaction: base64 });
  } catch (e) {
    console.error("create-poll API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build transaction" },
      { status: 500 }
    );
  }
}
