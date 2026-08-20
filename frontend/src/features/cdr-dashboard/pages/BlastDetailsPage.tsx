import { Inbox } from 'lucide-react';

/**
 * Voicedrop → Blast Details.
 *
 * Empty on purpose — the drill-down/hover experimentation that used to live
 * here moved to the main Analytics charts (All/Voicedrop/Conference/
 * Multicall) once it was validated. This page is back to a placeholder until
 * it has its own content.
 */
export function BlastDetailsPage() {
  return (
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
      <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg flex flex-col items-center justify-center gap-2 text-center py-24 transition-colors duration-300">
        <div className="w-11 h-11 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
          <Inbox className="w-5 h-5" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing here yet.</p>
      </div>
    </div>
  );
}
