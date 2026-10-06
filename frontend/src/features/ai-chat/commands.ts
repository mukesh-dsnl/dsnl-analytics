/**
 * Chat slash commands — the one list the "/" menu, the composer chips and the
 * question bubbles all read from.
 *
 * Commands travel inside the question text ("/voicedrop /excel top accounts"),
 * and the server is what interprets them (backend/app/ai/commands.py). This
 * mirror exists only to present them; its parsing rule matches the server's.
 */

import { BarChart3, FileSpreadsheet, FileText, PhoneCall, PhoneForwarded, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CommandKind = 'scope' | 'export' | 'display';

export interface ChatCommand {
  name: 'voicedrop' | 'conference' | 'multicall' | 'csv' | 'excel' | 'chart';
  label: string;
  description: string;
  kind: CommandKind;
  icon: LucideIcon;
}

export const COMMANDS: ChatCommand[] = [
  { name: 'voicedrop', label: 'Voicedrop', description: 'Only Voicedrop calls', kind: 'scope', icon: PhoneCall },
  { name: 'conference', label: 'Conference', description: 'Only Conference calls', kind: 'scope', icon: Users },
  { name: 'multicall', label: 'MultiCall', description: 'Only MultiCall calls', kind: 'scope', icon: PhoneForwarded },
  { name: 'excel', label: 'Excel', description: 'Attach the full data as an .xlsx workbook', kind: 'export', icon: FileSpreadsheet },
  { name: 'csv', label: 'CSV', description: 'Attach the full data as a .csv file', kind: 'export', icon: FileText },
  { name: 'chart', label: 'Chart', description: 'Draw a chart of the result', kind: 'display', icon: BarChart3 },
];

export const COMMAND_BY_NAME = Object.fromEntries(COMMANDS.map((c) => [c.name, c])) as Record<
  ChatCommand['name'],
  ChatCommand
>;

const TOKEN = new RegExp(`(?<![\\w/])/(${COMMANDS.map((c) => c.name).join('|')})\\b`, 'gi');

/** The known commands in a question, in order without repeats, and the rest of the text. */
export function parseCommands(question: string): { commands: ChatCommand[]; text: string } {
  const names: ChatCommand['name'][] = [];
  for (const match of question.matchAll(TOKEN)) {
    const name = match[1].toLowerCase() as ChatCommand['name'];
    if (!names.includes(name)) names.push(name);
  }
  const text = question.replace(TOKEN, '').replace(/[ \t]{2,}/g, ' ').trim();
  return { commands: names.map((n) => COMMAND_BY_NAME[n]), text };
}

/** The "/" being typed at the caret, if any — what the menu filters on. */
export function partialCommand(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)\/(\w*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2].toLowerCase() };
}
