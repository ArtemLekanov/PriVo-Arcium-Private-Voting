import { randomBytes } from "crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  getMXEPublicKey,
} from "@arcium-hq/client";

function createDummyWallet(): { publicKey: PublicKey } {
  const kp = Keypair.generate();
  return {
    get publicKey() {
      return kp.publicKey;
    },
  } as { publicKey: PublicKey };
}

const VOTE_OPTIONS = [
  "Yes, absolutely",
  "No, not really",
  "I'm not sure yet",
];

const DEVNET_RPC =
  process.env.ARCIUM_DEVNET_RPC || "https://api.devnet.solana.com";

export type EncryptVoteParams = {
  publicKey: string;
  data: { vote: string };
};

export type EncryptedVoteResult = {
  ciphertext: number[][];
  nonce: string;
  x25519PublicKey: string;
  voteIndex: number;
  mode: "mxe" | "demo";
  timestamp: number;
  encrypted: string;
};

function getVoteIndex(vote: string): number {
  const i = VOTE_OPTIONS.indexOf(vote);
  return i >= 0 ? i : 0;
}

function createReadOnlyProvider(): AnchorProvider {
  const connection = new Connection(DEVNET_RPC);
  const wallet = createDummyWallet();
  return new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
}

async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries: number,
  delayMs: number
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const key = await getMXEPublicKey(provider, programId);
      if (key && key.length === 32) return key;
    } catch (e) {
      lastErr = e;
    }
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function encryptVote(
  params: EncryptVoteParams
): Promise<EncryptedVoteResult> {
  const { data } = params;
  const voteIndex = getVoteIndex(data.vote);
  const plaintext = [BigInt(voteIndex)];

  const nonce = randomBytes(16);
  const privateKey = x25519.utils.randomSecretKey();
  const x25519PublicKey = x25519.getPublicKey(privateKey);

  let sharedSecret: Uint8Array;
  let usedMxe = false;
  const mxeProgramId = process.env.ARCIUM_MXE_PROGRAM_ID;
  if (!mxeProgramId) {
    console.warn("[arcium-client] ARCIUM_MXE_PROGRAM_ID not set, using demo mode");
  }

  if (mxeProgramId) {
    try {
      const provider = createReadOnlyProvider();
      const mxePubkey = new PublicKey(mxeProgramId);
      const mxePublicKey = await getMXEPublicKeyWithRetry(provider, mxePubkey, 5, 800);
      if (mxePublicKey && mxePublicKey.length === 32) {
        sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
        usedMxe = true;
      } else {
        sharedSecret = x25519.getSharedSecret(
          privateKey,
          x25519.getPublicKey(x25519.utils.randomSecretKey())
        );
      }
    } catch (e) {
      console.warn("[arcium-client] MXE key fetch failed, using demo mode:", e);
      sharedSecret = x25519.getSharedSecret(
        privateKey,
        x25519.getPublicKey(x25519.utils.randomSecretKey())
      );
    }
  } else {
    sharedSecret = x25519.getSharedSecret(
      privateKey,
      x25519.getPublicKey(x25519.utils.randomSecretKey())
    );
  }

  const cipher = new RescueCipher(sharedSecret);
  const ciphertext = cipher.encrypt(plaintext, nonce);

  return {
    ciphertext,
    nonce: Buffer.from(nonce).toString("base64"),
    x25519PublicKey: Buffer.from(x25519PublicKey).toString("base64"),
    voteIndex,
    mode: usedMxe ? "mxe" : "demo",
    timestamp: Date.now(),
    encrypted: Buffer.from(ciphertext[0] ?? []).toString("base64"),
  };
}

export const arciumClient = {
  encrypt: (data: EncryptVoteParams) => encryptVote(data),
};
