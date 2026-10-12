"use client";

import { useRef, useState } from "react";
import { Select } from "@/components/motion/select";

const SORTS = [
  { value: "deadline", label: "Soonest deadline" },
  { value: "least_funded", label: "Needs most help" },
  { value: "most_funded", label: "Closest to funded" },
  { value: "newest", label: "Newest" },
];

/** Search and sort as a GET form (search works even before JavaScript loads); a new sort applies at once. */
export function NeedsToolbar({ q, sort }: { q: string; sort: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [sortValue, setSortValue] = useState(sort);
  return (
    <form ref={formRef} method="get" action="/needs" role="search" className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor="q" className="sr-only">Search needs</label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search by need or charity"
        className="w-full rounded-full border border-line bg-card px-4 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-(--duration-quick) focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)] sm:max-w-sm"
      />
      <Select
        name="sort"
        label="Sort"
        value={sortValue}
        options={SORTS}
        onChange={(v) => {
          setSortValue(v);
          // Let the hidden input update before submitting.
          requestAnimationFrame(() => formRef.current?.requestSubmit());
        }}
      />
      <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm text-paper transition-transform active:scale-[0.97]">
        Search
      </button>
    </form>
  );
}
