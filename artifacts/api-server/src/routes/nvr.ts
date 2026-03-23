import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, nvrConfigTable, camerasTable, recordingsTable } from "@workspace/db";
import {
  GetNvrConfigResponse,
  UpdateNvrConfigBody,
  UpdateNvrConfigResponse,
  GetCamerasResponse,
  CreateCameraBody,
  UpdateCameraParams,
  UpdateCameraBody,
  UpdateCameraResponse,
  DeleteCameraParams,
  GetCameraSnapshotParams,
  GetCameraSnapshotResponse,
  GetNvrStatusResponse,
  GetRecordingsQueryParams,
  GetRecordingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateNvrConfig() {
  const [config] = await db.select().from(nvrConfigTable).limit(1);
  if (config) return config;
  const [created] = await db.insert(nvrConfigTable).values({
    name: "My NVR",
    host: "",
    port: 80,
    username: "admin",
    password: "",
    rtspPort: 554,
    httpPort: 80,
    channelCount: 4,
    configured: false,
  }).returning();
  return created;
}

function buildStreamUrl(host: string, rtspPort: number, username: string, password: string, channel: number): string {
  if (!host) return "";
  return `/api/stream/camera/${channel}`;
}

function buildSnapshotProxyUrl(cameraId: number): string {
  return `/api/nvr/cameras/${cameraId}/snapshot/image`;
}

router.get("/nvr/config", async (req, res): Promise<void> => {
  const config = await getOrCreateNvrConfig();
  const responseData = {
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    rtspPort: config.rtspPort,
    httpPort: config.httpPort,
    channelCount: config.channelCount,
    name: config.name,
    configured: config.configured,
  };
  res.json(GetNvrConfigResponse.parse(responseData));
});

router.put("/nvr/config", async (req, res): Promise<void> => {
  const parsed = UpdateNvrConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getOrCreateNvrConfig();
  const updateData = {
    name: parsed.data.name ?? existing.name,
    host: parsed.data.host,
    port: parsed.data.port ?? existing.port,
    username: parsed.data.username,
    password: parsed.data.password ?? existing.password,
    rtspPort: parsed.data.rtspPort ?? existing.rtspPort,
    httpPort: parsed.data.httpPort ?? existing.httpPort,
    channelCount: parsed.data.channelCount ?? existing.channelCount,
    configured: true,
  };

  const [updated] = await db
    .update(nvrConfigTable)
    .set(updateData)
    .where(eq(nvrConfigTable.id, existing.id))
    .returning();

  const responseData = {
    id: updated.id,
    host: updated.host,
    port: updated.port,
    username: updated.username,
    rtspPort: updated.rtspPort,
    httpPort: updated.httpPort,
    channelCount: updated.channelCount,
    name: updated.name,
    configured: updated.configured,
  };
  res.json(UpdateNvrConfigResponse.parse(responseData));
});

router.get("/nvr/cameras", async (req, res): Promise<void> => {
  const config = await getOrCreateNvrConfig();
  const cameras = await db.select().from(camerasTable).where(eq(camerasTable.nvrId, config.id));

  const camerasWithUrls = cameras.map(cam => ({
    id: cam.id,
    channel: cam.channel,
    name: cam.name,
    status: cam.status as "online" | "offline" | "unknown",
    recordingEnabled: cam.recordingEnabled,
    motionDetection: cam.motionDetection,
    resolution: cam.resolution ?? undefined,
    nvrId: cam.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, config.username, config.password, cam.channel),
    snapshotUrl: buildSnapshotProxyUrl(cam.id),
  }));

  res.json(GetCamerasResponse.parse(camerasWithUrls));
});

router.post("/nvr/cameras", async (req, res): Promise<void> => {
  const parsed = CreateCameraBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config = await getOrCreateNvrConfig();
  const [camera] = await db.insert(camerasTable).values({
    nvrId: config.id,
    channel: parsed.data.channel,
    name: parsed.data.name,
    recordingEnabled: parsed.data.recordingEnabled ?? true,
    motionDetection: parsed.data.motionDetection ?? true,
  }).returning();

  const responseData = {
    id: camera.id,
    channel: camera.channel,
    name: camera.name,
    status: camera.status as "online" | "offline" | "unknown",
    recordingEnabled: camera.recordingEnabled,
    motionDetection: camera.motionDetection,
    resolution: camera.resolution ?? undefined,
    nvrId: camera.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, config.username, config.password, camera.channel),
    snapshotUrl: buildSnapshotProxyUrl(camera.id),
  };

  res.status(201).json(responseData);
});

router.put("/nvr/cameras/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCameraBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config = await getOrCreateNvrConfig();
  const [camera] = await db
    .update(camerasTable)
    .set({
      channel: parsed.data.channel,
      name: parsed.data.name,
      recordingEnabled: parsed.data.recordingEnabled,
      motionDetection: parsed.data.motionDetection,
    })
    .where(eq(camerasTable.id, params.data.id))
    .returning();

  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const responseData = {
    id: camera.id,
    channel: camera.channel,
    name: camera.name,
    status: camera.status as "online" | "offline" | "unknown",
    recordingEnabled: camera.recordingEnabled,
    motionDetection: camera.motionDetection,
    resolution: camera.resolution ?? undefined,
    nvrId: camera.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, config.username, config.password, camera.channel),
    snapshotUrl: buildSnapshotProxyUrl(camera.id),
  };

  res.json(UpdateCameraResponse.parse(responseData));
});

router.delete("/nvr/cameras/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(camerasTable)
    .where(eq(camerasTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/nvr/cameras/:id/snapshot", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCameraSnapshotParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [camera] = await db.select().from(camerasTable).where(eq(camerasTable.id, params.data.id));
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const responseData = {
    cameraId: camera.id,
    url: buildSnapshotProxyUrl(camera.id),
    timestamp: new Date().toISOString(),
  };

  res.json(GetCameraSnapshotResponse.parse(responseData));
});

router.get("/nvr/status", async (_req, res): Promise<void> => {
  const config = await getOrCreateNvrConfig();
  const cameras = await db.select().from(camerasTable).where(eq(camerasTable.nvrId, config.id));

  const online = cameras.filter(c => c.status === "online").length;

  const statusData = {
    connected: config.configured && config.host !== "",
    diskUsage: 1.2 * 1024,
    diskTotal: 4 * 1024,
    uptime: "0d 0h",
    temperature: 45,
    camerasOnline: online,
    camerasTotal: cameras.length,
    recordingActive: cameras.some(c => c.recordingEnabled),
  };

  res.json(GetNvrStatusResponse.parse(statusData));
});

router.get("/recordings", async (req, res): Promise<void> => {
  const queryParsed = GetRecordingsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  const { cameraId, date, startTime, endTime } = queryParsed.data;

  let recordings = await db.select().from(recordingsTable);

  if (cameraId) {
    recordings = recordings.filter(r => r.cameraId === cameraId);
  }

  if (date) {
    const dateStart = new Date(`${date}T00:00:00Z`);
    const dateEnd = new Date(`${date}T23:59:59Z`);
    recordings = recordings.filter(r => r.startTime >= dateStart && r.startTime <= dateEnd);
  }

  const responseData = recordings.map(r => ({
    id: r.id,
    cameraId: r.cameraId,
    cameraName: r.cameraName,
    startTime: r.startTime.toISOString(),
    endTime: r.endTime.toISOString(),
    duration: r.duration,
    fileSize: r.fileSize,
    type: r.type as "continuous" | "motion" | "manual",
    playbackUrl: r.playbackUrl ?? undefined,
  }));

  res.json(GetRecordingsResponse.parse(responseData));
});

export default router;
