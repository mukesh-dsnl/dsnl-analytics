import type { SVGProps } from 'react';

/**
 * The Analytics AI mark: a chat bubble with a rising trend line inside it,
 * leaving through the bubble's open top-right corner towards a spark — the
 * answer coming out of the conversation as an insight.
 *
 * Drawn on lucide's 24px grid with the same 2px round stroke, so it sits
 * beside lucide icons at any size; it takes its colour from `currentColor`.
 */
export function AnalyticsAiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3H7a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4h1v3.5l4.5-3.5H17a4 4 0 0 0 4-4v-3" />
      <path d="M7 14l3-3 2.5 2 4.5-5" />
      <path
        fill="currentColor"
        stroke="none"
        d="M19.5 1c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3z"
      />
    </svg>
  );
}
