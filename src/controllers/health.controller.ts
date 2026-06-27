import type { RequestHandler } from "express";

const getStatus: RequestHandler = (_req, res) => {
  res.send({
    success: true,
    data: {
      message: "API is healthy",
      uptime: process.uptime(),
    },
  });
};

export default { getStatus };
