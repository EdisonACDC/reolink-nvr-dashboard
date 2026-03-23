import { Router, type IRouter } from "express";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);

if (process.env.ADDON_MODE === "true") {
  const { default: nvrAddonRouter } = await import("./nvr-addon");
  router.use(nvrAddonRouter);
} else {
  const { default: nvrRouter } = await import("./nvr");
  router.use(nvrRouter);
}

export default router;
