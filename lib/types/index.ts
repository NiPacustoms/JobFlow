/**
 * Schichtklar Types - Re-exports from domain modules
 * Import from '@/lib/types' or '@/lib/types/user' etc.
 */

export * from './user';
export * from './company';
export * from './invitation';
export * from './facility';
export * from './shift';
export * from './assignment';
export * from './timesheet';
export * from './document';
export * from './notification';
export * from './api';
export * from './audit';
export * from './template';
export * from './weeklyLimit';

// Cross-domain composite types (depend on multiple domains)
import type { Shift } from './shift';
import type { Assignment } from './assignment';
import type { User } from './user';
import type { TimeConflict } from './assignment';

export interface ShiftWithAssignments extends Shift {
  assignments: Assignment[];
  assignedUsers: User[];
}

export interface ConflictSummary {
  conflictCount: number;
  affectedUsers: string[];
  conflicts: TimeConflict[];
}

// Core & UI (existing modules)
export * from './core';
export * from './ui';
