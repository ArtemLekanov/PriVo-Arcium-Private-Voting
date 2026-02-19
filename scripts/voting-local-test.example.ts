/**
 * Example local voting test for arcium_hello project.
 *
 * WHERE TO COPY: on VPS to ~/arcium_hello/tests/voting.ts
 *
 * WHAT TO SET:
 * 1. Program name in workspace — if not ArciumHello, use the type from target/types (e.g. Arcium_hello).
 * 2. Anchor.toml [programs.localnet] must have your program id for localnet.
 * 3. Arcium.toml must have [localnet] (nodes = 2, backends = ["Cerberus"]).
 *
 * RUN (from arcium_hello root on VPS):
 *   yarn install
 *   arcium test
 * or
 *   yarn test
 *
 * If test passes, local tests work. Then you can report e.g. "Local tests pass, Devnet callback not received".
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { randomBytes, createHash } from "crypto";
import nacl from "tweetnacl";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";

// Replace with your program type if not ArciumHello (see target/types after anchor build)
type ArciumHelloProgram = anchor.Program;

const ENCRYPTION_KEY_MESSAGE = "arcium-voting-encryption-key-v1";

function deriveEncryptionKey(
  wallet: anchor.web3.Keypair,
  message: string
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, wallet.secretKey);
  const privateKey = new Uint8Array(
    createHash("sha256").update(signature).digest()
  );
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

function readKpJson(path: string): anchor.web3.Keypair {
  const resolved = path.startsWith("~") ? path.replace("~", os.homedir()) : path;
  const file = fs.readFileSync(resolved);
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries = 20,
  retryDelayMs = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (e) {
      console.log(`Attempt ${attempt} getMXEPublicKey failed:`, e);
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error("Failed to fetch MXE public key");
}

describe("Voting (arcium_hello local)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.ArciumHello as ArciumHelloProgram;
  const provider = anchor.getProvider();

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  type EventMap = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof EventMap>(
    eventName: E
  ): Promise<EventMap[E]> => {
    let listenerId: number;
    const event = await new Promise<EventMap[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event: EventMap[E]) => {
        res(event);
      });
    });
    program.removeEventListener(listenerId!);
    return event;
  };

  it("create poll, vote, finalize, then reveal", async () => {
    const POLL_ID = 0;
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("MXE x25519 pubkey ok");

    console.log("Initializing vote stats computation definition");
    const initVoteStatsSig = await initVoteStatsCompDef(program, provider as anchor.AnchorProvider, owner);
    console.log("init_vote_stats_comp_def:", initVoteStatsSig);

    console.log("Initializing vote computation definition");
    const initVoteSig = await initVoteCompDef(program, provider as anchor.AnchorProvider, owner);
    console.log("init_vote_comp_def:", initVoteSig);

    console.log("Initializing reveal_result computation definition");
    const initRRSig = await initRevealResultCompDef(program, provider as anchor.AnchorProvider, owner);
    console.log("init_reveal_result_comp_def:", initRRSig);

    const { privateKey, publicKey } = deriveEncryptionKey(owner, ENCRYPTION_KEY_MESSAGE);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const pollNonce = randomBytes(16);
    const pollComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const pollSig = await program.methods
      .createNewPoll(
        pollComputationOffset,
        POLL_ID,
        "Local test poll",
        new anchor.BN(deserializeLE(pollNonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          pollComputationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_vote_stats")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" });
    console.log("create_new_poll:", pollSig);

    const finalizePollSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      pollComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("finalize poll:", finalizePollSig);

    const voteValue = 1; // 0 = no, 1 = yes (u8; for bool would be true/false)
    const plaintext = [BigInt(voteValue)];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const voteEventPromise = awaitEvent("voteEvent" as keyof EventMap).catch(() => null);

    const voteComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueVoteSig = await program.methods
      .vote(
        voteComputationOffset,
        POLL_ID,
        Array.from(ciphertext[0] ?? new Array(32).fill(0)),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          voteComputationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("vote")).readUInt32LE()
        ),
        authority: owner.publicKey,
      })
      .rpc({ skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" });
    console.log("vote queue:", queueVoteSig);

    const finalizeVoteSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      voteComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("finalize vote:", finalizeVoteSig);

    const voteEvent = await voteEventPromise;
    if (voteEvent) {
      console.log("VoteEvent received, timestamp:", (voteEvent as { timestamp?: anchor.BN })?.timestamp?.toString());
    } else {
      console.log("VoteEvent not in IDL or not emitted — but finalization succeeded, callback likely ran");
    }

    const revealComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const revealEventPromise = awaitEvent("revealResultEvent" as keyof EventMap);

    const revealQueueSig = await program.methods
      .revealResult(revealComputationOffset, POLL_ID)
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          revealComputationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("reveal_result")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" });
    console.log("reveal queue:", revealQueueSig);

    const revealFinalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      revealComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("reveal finalize:", revealFinalizeSig);

    const revealEvent = await revealEventPromise;
    console.log("RevealResultEvent:", revealEvent);
    expect(revealEvent).to.not.be.undefined;
  });
});

async function initVoteStatsCompDef(
  program: ArciumHelloProgram,
  provider: anchor.AnchorProvider,
  owner: anchor.web3.Keypair
): Promise<string> {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("init_vote_stats");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  const sig = await program.methods
    .initVoteStatsCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    } as any)
    .signers([owner])
    .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });

  const rawCircuit = fs.readFileSync("build/init_vote_stats.arcis");
  await uploadCircuit(provider, "init_vote_stats", program.programId, rawCircuit, true);
  return sig;
}

async function initVoteCompDef(
  program: ArciumHelloProgram,
  provider: anchor.AnchorProvider,
  owner: anchor.web3.Keypair
): Promise<string> {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("vote");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  const sig = await program.methods
    .initVoteCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    } as any)
    .signers([owner])
    .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });

  const rawCircuit = fs.readFileSync("build/vote.arcis");
  await uploadCircuit(provider, "vote", program.programId, rawCircuit, true);
  return sig;
}

async function initRevealResultCompDef(
  program: ArciumHelloProgram,
  provider: anchor.AnchorProvider,
  owner: anchor.web3.Keypair
): Promise<string> {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("reveal_result");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  const sig = await program.methods
    .initRevealResultCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    } as any)
    .signers([owner])
    .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });

  const rawCircuit = fs.readFileSync("build/reveal_result.arcis");
  await uploadCircuit(provider, "reveal_result", program.programId, rawCircuit, true);
  return sig;
}
