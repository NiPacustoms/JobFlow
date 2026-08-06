'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminSettingsService } from '@/lib/services/adminSettings';
import { toast } from '@/lib/utils/toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';

export interface SystemSettings {
  systemName: string;
  timezone: string;
  language: string;
  currency: string;
  sessionTimeout: number;
  maxLoginAttempts: number;
  twoFactorRequired: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  shiftReminders: boolean;
  documentExpiryWarnings: boolean;
  shiftConflictWarnings: boolean;
  systemUpdateNotifications: boolean;
  maintenanceNotifications: boolean;
  lastBackup?: Date;
  backupSize?: string;
  availableBackups?: number;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
  status: 'active' | 'inactive' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentType {
  id: string;
  name: string;
  category: 'personal' | 'professional' | 'legal';
  validityPeriod: number;
  required: boolean;
  status: 'active' | 'inactive' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}


export function useAdminSettings() {
  const queryClient = useQueryClient();
  const { user: _user } = useAuth();
  const { canAccessAdminArea } = usePermissions();
  const isAdmin = canAccessAdminArea;

  // Get system settings
  const {
    data: settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery({
    queryKey: ['adminSettings'],
    queryFn: () => adminSettingsService.getSettings(),
    enabled: isAdmin, // Only fetch if user is admin
    retry: false, // Don't retry on permission errors
  });

  // Get roles
  const {
    data: roles = [],
    isLoading: rolesLoading,
    error: rolesError,
  } = useQuery({
    queryKey: ['adminRoles'],
    queryFn: () => adminSettingsService.getRoles(),
    enabled: isAdmin, // Only fetch if user is admin
    retry: false, // Don't retry on permission errors
  });

  // Get document types
  const {
    data: documentTypes = [],
    isLoading: documentTypesLoading,
    error: documentTypesError,
  } = useQuery({
    queryKey: ['adminDocumentTypes'],
    queryFn: () => adminSettingsService.getDocumentTypes(),
    enabled: isAdmin, // Only fetch if user is admin
    retry: false, // Don't retry on permission errors
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<SystemSettings>) => adminSettingsService.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSettings'] });
      toast.success('Einstellungen erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Einstellungen: ' + error.message);
    },
  });

  // Create role mutation
  const createRoleMutation = useMutation({
    mutationFn: (data: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>) => adminSettingsService.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRoles'] });
      toast.success('Rolle erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen der Rolle: ' + error.message);
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Role> }) => adminSettingsService.updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRoles'] });
      toast.success('Rolle erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren der Rolle: ' + error.message);
    },
  });

  // Delete role mutation
  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => adminSettingsService.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRoles'] });
      toast.success('Rolle erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen der Rolle: ' + error.message);
    },
  });

  // Create document type mutation
  const createDocumentTypeMutation = useMutation({
    mutationFn: (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => adminSettingsService.createDocumentType(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminDocumentTypes'] });
      toast.success('Dokumenttyp erfolgreich erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen des Dokumenttyps: ' + error.message);
    },
  });

  // Update document type mutation
  const updateDocumentTypeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DocumentType> }) => adminSettingsService.updateDocumentType(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminDocumentTypes'] });
      toast.success('Dokumenttyp erfolgreich aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren des Dokumenttyps: ' + error.message);
    },
  });

  // Delete document type mutation
  const deleteDocumentTypeMutation = useMutation({
    mutationFn: (id: string) => adminSettingsService.deleteDocumentType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminDocumentTypes'] });
      toast.success('Dokumenttyp erfolgreich gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen des Dokumenttyps: ' + error.message);
    },
  });

  // Status der täglichen serverseitigen Firestore-Sicherung
  const { data: backupStatus = null, isLoading: isLoadingBackupStatus } = useQuery({
    queryKey: ['adminBackupStatus'],
    queryFn: () => adminSettingsService.getBackupStatus(),
    enabled: isAdmin,
    retry: false,
    staleTime: 60 * 1000,
  });

  // Helper functions
  const updateSettings = async (data: Partial<SystemSettings>) => {
    return updateSettingsMutation.mutateAsync(data);
  };

  const createRole = async (data: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>) => {
    return createRoleMutation.mutateAsync(data);
  };

  const updateRole = async (id: string, data: Partial<Role>) => {
    return updateRoleMutation.mutateAsync({ id, data });
  };

  const deleteRole = async (id: string) => {
    return deleteRoleMutation.mutateAsync(id);
  };

  const createDocumentType = async (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => {
    return createDocumentTypeMutation.mutateAsync(data);
  };

  const updateDocumentType = async (id: string, data: Partial<DocumentType>) => {
    return updateDocumentTypeMutation.mutateAsync({ id, data });
  };

  const deleteDocumentType = async (id: string) => {
    return deleteDocumentTypeMutation.mutateAsync(id);
  };

  return {
    settings: settings || {
      systemName: 'Schichtklar',
      timezone: 'Europe/Berlin',
      language: 'de',
      currency: 'EUR',
      sessionTimeout: 30,
      maxLoginAttempts: 5,
      twoFactorRequired: false,
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
      shiftReminders: true,
      documentExpiryWarnings: true,
      shiftConflictWarnings: true,
      systemUpdateNotifications: true,
      maintenanceNotifications: true,
    },
    roles,
    documentTypes,
    isLoading: settingsLoading || rolesLoading || documentTypesLoading,
    error: settingsError || rolesError || documentTypesError,
    updateSettings,
    createRole,
    updateRole,
    deleteRole,
    createDocumentType,
    updateDocumentType,
    deleteDocumentType,
    backupStatus,
    isLoadingBackupStatus,
    isUpdating: updateSettingsMutation.isPending,
    isCreating: createRoleMutation.isPending || createDocumentTypeMutation.isPending,
    isDeleting: deleteRoleMutation.isPending || deleteDocumentTypeMutation.isPending,
  };
}
