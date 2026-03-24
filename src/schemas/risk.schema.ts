export const riskSchema = {
  querystring: {
    type: 'object',
    required: ['lat', 'lng'],
    properties: {
      lat: { type: 'number', minimum: -90,  maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
    },
  },
} as const;
