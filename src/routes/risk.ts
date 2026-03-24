import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getRiskScores } from "../services/risk.service";

const riskRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await getRiskScores();

    return reply.send(data);
  });
};

export default riskRoutes;
