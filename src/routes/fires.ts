import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getHistoricalFires } from "../services/fires.service";

const firesRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await getHistoricalFires();

    return reply.send(data);
  });
};

export default firesRoutes;
