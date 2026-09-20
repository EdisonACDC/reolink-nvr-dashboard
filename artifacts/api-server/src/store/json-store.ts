import fs from "fs";
import path from "path";

export interface NvrConfig {
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

export interface Camera {
  id: number;
  nvrId: number;
  channel: number;
  name: string;
  status: string;
  recordingEnabled: boolean;
  motionDetection: boolean;
  resolution: string | null;
  sourceType?: "standalone" | "reolink_nvr";
  rtspUrl?: string;
  subStreamUrl?: string;
  username?: string;
  password?: string;
  recordingMode?: "continuous" | "motion" | "off";
  retentionDays?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Recording {
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

export interface StorageConfig {
  path: string;
  retentionMode: "auto" | "days";
  retentionDays: number;
  reservePercent: number;
  reserveGb: number;
}

interface DbData {
  nvrConfig: NvrConfig[];
  cameras: Camera[];
  recordings: Recording[];
  storage: StorageConfig;
  seq: { nvrConfig: number; cameras: number; recordings: number };
}

const DB_FILE = process.env.ADDON_DB_PATH || "/data/nvr-data.json";

const DEFAULT_STORAGE: StorageConfig = {
  path: process.env.NVR_RECORDINGS_PATH || "/media/reolink-nvr",
  retentionMode: "auto",
  retentionDays: 7,
  reservePercent: 15,
  reserveGb: 20,
};

function load(): DbData {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as Partial<DbData>;
      return {
        nvrConfig: data.nvrConfig ?? [],
        cameras: data.cameras ?? [],
        recordings: data.recordings ?? [],
        storage: { ...DEFAULT_STORAGE, ...(data.storage ?? {}) },
        seq: data.seq ?? { nvrConfig: 1, cameras: 1, recordings: 1 },
      };
    }
  } catch {}
  return {
    nvrConfig: [],
    cameras: [],
    recordings: [],
    storage: { ...DEFAULT_STORAGE },
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
  getStorageConfig(): StorageConfig {
    return load().storage;
  },

  updateStorageConfig(data: Partial<StorageConfig>): StorageConfig {
    const db = load();
    db.storage = { ...DEFAULT_STORAGE, ...db.storage, ...data };
    save(db);
    return db.storage;
  },
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
    const definedData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Partial<Camera>;
    db.cameras[idx] = { ...db.cameras[idx], ...definedData, updatedAt: now() };
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
