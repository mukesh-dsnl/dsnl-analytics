/** Where an account's history is (its Accounts page), for the services that have one. */
export function summaryPath(service: string, accountId: string | number, clientId?: string | number): string | null {
  if (service !== 'voicedrop' && service !== 'conference') return null;
  return `/analytics/${service}/accounts?account=${accountId}${clientId != null ? `&client=${clientId}` : ''}`;
}
