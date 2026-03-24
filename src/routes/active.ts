import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getActiveFires } from "../services/firms.service";

const activeRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await getActiveFires();

    return reply.send(data);
  });
};

export default activeRoutes;
