import fs from "fs";
import path from "path";

interface NvrConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  rtspPort: number;
  httpPort: number;
  channelCount: number;
  configured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Camera {
  id: number;
  nvrId: number;
  channel: number;
  name: string;
  status: string;
  recordingEnabled: boolean;
  motionDetection: boolean;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Recording {
  id: number;
  cameraId: number;
  cameraName: string;
  startTime: string;
  endTime: string;
  duration: number;
  fileSize: number;
  type: string;
  playbackUrl: string | null;
  createdAt: string;
}

interface DbData {
  nvrConfig: NvrConfig[];
  cameras: Camera[];
  recordings: Recording[];
  seq: { nvrConfig: number; cameras: number; recordings: number };
}

const DB_FILE = process.env.ADDON_DB_PATH || "/data/nvr-data.json";

function load(): DbData {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    }
  } catch {}
  return {
    nvrConfig: [],
    cameras: [],
    recordings: [],
    seq: { nvrConfig: 1, cameras: 1, recordings: 1 },
  };
}

function save(data: DbData): void {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

export const jsonStore = {
  getNvrConfig(): NvrConfig | undefined {
    return load().nvrConfig[0];
  },

  createNvrConfig(data: Omit<NvrConfig, "id" | "createdAt" | "updatedAt">): NvrConfig {
    const db = load();
    const record: NvrConfig = {
      id: db.seq.nvrConfig++,
      ...data,
      createdAt: now(),
      updatedAt: now(),
    };
    db.nvrConfig.push(record);
    save(db);
    return record;
  },

  updateNvrConfig(id: number, data: Partial<NvrConfig>): NvrConfig | undefined {
    const db = load();
    const idx = db.nvrConfig.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    db.nvrConfig[idx] = { ...db.nvrConfig[idx], ...data, updatedAt: now() };
    save(db);
    return db.nvrConfig[idx];
  },

  getCameras(nvrId: number): Camera[] {
    return load().cameras.filter((c) => c.nvrId === nvrId);
  },

  getCameraById(id: number): Camera | undefined {
    return load().cameras.find((c) => c.id === id);
  },

  createCamera(data: Omit<Camera, "id" | "createdAt" | "updatedAt">): Camera {
    const db = load();
    const record: Camera = {
      id: db.seq.cameras++,
      ...data,
      createdAt: now(),
      updatedAt: now(),
    };
    db.cameras.push(record);
    save(db);
    return record;
  },

  updateCamera(id: number, data: Partial<Camera>): Camera | undefined {
    const db = load();
    const idx = db.cameras.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    db.cameras[idx] = { ...db.cameras[idx], ...data, updatedAt: now() };
    save(db);
    return db.cameras[idx];
  },

  deleteCamera(id: number): Camera | undefined {
    const db = load();
    const idx = db.cameras.findIndex((c) => c.id === id);
    if (idx === -1) return undefined;
    const [deleted] = db.cameras.splice(idx, 1);
    save(db);
    return deleted;
  },

  getRecordings(filter?: { cameraId?: number; date?: string }): Recording[] {
    let recs = load().recordings;
    if (filter?.cameraId) recs = recs.filter((r) => r.cameraId === filter.cameraId);
    if (filter?.date) {
      const dateStart = new Date(`${filter.date}T00:00:00Z`).toISOString();
      const dateEnd = new Date(`${filter.date}T23:59:59Z`).toISOString();
      recs = recs.filter((r) => r.startTime >= dateStart && r.startTime <= dateEnd);
    }
    return recs;
  },
};
