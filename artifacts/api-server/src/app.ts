import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In ADDON_MODE, serve the built React frontend statically
if (process.env.ADDON_MODE === "true") {
  const frontendPath = path.resolve(__dirname, "../../nvr-dashboard/dist");
  if (fs.existsSync(frontendPath)) {
    logger.info({ frontendPath }, "Serving static frontend from addon build");
    app.use(express.static(frontendPath));
    app.get("/*splat", (_req, res) => {
      res.sendFile(path.join(frontendPath, "index.html"));
    });
  } else {
    logger.warn({ frontendPath }, "Frontend dist folder not found");
  }
}

export default app;
