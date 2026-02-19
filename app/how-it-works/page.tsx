"use client";

import PageLayout from "../components/PageLayout";
import BackButton from "../components/BackButton";

export default function HowItWorksPage() {
  return (
    <PageLayout>
      <main className="max-w-4xl mx-auto py-20 px-6">
        <div className="mb-6">
          <BackButton />
        </div>
        <h1 className="text-4xl font-bold mb-8 text-center">How It Works</h1>

        <p className="text-center text-zinc-400 text-lg mb-10 max-w-2xl mx-auto">
          PriVo is a private voting app on Solana. Anyone can create a poll or vote in existing ones.
          Votes are submitted and counted inside Arcium&apos;s encrypted environment. No one can see how you voted until the final tally is published.
        </p>

        <div className="space-y-8">
          <section className="section-glow p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
            <h2 className="text-2xl font-bold mb-4 text-fuchsia-400">What Arcium Does Here</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              Arcium provides the privacy layer: your vote is encrypted before it reaches the blockchain.
              All counting happens <strong className="text-zinc-100">inside encrypted shared state</strong>, not in the open.
              Only when the poll creator runs &quot;Reveal results&quot; do the <strong className="text-zinc-100">final totals</strong> (e.g. Yes / No / Maybe counts) get published on Solana, with proofs that the count is correct.
            </p>
            <p className="text-zinc-300 leading-relaxed">
              So: nobody can observe individual votes or intermediate results. You get privacy and integrity in one flow.
            </p>
          </section>

          <section className="section-glow p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
            <h2 className="text-2xl font-bold mb-4 text-fuchsia-400">In Simple Steps</h2>
            <ol className="list-decimal list-inside space-y-3 text-zinc-300">
              <li><strong className="text-zinc-100">Connect your wallet</strong> (e.g. Phantom) to PriVo.</li>
              <li><strong className="text-zinc-100">Create a poll</strong>: set a short question and optional description. Your poll is stored on Solana.</li>
              <li><strong className="text-zinc-100">Vote</strong>: pick an option (Yes / No / Maybe). Your choice is encrypted with Arcium and sent on-chain. No one can see it.</li>
              <li>Votes are <strong className="text-zinc-100">counted inside Arcium</strong>, in encrypted form. Only aggregated totals are ever revealed.</li>
              <li>When voting is over, the <strong className="text-zinc-100">poll creator</strong> runs &quot;Reveal results&quot;. The final counts are then published on Solana and shown in the Results page.</li>
            </ol>
          </section>

          <section className="section-glow p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
            <h2 className="text-2xl font-bold mb-4 text-fuchsia-400">Why This Is Better</h2>
            <p className="text-zinc-300 leading-relaxed mb-4">
              In many open voting systems, people can see how others voted before the end. That can lead to pressure, vote buying, or last-minute bandwagon effects. Management and fairness suffer when results are visible too early.
            </p>
            <p className="text-zinc-300 leading-relaxed">
              With PriVo and Arcium, <strong className="text-zinc-100">nothing is observable until the final count</strong>. You can vote according to your real opinion; only the totals are ever made public, with cryptographic guarantees.
            </p>
          </section>

          <section className="section-glow p-6 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
            <h2 className="text-2xl font-bold mb-4 text-fuchsia-400">Under the Hood</h2>
            <p className="text-zinc-300 leading-relaxed">
              PriVo uses Arcium&apos;s MXE (Multi-Execution Environment): votes are encrypted and processed in a trusted execution environment. The Solana program stores only encrypted data; the reveal step triggers a callback that writes the final aggregates (with correctness proofs) to the poll account. One vote per wallet per poll is enforced on-chain. The app runs on Solana Devnet for testing.
            </p>
          </section>
        </div>
      </main>
    </PageLayout>
  );
}
