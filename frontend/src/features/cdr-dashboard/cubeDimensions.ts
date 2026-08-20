import type { CallCubeRow } from './api';

/** The four axes the Blast Details cube can be sliced by. */
export type CubeDimension = 'location' | 'connection' | 'direction' | 'provider';

export function cubeDimensionValue(row: CallCubeRow, dimension: CubeDimension): string {
  switch (dimension) {
    case 'location':
      return row.location;
    case 'connection':
      return row.is_connected ? 'Connected' : 'Not Connected';
    case 'direction':
      return row.call_direction;
    case 'provider':
      return row.service_provider;
  }
}
