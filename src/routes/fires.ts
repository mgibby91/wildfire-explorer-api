import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getFiresNearPoint,
  getFiresInBbox,
  getFireById,
} from "../services/fires.service";
import {
  firesNearPointSchema,
  firesBboxSchema,
  fireByIdSchema,
} from "../schemas/fires.schema";
import type {
  NearPointQuery,
  BboxQuery,
  FireParams,
} from "../types/fires.types";

const firesRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: NearPointQuery }>(
    "/",
    { schema: firesNearPointSchema },
    async (
      request: FastifyRequest<{ Querystring: NearPointQuery }>,
      reply: FastifyReply,
    ) => {
      const {
        lat,
        lng,
        radius = 100,
        year_min,
        year_max,
        limit = 50,
      } = request.query;
      return reply.send(
        await getFiresNearPoint(lat, lng, radius, year_min, year_max, limit),
      );
    },
  );

  // Registered before /:id so "bbox" isn't captured as a param
  app.get<{ Querystring: BboxQuery }>(
    "/bbox",
    { schema: firesBboxSchema },
    async (
      request: FastifyRequest<{ Querystring: BboxQuery }>,
      reply: FastifyReply,
    ) => {
      const {
        west,
        south,
        east,
        north,
        year_min,
        year_max,
        limit = 100,
      } = request.query;
      return reply.send(
        await getFiresInBbox(
          west,
          south,
          east,
          north,
          year_min,
          year_max,
          limit,
        ),
      );
    },
  );

  app.get<{ Params: FireParams }>(
    "/:id",
    { schema: fireByIdSchema },
    async (
      request: FastifyRequest<{ Params: FireParams }>,
      reply: FastifyReply,
    ) => {
      const id = parseInt(request.params.id, 10);
      const data = await getFireById(id);
      if (!data)
        return reply
          .status(404)
          .send({ error: "Fire not found", statusCode: 404 });
      return reply.send(data);
    },
  );
};

export default firesRoutes;
