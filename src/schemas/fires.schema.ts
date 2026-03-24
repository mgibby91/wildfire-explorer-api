export const firesNearPointSchema = {
  querystring: {
    type: 'object',
    required: ['lat', 'lng'],
    properties: {
      lat:      { type: 'number', minimum: -90,  maximum: 90 },
      lng:      { type: 'number', minimum: -180, maximum: 180 },
      radius:   { type: 'number', minimum: 1,    maximum: 500,  default: 100 },
      year_min: { type: 'integer' },
      year_max: { type: 'integer' },
      limit:    { type: 'integer', minimum: 1,   maximum: 200,  default: 50 },
    },
  },
} as const;

export const firesBboxSchema = {
  querystring: {
    type: 'object',
    required: ['west', 'south', 'east', 'north'],
    properties: {
      west:     { type: 'number', minimum: -180, maximum: 180 },
      south:    { type: 'number', minimum: -90,  maximum: 90 },
      east:     { type: 'number', minimum: -180, maximum: 180 },
      north:    { type: 'number', minimum: -90,  maximum: 90 },
      year_min: { type: 'integer' },
      year_max: { type: 'integer' },
      limit:    { type: 'integer', minimum: 1,   maximum: 500, default: 100 },
    },
  },
} as const;

export const fireByIdSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[0-9]+$' },
    },
  },
} as const;
