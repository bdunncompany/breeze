import { Hono } from 'hono';
import { coreRoutes } from './core';
import { metricsRoutes } from './metrics';
import { softwareRoutes } from './software';
import { commandsRoutes } from './commands';
import { hardwareRoutes } from './hardware';
import { alertsRoutes } from './alerts';
import { groupsRoutes } from './groups';
import { patchesRoutes } from './patches';
import { scriptsRoutes } from './scripts';
import { eventsRoutes } from './events';
import { eventLogsRoutes } from './eventlogs';
import { filesystemRoutes } from './filesystem';
import { sessionsRoutes } from './sessions';
import { diagnosticLogsRoutes } from './diagnosticLogs';
import { watchdogLogsRoutes } from './watchdogLogs';
import { bootMetricsRoutes } from './bootMetrics';
import { diagnoseRoutes } from './diagnose';
import { warrantyRoutes } from './warranty';
import { filterPreviewRoutes } from './filterPreview';
import { queryRoutes } from './query';
import { softwareDistinctRoutes } from './softwareDistinct';
import { softwareActionsRoutes } from './softwareActions';

export const deviceRoutes = new Hono();

// Mount filter-preview routes — `/filter-preview` is a static POST path that
// must NOT be eaten by the `/:id` matcher in coreRoutes.
deviceRoutes.route('/', filterPreviewRoutes);

// Mount query routes — `/query` is a static POST path that must beat `/:id`.
// POST /devices/query is the unified single-snapshot list endpoint. Returns
// row data + optional matchingIds in one query, eliminating the drift bug
// between /devices and /devices/filter-preview.
deviceRoutes.route('/', queryRoutes);

// Mount software/distinct — static GET path; must beat the `/:id` matcher.
deviceRoutes.route('/', softwareDistinctRoutes);

// Mount diagnose routes (POST /:id/diagnose)
deviceRoutes.route('/', diagnoseRoutes);

// Mount groups routes first (they have /groups prefix that could conflict with /:id)
deviceRoutes.route('/', groupsRoutes);

// Mount filesystem routes before core routes so /:id/filesystem resolves cleanly.
deviceRoutes.route('/', filesystemRoutes);

// Mount core routes (/, /:id, PATCH /:id, DELETE /:id)
deviceRoutes.route('/', coreRoutes);

// Mount sub-resource routes
deviceRoutes.route('/', metricsRoutes);
// Mount softwareActionsRoutes BEFORE softwareRoutes so the POST /:id/software/update
// + /:id/software/uninstall handlers are registered ahead of any future
// software.ts handlers that might shadow them. Different verbs today (POST vs
// the existing GET /:id/software) means there's no actual conflict, but ordering
// the more-specific paths first matches the convention used by queryRoutes /
// softwareDistinctRoutes / filterPreviewRoutes above.
deviceRoutes.route('/', softwareActionsRoutes);
deviceRoutes.route('/', softwareRoutes);
deviceRoutes.route('/', commandsRoutes);
deviceRoutes.route('/', hardwareRoutes);
deviceRoutes.route('/', alertsRoutes);
deviceRoutes.route('/', patchesRoutes);
deviceRoutes.route('/', scriptsRoutes);
deviceRoutes.route('/', eventsRoutes);
deviceRoutes.route('/', eventLogsRoutes);
deviceRoutes.route('/', sessionsRoutes);
deviceRoutes.route('/', diagnosticLogsRoutes);
deviceRoutes.route('/', watchdogLogsRoutes);
deviceRoutes.route('/', warrantyRoutes);
deviceRoutes.route('/', bootMetricsRoutes);

// Re-export helpers and schemas for potential use elsewhere
export * from './helpers';
export * from './schemas';
