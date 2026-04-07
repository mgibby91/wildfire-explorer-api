import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { db } from '../db/client';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.end();
});

// Northern California — dense fire history, guaranteed results
const CA_BBOX = 'west=-124&south=36&east=-118&north=42';
const CA_POINT = 'lat=39.5&lng=-121.5';

describe('GET /api/fires/bbox', () => {
  it('returns a FeatureCollection with correctly shaped features', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/fires/bbox?${CA_BBOX}`,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.type).toBe('FeatureCollection');
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.features.length).toBeGreaterThan(0);

    const feature = body.features[0];
    expect(feature.type).toBe('Feature');
    expect(feature.geometry).toBeDefined();
    expect(feature.properties).toMatchObject({
      id: expect.any(Number),
    });
  });

  it('returns 400 when required params are missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fires/bbox?west=-124&south=36',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/fires/:id', () => {
  it('returns a Feature with full geometry for a valid ID', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/fires/bbox?${CA_BBOX}&limit=1`,
    });
    const { features } = listRes.json();
    const id: number = features[0].properties.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/fires/${id}`,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.type).toBe('Feature');
    expect(body.properties.id).toBe(id);
    expect(body.geometry).toBeDefined();
  });

  it('returns 404 with correct error shape for a non-existent ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fires/99999999',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: 'Fire not found',
      statusCode: 404,
    });
  });
});

describe('GET /api/risk', () => {
  it('returns a risk score with all expected fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/risk?${CA_POINT}`,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toMatchObject({
      score: expect.any(Number),
      fire_count_50km: expect.any(Number),
      active_hotspots_nearby: expect.any(Number),
    });
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);
  });

  it('returns 400 when required params are missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/risk?lat=39.5',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/active', () => {
  it('returns a FeatureCollection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/active',
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.type).toBe('FeatureCollection');
    expect(Array.isArray(body.features)).toBe(true);
  });
});
