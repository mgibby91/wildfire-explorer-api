export interface NearPointQuery {
  lat: number;
  lng: number;
  radius?: number;
  year_min?: number;
  year_max?: number;
  limit?: number;
}

export interface BboxQuery {
  west: number;
  south: number;
  east: number;
  north: number;
  year_min?: number;
  year_max?: number;
  limit?: number;
}

export interface FireParams {
  id: string;
}
