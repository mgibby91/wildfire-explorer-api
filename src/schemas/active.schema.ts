export const activeHotspotsSchema = {
  querystring: {
    type: 'object',
    properties: {
      west:           { type: 'number', minimum: -180, maximum: 180 },
      south:          { type: 'number', minimum: -90,  maximum: 90 },
      east:           { type: 'number', minimum: -180, maximum: 180 },
      north:          { type: 'number', minimum: -90,  maximum: 90 },
      min_confidence: { type: 'string', enum: ['low', 'nominal', 'high'] },
    },
  },
} as const;
