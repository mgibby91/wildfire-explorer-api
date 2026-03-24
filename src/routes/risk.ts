import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getRiskScore } from "../services/risk.service";
import { riskSchema } from "../schemas/risk.schema";
import type { RiskQuery } from "../types/risk.types";

const riskRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Querystring: RiskQuery }>(
    "/",
    { schema: riskSchema },
    async (
      request: FastifyRequest<{ Querystring: RiskQuery }>,
      reply: FastifyReply,
    ) => {
      const { lat, lng } = request.query;
      return reply.send(await getRiskScore(lat, lng));
    },
  );
};

export default riskRoutes;
