"use client";

import PageLayout from "./components/PageLayout";

export default function Home() {
  return (
    <PageLayout>
      <main className="w-full max-w-2xl mx-auto flex flex-col items-center text-center gap-15 z-20 relative">
        <div className="space-y-1">
          <h1 className="text-5x1 sm:text-9xl font-semibold tracking-tight">
            PriVo
          </h1>
          <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 px-2.5 py-0.5 text-base font-medium text-fuchsia-300 border border-fuchsia-500/30">
            Devnet · Private Voting
          </span>
        </div>

        <div className="space-y-4">
          <p className="font-volkhov text-xl sm:text-5xl font-medium text-zinc-100">
            Every vote counts
          </p>
          <p className="font-volkhov text-lg sm:text-5xl text-zinc-100">
            Every vote{" "}
            <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 px-3 py-2 text-fuchsia-300 text-5xl border border-fuchsia-500/30">
              &lt;encrypted&gt;
            </span>
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-40">
          <a
            href="/how-it-works"
            className="btn-glow inline-flex items-center justify-center whitespace-nowrap rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-3xl sm:text-2xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition w-64 h-17.5"
          >
            How does it work?
          </a>

          <a
            href="/vote"
            className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-2xl sm:text-3xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition w-64"
          >
            Voting
          </a>

          <a
            href="/create-poll"
            className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-2xl sm:text-3xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition w-64"
          >
            Create Poll
          </a>

          <a
            href="/results"
            className="btn-glow inline-flex items-center justify-center rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-2xl sm:text-3xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition w-64"
          >
            Results
          </a>
        </div>

        <section
          id="how-it-works"
          className="mt-8 max-w-xl text-sm text-zinc-400 space-y-2"
        >
          <p>
            The PriVO application operates on Devnet Solana. It was developed for testing private voting and is not affiliated with the main Arcium development team.
          </p>
        </section>
      </main>
    </PageLayout>
  );
}