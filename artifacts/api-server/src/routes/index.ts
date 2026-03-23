import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nvrRouter from "./nvr";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nvrRouter);

export default router;
