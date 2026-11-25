/**
 * CDR.SERVICE_PROVIDER is a bare number. These are the providers it stands
 * for; a code not listed here is shown as "Provider <code>".
 */
const PROVIDER_NAMES: Record<string, string> = {
  '1': 'Vodafone_UL',
  '2': 'Vodafone_M',
  '5': 'RCOM',
  '14': 'Airtel_M',
  '15': 'JIO',
  '19': 'GATEWAY_L1',
  '20': 'GATEWAY_L2',
  '22': 'Airtel_UL',
};

/** "15" → "JIO"; an unlisted code → "Provider 7". */
export function providerName(code: string | number | null | undefined): string {
  const key = String(code ?? '').trim().replace(/\.0$/, '');
  return PROVIDER_NAMES[key] ?? `Provider ${key || '—'}`;
}
