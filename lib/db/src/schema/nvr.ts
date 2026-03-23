import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nvrConfigTable = pgTable("nvr_config", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("My NVR"),
  host: text("host").notNull().default(""),
  port: integer("port").notNull().default(80),
  username: text("username").notNull().default("admin"),
  password: text("password").notNull().default(""),
  rtspPort: integer("rtsp_port").notNull().default(554),
  httpPort: integer("http_port").notNull().default(80),
  channelCount: integer("channel_count").notNull().default(4),
  configured: boolean("configured").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNvrConfigSchema = createInsertSchema(nvrConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNvrConfig = z.infer<typeof insertNvrConfigSchema>;
export type NvrConfig = typeof nvrConfigTable.$inferSelect;

export const camerasTable = pgTable("cameras", {
  id: serial("id").primaryKey(),
  nvrId: integer("nvr_id").notNull().default(1),
  channel: integer("channel").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("unknown"),
  recordingEnabled: boolean("recording_enabled").notNull().default(true),
  motionDetection: boolean("motion_detection").notNull().default(true),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCameraSchema = createInsertSchema(camerasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof camerasTable.$inferSelect;

export const recordingsTable = pgTable("recordings", {
  id: serial("id").primaryKey(),
  cameraId: integer("camera_id").notNull(),
  cameraName: text("camera_name").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  duration: integer("duration").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  type: text("type").notNull().default("continuous"),
  playbackUrl: text("playback_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordingSchema = createInsertSchema(recordingsTable).omit({ id: true, createdAt: true });
export type InsertRecording = z.infer<typeof insertRecordingSchema>;
export type Recording = typeof recordingsTable.$inferSelect;
