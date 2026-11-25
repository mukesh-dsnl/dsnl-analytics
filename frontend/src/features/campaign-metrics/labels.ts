import type { CampaignService } from './api';

/**
 * Below this many numbers a connected percentage says little — 4 of 4 is 100%
 * and reads as the best account of the day. Such rows keep their figures but
 * lose the colour, and sort after the rest when the table is ordered by %.
 */
export const SMALL_GROUP = 50;

export interface MeasureLabels {
  /** What one row counts: "numbers" on Voicedrop, "parties" on the two conference services. */
  unit: string;
  total: string;
  connected: string;
  notConnected: string;
  percent: string;
  /** The hover note on the % header: what it is a percentage of, and why Attempt Metrics differs. */
  percentNote: string;
  /** What the Campaigns tab lists: "campaigns", or "conferences" on Conference. */
  campaignWord: string;
}

/**
 * The measure columns in the service's own words.
 *
 * Every figure here counts a conferee once (distinct CRN + CONFEREE_SEQ_NO),
 * however many times it was dialled. Attempt Metrics counts call legs, where
 * each retry is another row, so the two pages' connected percentages differ
 * for the same account: 45.5% of numbers against 24.6% of attempts for
 * account 109446 on 2026-11-16. Naming the unit in the header is what stops
 * the two being read as one figure that disagrees with itself.
 */
export function measureLabels(service: CampaignService): MeasureLabels {
  const voicedrop = service === 'voicedrop';
  const unit = voicedrop ? 'numbers' : 'parties';
  return {
    unit,
    total: voicedrop ? 'Numbers dialled' : 'Parties',
    connected: 'Connected',
    notConnected: 'Not connected',
    percent: `Connected % of ${unit}`,
    percentNote:
      `Connected ${unit} out of all ${unit}. Each one counts once, however many times it was tried. ` +
      'Attempt Metrics shows connected % of attempts, where every retry counts again, so its figure is lower.',
    campaignWord: service === 'conference' ? 'conferences' : 'campaigns',
  };
}

/** ACCOUNTID 0 (or none) is not an account — CDR carries it on calls that belong to none. */
export const isNoAccount = (account: string) => account === '0' || account === '' || account === 'None';
