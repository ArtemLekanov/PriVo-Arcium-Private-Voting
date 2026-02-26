# PriVo - Private Voting on Solana Devnet

Governance suffers when votes are observable before the final tally. **PriVo** uses [Arcium](https://arcium.com) so that votes are cast and tallied inside encrypted shared state; only the final result (Yes or No) is published on Solana, not individual votes or exact counts.

- **Live:** [privo.tech](https://privo.tech)
- **Open-source:** [GitHub](https://github.com/ArtemLekanov/PriVo-Arcium-Private-Voting)

---

## Why private voting?

In transparent DAO voting, votes are visible or can be inferred before the tally. That leads to strategic voting, social pressure, and weaker decisions. PriVo keeps votes encrypted until the tally runs inside Arcium’s MXE; only the winning option is revealed.

---

## What the app does

- **Create poll** - Deploy a new Yes/No poll on Solana (creator pays; poll ID and creator are public).
- **Vote** - Connect wallet, pick Yes or No; your vote is encrypted with Arcium and submitted on-chain. **Single-vote enforcement** (no double voting): one vote per wallet per poll.
- **Reveal results** - Poll creator triggers reveal; the MXE computes the result and writes it on-chain via a callback. After the callback (typically 15-60 seconds on Devnet), the outcome is shown.
- **Results** - View the winning option for any revealed poll; exact vote counts are never revealed.

---

## How Arcium is used & privacy benefits

[Arcium](https://www.arcium.com/what-is-arcium) provides **confidential computing**: data is protected not only at rest and in transit but also **in use** (while being computed). PriVo uses Arcium’s **MXE** (Multiparty Computation eXecution Environment) - the execution layer where encrypted votes are tallied without ever being decrypted in the open. See [Encryption](https://docs.arcium.com/developers/encryption) and [Arx nodes](https://docs.arcium.com/arx-nodes/overview) in Arcium Docs.

- **Encryption:** Each vote is encrypted with the Arcium SDK before it touches the chain: ephemeral x25519 key agreement with the **MXE public key** (stored on Solana), then symmetric encryption with **Rescue** (RescueCipher). Only the MXE cluster can decrypt; no single party sees plaintext votes.
- **Execution:** When you vote or when the creator reveals, the Solana program enqueues a computation with Arcium. The computation runs on **Arcium’s network** - a cluster of Arx nodes executing the MXE. Votes are counted inside this encrypted execution environment; individual ballots and exact counts never leave it.
- **Result only on-chain:** When reveal runs, the MXE computes the winner (Yes or No). A **callback** transaction from the Arcium cluster writes only that outcome to the poll account on Solana. So the chain stores encrypted inputs and the final result, never the per-vote data.
- **Privacy benefits:** No one can see how you voted or infer votes before the reveal. Only the winning side is published, which reduces strategic voting and improves decision quality.

---

## Tech stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS
- **Chain:** Solana Devnet, `@solana/web3.js`, wallet-adapter
- **Privacy:** Arcium SDK (encryption + MXE for tally)
- **Data:** Prisma + SQLite (polls, votes, reveal state)

---

## Quick start

1. **Clone and install**
   ```bash
   git clone https://github.com/ArtemLekanov/PriVo-Arcium-Private-Voting.git
   cd PriVo-Arcium-Private-Voting
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env` or `.env.local`.
   - Set at least:
     - `ARCIUM_MXE_PROGRAM_ID` - MXE program ID on Devnet (for encryption).
     - `NEXT_PUBLIC_VOTING_PROGRAM_ID` - Your voting program ID (required for Create Poll; without it you may get error 102).
     - `DATABASE_URL` - e.g. `"file:./dev.db"` for SQLite.

   See [.env.example](./.env.example).

3. **Database**
   ```bash
   npx prisma db push
   ```

4. **Run**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

---

## Arcium integration

- **Demo** (default): Same cipher, no MXE binding - for local testing. In demo mode, encrypted votes are stored locally (e.g. localStorage).
- **MXE:** Set `ARCIUM_MXE_PROGRAM_ID` in `.env` to use the real MXE public key on Devnet; votes are then sent to Arcium/Solana and tallied by MXE.
