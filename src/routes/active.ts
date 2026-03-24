import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getActiveHotspots } from "../services/active.service";
import { activeHotspotsSchema } from "../schemas/active.schema";
import type { ActiveQuery } from "../types/active.types";

const activeRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: ActiveQuery }>(
    "/",
    { schema: activeHotspotsSchema },
    async (
      request: FastifyRequest<{ Querystring: ActiveQuery }>,
      reply: FastifyReply,
    ) => {
      const { west, south, east, north, min_confidence } = request.query;
      return reply.send(
        await getActiveHotspots(west, south, east, north, min_confidence),
      );
    },
  );
};

export default activeRoutes;
