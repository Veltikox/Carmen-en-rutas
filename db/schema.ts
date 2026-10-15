import {sqliteTable, text, integer, real} from 'drizzle-orm/sqlite-core';

// Latest position only. There is no route or driver location history.
export const liveBuses = sqliteTable('live_buses', {
  id: text('id').primaryKey(),
  routeId: text('route_id').notNull(),
  unit: integer('unit').notNull(),
  ownerId: text('owner_id').notNull(),
  sessionHash: text('session_hash').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  accuracy: real('accuracy'),
  speedMps: real('speed_mps'),
  heading: real('heading'),
  sampledAt: integer('sampled_at'),
  updatedAt: integer('updated_at').notNull(),
  sequence: integer('sequence').notNull().default(0),
  active: integer('active').notNull().default(1),
});
