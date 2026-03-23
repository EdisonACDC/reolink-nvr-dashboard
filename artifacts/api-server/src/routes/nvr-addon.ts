import { Router, type IRouter } from "express";
import { jsonStore } from "../store/json-store";
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

function getOrCreateNvrConfig() {
  const existing = jsonStore.getNvrConfig();
  if (existing) return existing;
  return jsonStore.createNvrConfig({
    name: "My NVR",
    host: "",
    port: 80,
    username: "admin",
    password: "",
    rtspPort: 554,
    httpPort: 80,
    channelCount: 4,
    configured: false,
    status: "unknown" as any,
  } as any);
}

function buildSnapshotProxyUrl(cameraId: number): string {
  return `./api/nvr/cameras/${cameraId}/snapshot/image`;
}

function buildStreamUrl(host: string, rtspPort: number, channel: number): string {
  if (!host) return "";
  return `./api/stream/camera/${channel}`;
}

router.get("/nvr/config", (req, res): void => {
  const config = getOrCreateNvrConfig();
  res.json(GetNvrConfigResponse.parse({
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    rtspPort: config.rtspPort,
    httpPort: config.httpPort,
    channelCount: config.channelCount,
    name: config.name,
    configured: config.configured,
  }));
});

router.put("/nvr/config", (req, res): void => {
  const parsed = UpdateNvrConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = getOrCreateNvrConfig();
  const updated = jsonStore.updateNvrConfig(existing.id, {
    name: parsed.data.name ?? existing.name,
    host: parsed.data.host,
    port: parsed.data.port ?? existing.port,
    username: parsed.data.username,
    password: parsed.data.password ?? existing.password,
    rtspPort: parsed.data.rtspPort ?? existing.rtspPort,
    httpPort: parsed.data.httpPort ?? existing.httpPort,
    channelCount: parsed.data.channelCount ?? existing.channelCount,
    configured: true,
  })!;
  res.json(UpdateNvrConfigResponse.parse({
    id: updated.id,
    host: updated.host,
    port: updated.port,
    username: updated.username,
    rtspPort: updated.rtspPort,
    httpPort: updated.httpPort,
    channelCount: updated.channelCount,
    name: updated.name,
    configured: updated.configured,
  }));
});

router.get("/nvr/cameras", (req, res): void => {
  const config = getOrCreateNvrConfig();
  const cameras = jsonStore.getCameras(config.id);
  res.json(GetCamerasResponse.parse(cameras.map((cam) => ({
    id: cam.id,
    channel: cam.channel,
    name: cam.name,
    status: (cam.status || "unknown") as "online" | "offline" | "unknown",
    recordingEnabled: cam.recordingEnabled,
    motionDetection: cam.motionDetection,
    resolution: cam.resolution ?? undefined,
    nvrId: cam.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, cam.channel),
    snapshotUrl: buildSnapshotProxyUrl(cam.id),
  }))));
});

router.post("/nvr/cameras", (req, res): void => {
  const parsed = CreateCameraBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const config = getOrCreateNvrConfig();
  const camera = jsonStore.createCamera({
    nvrId: config.id,
    channel: parsed.data.channel,
    name: parsed.data.name,
    status: "unknown",
    recordingEnabled: parsed.data.recordingEnabled ?? true,
    motionDetection: parsed.data.motionDetection ?? true,
    resolution: null,
  });
  res.status(201).json({
    id: camera.id,
    channel: camera.channel,
    name: camera.name,
    status: "unknown" as const,
    recordingEnabled: camera.recordingEnabled,
    motionDetection: camera.motionDetection,
    resolution: camera.resolution ?? undefined,
    nvrId: camera.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, camera.channel),
    snapshotUrl: buildSnapshotProxyUrl(camera.id),
  });
});

router.put("/nvr/cameras/:id", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCameraBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const config = getOrCreateNvrConfig();
  const camera = jsonStore.updateCamera(params.data.id, {
    channel: parsed.data.channel,
    name: parsed.data.name,
    recordingEnabled: parsed.data.recordingEnabled,
    motionDetection: parsed.data.motionDetection,
  });
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  res.json(UpdateCameraResponse.parse({
    id: camera.id,
    channel: camera.channel,
    name: camera.name,
    status: (camera.status || "unknown") as "online" | "offline" | "unknown",
    recordingEnabled: camera.recordingEnabled,
    motionDetection: camera.motionDetection,
    resolution: camera.resolution ?? undefined,
    nvrId: camera.nvrId,
    streamUrl: buildStreamUrl(config.host, config.rtspPort, camera.channel),
    snapshotUrl: buildSnapshotProxyUrl(camera.id),
  }));
});

router.delete("/nvr/cameras/:id", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const deleted = jsonStore.deleteCamera(params.data.id);
  if (!deleted) { res.status(404).json({ error: "Camera not found" }); return; }
  res.sendStatus(204);
});

router.get("/nvr/cameras/:id/snapshot", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCameraSnapshotParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const camera = jsonStore.getCameraById(params.data.id);
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  res.json(GetCameraSnapshotResponse.parse({
    cameraId: camera.id,
    url: buildSnapshotProxyUrl(camera.id),
    timestamp: new Date().toISOString(),
  }));
});

router.get("/nvr/status", (req, res): void => {
  const config = getOrCreateNvrConfig();
  const cameras = jsonStore.getCameras(config.id);
  const online = cameras.filter((c) => c.status === "online").length;
  res.json(GetNvrStatusResponse.parse({
    connected: config.configured && config.host !== "",
    diskUsage: 1.2 * 1024,
    diskTotal: 4 * 1024,
    uptime: "0d 0h",
    temperature: 45,
    camerasOnline: online,
    camerasTotal: cameras.length,
    recordingActive: cameras.some((c) => c.recordingEnabled),
  }));
});

router.get("/recordings", (req, res): void => {
  const queryParsed = GetRecordingsQueryParams.safeParse(req.query);
  if (!queryParsed.success) { res.status(400).json({ error: queryParsed.error.message }); return; }
  const { cameraId, date } = queryParsed.data;
  const recordings = jsonStore.getRecordings({ cameraId, date });
  res.json(GetRecordingsResponse.parse(recordings.map((r) => ({
    id: r.id,
    cameraId: r.cameraId,
    cameraName: r.cameraName,
    startTime: r.startTime,
    endTime: r.endTime,
    duration: r.duration,
    fileSize: r.fileSize,
    type: r.type as "continuous" | "motion" | "manual",
    playbackUrl: r.playbackUrl ?? undefined,
  }))));
});

export default router;
