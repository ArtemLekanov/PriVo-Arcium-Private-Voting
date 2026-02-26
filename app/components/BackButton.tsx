"use client";

import Link from "next/link";

export default function BackButton() {
  return (
    <Link
      href="/"
      className="btn-glow inline-flex items-center justify-center gap-2 rounded-full border border-fuchsia-500 bg-transparent px-8 py-4 text-xl font-bold text-fuchsia-100 hover:bg-fuchsia-500 hover:text-white transition min-w-[200px]"
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      Back
    </Link>
  );
}
