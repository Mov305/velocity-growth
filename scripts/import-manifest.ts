import type { ImportKind } from './import/types';

export type ManifestEntry = { brand: string; kind: ImportKind; file: string };

/**
 * The seed files in the order they must be applied. Order matters twice: the Kilele delta is applied
 * after the base so its corrections win, and events are applied after contacts and campaigns so
 * they can resolve ids.
 */
export const SEED_MANIFEST: ManifestEntry[] = [
  { brand: 'KILELE', kind: 'contacts', file: 'kilele-contacts.csv' },
  { brand: 'KILELE', kind: 'contacts', file: 'kilele-contacts-delta-2026-09-01.csv' },
  { brand: 'KILELE', kind: 'campaigns', file: 'kilele-campaigns.csv' },
  { brand: 'KILELE', kind: 'events', file: 'kilele-events.csv' },
  { brand: 'KILELE', kind: 'send_log', file: 'kilele-send-log.csv' },
  { brand: 'KAROO', kind: 'contacts', file: 'karoo-contacts.csv' },
  { brand: 'KAROO', kind: 'campaigns', file: 'karoo-campaigns.csv' },
  { brand: 'KAROO', kind: 'events', file: 'karoo-events.csv' },
  { brand: 'MARRAKECH', kind: 'contacts', file: 'marrakech-contacts.csv' },
  { brand: 'MARRAKECH', kind: 'campaigns', file: 'marrakech-campaigns.csv' },
  { brand: 'MARRAKECH', kind: 'events', file: 'marrakech-events.csv' },
];
