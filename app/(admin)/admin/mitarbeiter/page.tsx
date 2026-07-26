'use client';

import { useAuth } from '@/contexts/AuthContext';
import {
  useBulkOperations,
  createBulkDeleteOperation,
  createBulkStatusUpdateOperation,
} from '@/lib/hooks/useBulkOperations';
import { userService } from '@/lib/services/users';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logging';
import { StaffCreateDialog } from '@/components/admin/StaffCreateDialog';
import { StaffEditDialog } from '@/components/admin/StaffEditDialog';
import { CategoryManager } from '@/components/admin/CategoryManager';
import { StaffFilters } from '@/components/admin/StaffFilters';
import { StaffStatsCard } from '@/components/admin/StaffStatsCard';
import { StaffStatusCard } from '@/components/admin/StaffStatusCard';
import { StaffGroupCard } from '@/components/admin/StaffGroupCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { PageContainer } from '@/components/layout/PageContainer';
import { escapeHtml } from '@/lib/utils/sanitize';
import { People, Add, Group, Edit, Delete, Visibility, ContentCopy, MailOutline, PhoneOutlined, BusinessOutlined } from '@mui/icons-material';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Chip,
  Avatar,
  Card,
  CardContent,
  CardActions,
  Alert,
  Snackbar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Pagination from '@mui/material/Pagination';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { sendSignInLinkToEmail } from 'firebase/auth';
import { roleLabelMap, type StaffUpdateInput } from '@/lib/validations/staff';
import ConfirmDestructiveDialog from '@/components/ui/ConfirmDestructiveDialog';

// Use User type from services instead of custom interface
import { User, PaginatedResponse } from '@/lib/types';

export default function StaffManagementPage() {
  const { loading: authLoading, firebaseUser, user } = useAuth();

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Filter states (debounced search)
  const [searchTermInput, setSearchTermInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchTermInput), 300);
    return () => clearTimeout(t);
  }, [searchTermInput]);

  // Invitation link dialog (damit Admin den Link manuell weiterleiten kann, falls E-Mail nicht ankommt)
  const [inviteLinkDialog, setInviteLinkDialog] = useState<{
    open: boolean;
    acceptLink: string;
    email: string;
    companyName: string;
    emailSendFailed?: boolean;
    firebaseSendFailed?: boolean;
  }>({ open: false, acceptLink: '', email: '', companyName: '' });

  // Eingabe-Dialog für Einladung (ersetzt window.prompt)
  const [inviteInput, setInviteInput] = useState<{ open: boolean; email: string; submitting: boolean }>(
    { open: false, email: '', submitting: false }
  );

  // Notification states
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info'>('success');
  const [undoData, setUndoData] = useState<{ id: string; prev: User } | null>(null);
  const [bulkUndoData, setBulkUndoData] = useState<{ items: { id: string; prev: User }[] } | null>(
    null
  );

  // Query client (used by bulk ops and queries)
  const queryClient = useQueryClient();

  // Pagination (must be declared before queries)
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(12);

  // Snackbar helper function (must be defined before useBulkOperations)
  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []);

  // Bulk operations
  const bulkOperations = [
    createBulkDeleteOperation(async (ids: string[]) => {
      await Promise.all(ids.map(id => userService.delete(id)));
      queryClient.invalidateQueries({ queryKey: ['users'] });
    }, 'Mitarbeiter'),
    createBulkStatusUpdateOperation(
      async (ids: string[], status: string) => {
        const active = status === 'active';
        await Promise.all(ids.map(id => userService.update(id, { active })));
        queryClient.invalidateQueries({ queryKey: ['users'] });
      },
      'active',
      'Aktiv'
    ),
    createBulkStatusUpdateOperation(
      async (ids: string[], status: string) => {
        const active = status === 'active';
        await Promise.all(ids.map(id => userService.update(id, { active })));
        queryClient.invalidateQueries({ queryKey: ['users'] });
      },
      'inactive',
      'Inaktiv'
    ),
  ];

  useBulkOperations(
    bulkOperations,
    useCallback(() => {
      // Refresh data after bulk operation
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showSnackbar('Bulk-Operation erfolgreich abgeschlossen', 'success');
    }, [queryClient, showSnackbar])
  );

  // Load staff data from Firebase
  const {
    data: staffResponse,
    isLoading: staffLoading,
    error: staffError,
  } = useQuery({
    queryKey: [
      'users',
      'staff',
      page,
      rowsPerPage,
      roleFilter,
      statusFilter,
      groupFilter,
      user?.companyId,
    ],
    queryFn: () =>
      userService.getAll(page, rowsPerPage, {
        role: roleFilter as User['role'] | 'all',
        status: statusFilter as 'active' | 'inactive' | 'all',
        group: groupFilter as string | 'all',
        companyId: user?.companyId || undefined,
      }),
    placeholderData: prev => prev,
    enabled: !!user?.companyId, // Query nur ausführen, wenn companyId vorhanden ist
  });

  // Memoize allStaff to prevent infinite loop - use empty array only if data is actually undefined
  const allStaff = useMemo(() => {
    return staffResponse?.data || [];
  }, [staffResponse?.data]);

  // Apply filters using useMemo instead of useEffect to prevent infinite loops
  const filteredStaff = useMemo(() => {
    let filtered = allStaff;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        member =>
          (member.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (member.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (member.phone || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(member => member.role === roleFilter);
    }

    // Status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter(member => member.active);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter(member => !member.active);
    }

    // Group filter (if group property exists)
    if (groupFilter !== 'all') {
      filtered = filtered.filter(
        member => (member as User & { group?: string }).group === groupFilter
      );
    }

    return filtered;
  }, [allStaff, searchTerm, roleFilter, statusFilter, groupFilter]);

  // Pagination: Der Service liefert BEREITS genau eine Seite (page/rowsPerPage).
  // Ein zusätzliches clientseitiges slice() hätte auf Seite 2+ immer eine leere
  // Liste ergeben. Die Seitenanzahl kommt daher aus dem Server-Total.
  const totalCount = staffResponse?.total ?? filteredStaff.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(totalCount, 1) / rowsPerPage));
  useEffect(() => {
    // Reset to first page when filters change
    setPage(1);
  }, [searchTerm, roleFilter, statusFilter, groupFilter]);
  const paginatedStaff = filteredStaff;

  // CSV Export
  const exportCsv = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const header = ['Name', 'E-Mail', 'Telefon', 'Jobtitel', 'Rolle', 'Aktiv', 'Gruppe'];
    const rows = filteredStaff.map(m => [
      m.displayName || m.email || 'Unbekannter Benutzer',
      m.email || '',
      m.phone || '',
      m.jobTitle || '',
      m.role || '',
      m.active ? 'Ja' : 'Nein',
      (m as User & { group?: string }).group || '',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mitarbeiter_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredStaff]);

  // Excel Export entfernt – nur CSV bleibt erhalten

  // Firebase mutations
  const createStaffMutation = useMutation({
    mutationFn: (staffData: Partial<User>) =>
      userService.create({
        displayName: staffData.displayName || '',
        email: staffData.email || '',
        phone: staffData.phone || '',
        jobTitle: staffData.jobTitle || '',
        role: (staffData.role as User['role']) || 'nurse',
        qualifications: staffData.qualifications || [],
        group: staffData.group || '',
        active: staffData.active !== undefined ? staffData.active : true,
        address: staffData.address || {},
        contact: staffData.contact || {},
        emergencyContact: staffData.emergencyContact || {},
        bankAccount: staffData.bankAccount || {},
        education: staffData.education || {},
        driversLicense: staffData.driversLicense || {},
      }),
    onMutate: async newData => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const prev = queryClient.getQueryData<PaginatedResponse<User>>(['users', 'staff']);
      const optimisticUser = {
        id: 'optimistic-' + Math.random().toString(36).slice(2),
        displayName: newData.displayName || '',
        email: newData.email || '',
        phone: newData.phone || '',
        jobTitle: newData.jobTitle || '',
        role: (newData.role as User['role']) || 'nurse',
        qualifications: newData.qualifications || [],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User;
      queryClient.setQueryData<PaginatedResponse<User>>(['users', 'staff'], old => ({
        ...(old || { data: [], total: 0, page: 1, limit: rowsPerPage, hasMore: false }),
        data: [...(old?.data || []), optimisticUser],
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['users', 'staff'], ctx.prev);
      showSnackbar('Fehler beim Erstellen', 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onSuccess: () => {
      setCreateDialogOpen(false);
      showSnackbar('Mitarbeiter erfolgreich erstellt', 'success');
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) => userService.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const prev = queryClient.getQueryData<PaginatedResponse<User>>(['users', 'staff']);
      queryClient.setQueryData<PaginatedResponse<User>>(['users', 'staff'], old => ({
        ...(old || { data: [], total: 0, page: 1, limit: rowsPerPage, hasMore: false }),
        data: (old?.data || []).map((u: User) =>
          u.id === id ? { ...u, ...data, updatedAt: new Date() } : u
        ),
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['users', 'staff'], ctx.prev);
      showSnackbar('Fehler beim Aktualisieren', 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onSuccess: () => {
      setEditDialogOpen(false);
      setSelectedStaff(null);
      showSnackbar('Mitarbeiter erfolgreich aktualisiert', 'success');
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: (staffId: string) => userService.delete(staffId),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const prev = queryClient.getQueryData<PaginatedResponse<User>>(['users', 'staff']);
      const prevUser = (prev?.data || []).find(u => u.id === id);
      queryClient.setQueryData<PaginatedResponse<User>>(['users', 'staff'], old => ({
        ...(old || { data: [], total: 0, page: 1, limit: rowsPerPage, hasMore: false }),
        data: (old?.data || []).filter((u: User) => u.id !== id),
      }));
      if (prevUser) setUndoData({ id, prev: prevUser });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['users', 'staff'], ctx.prev);
      showSnackbar('Fehler beim Löschen', 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onSuccess: () => {
      showSnackbar('Mitarbeiter gelöscht – Rückgängig möglich', 'success');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      userService.update(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showSnackbar('Status erfolgreich geändert', 'success');
    },
    onError: (error: unknown) => {
      showSnackbar(
        'Fehler beim Ändern des Status: ' +
          (error instanceof Error ? error.message : 'Unbekannter Fehler'),
        'error'
      );
    },
  });

  const handleCreateStaff = (staffData: Partial<User>) => {
    createStaffMutation.mutate(staffData);
  };

  const handleEditStaff = (staffData: StaffUpdateInput) => {
    if (!selectedStaff) return;

    // IBAN-Leerzeichen entfernen, falls vorhanden; customRoleId null → undefined für User-Typ
    const processedData = { ...staffData, customRoleId: staffData.customRoleId ?? undefined } as Partial<User>;
    if (processedData.bankAccount?.iban && typeof processedData.bankAccount.iban === 'string') {
      processedData.bankAccount = {
        ...processedData.bankAccount,
        iban: processedData.bankAccount.iban.replace(/\s+/g, '').toUpperCase(),
      };
    }

    updateStaffMutation.mutate({ id: selectedStaff.id, data: processedData });
  };

  const handleDeleteStaff = (staffId: string) => {
    setPendingDeleteId(staffId);
    setConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (pendingDeleteId) {
      deleteStaffMutation.mutate(pendingDeleteId);
    }
    setConfirmOpen(false);
    setPendingDeleteId(null);
  };

  const handleToggleActive = (staffId: string) => {
    const member = allStaff.find(m => m.id === staffId);
    if (member) {
      toggleActiveMutation.mutate({ id: staffId, active: !member.active });
    }
  };

  // Öffnet den Eingabe-Dialog für die Einladung.
  const inviteStaff = useCallback(() => {
    setInviteInput({ open: true, email: '', submitting: false });
  }, []);

  const submitInvite = useCallback(async (email: string) => {
    try {
      const idToken = await firebaseUser?.getIdToken();
      if (!idToken) throw new Error('Nicht angemeldet');
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || data?.error?.userMessage || 'Fehler beim Erstellen der Einladung');
      }
      const invitationData = await res.json();

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== 'undefined' ? window.location.origin : '');
      const acceptLink =
        invitationData?.acceptLink ||
        `${baseUrl}/einladung-annehmen?token=${encodeURIComponent(invitationData?.token ?? '')}`;

      // SOTA: E-Mail wird serverseitig versendet; API liefert emailSent
      const emailSendFailed = invitationData?.emailSent === false;
      let firebaseSendFailed = false;

      // Optional: Firebase Sign-In-Link als zweiten Kanal (Magic Link)
      if (auth) {
        try {
          const actionCodeSettings = {
            url: `${baseUrl}/einladung-annehmen`,
            handleCodeInApp: true,
          } as const;
          await sendSignInLinkToEmail(auth, email, actionCodeSettings);
        } catch (firebaseError) {
          logger.error(
            'Firebase Sign-In-Link konnte nicht gesendet werden',
            firebaseError instanceof Error ? firebaseError : new Error(String(firebaseError))
          );
          firebaseSendFailed = true;
        }
      }

      setInviteLinkDialog({
        open: true,
        acceptLink,
        email,
        companyName: invitationData?.companyName || 'Ihre Firma',
        emailSendFailed,
        firebaseSendFailed,
      });
      showSnackbar('Einladung erstellt', 'success');
      setInviteInput({ open: false, email: '', submitting: false });
    } catch (e: unknown) {
      showSnackbar(e instanceof Error ? e.message : 'Unbekannter Fehler', 'error');
      setInviteInput(prev => ({ ...prev, submitting: false }));
    }
  }, [firebaseUser, showSnackbar]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const clearSelection = () => setSelectedIds([]);

  const bulkActivate = async (active: boolean) => {
    if (selectedIds.length === 0) return;
    try {
      await Promise.all(selectedIds.map(id => userService.update(id, { active })));
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['users'] });
      showSnackbar(`Status ${active ? 'aktiviert' : 'deaktiviert'}`, 'success');
    } catch (_e) {
      showSnackbar('Fehler bei Bulk-Statusänderung', 'error');
    }
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const items = allStaff
      .filter(m => selectedIds.includes(m.id))
      .map(prev => ({ id: prev.id, prev }) as { id: string; prev: User });
    try {
      await Promise.all(selectedIds.map(id => userService.delete(id)));
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setBulkUndoData({ items });
      showSnackbar('Mitarbeiter gelöscht – Rückgängig möglich', 'success');
    } catch (_e) {
      showSnackbar('Fehler beim Bulk-Löschen', 'error');
    } finally {
      setBulkConfirmOpen(false);
    }
  };

  // Rollen sind kein Status – neutrale/Brand-Farben statt Semantik (rot = Fehler)
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'primary';
      case 'nurse':
        return 'default';
      default:
        return 'default';
    }
  };

  const getRoleLabel = (role: string) =>
    roleLabelMap[(role as keyof typeof roleLabelMap) || 'nurse'] || 'Krankenschwester';

  if (authLoading || staffLoading) {
    return <LoadingSpinner message="Mitarbeiterverwaltung wird geladen..." />;
  }

  if (staffError) {
    return <ErrorDisplay error={staffError} />;
  }

  if (!user?.companyId) {
    return (
      <PageContainer maxWidth="wide">
        <Alert severity="warning">
          Keine Unternehmens-ID gefunden. Bitte kontaktiere den Administrator, um dein Konto einem
          Unternehmen zuzuordnen.
        </Alert>
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer maxWidth="wide">
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h2" component="h1" sx={{ color: 'text.primary', mb: 1 }}>
            Mitarbeiterverwaltung
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Verwalten Sie alle Mitarbeiter und deren Informationen
          </Typography>
        </Box>

        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid key="stats-total" size={{ xs: 12, sm: 6, md: 3 }}>
            <StaffStatsCard
              title="Gesamt Mitarbeiter"
              value={allStaff.length}
              icon={<People />}
              color="primary"
            />
          </Grid>
          <Grid key="stats-active" size={{ xs: 12, sm: 6, md: 3 }}>
            <StaffStatusCard
              title="Aktive Mitarbeiter"
              value={allStaff.filter(s => s.active).length}
              total={allStaff.length}
              icon={<People />}
              color="success"
            />
          </Grid>
          <Grid key="stats-nurse" size={{ xs: 12, sm: 6, md: 3 }}>
            <StaffGroupCard
              title="Pflegekräfte"
              value={allStaff.filter(s => s.role === 'nurse').length}
              icon={<People />}
              color="info"
            />
          </Grid>
          <Grid key="stats-admin" size={{ xs: 12, sm: 6, md: 3 }}>
            <StaffGroupCard
              title="Administratoren"
              value={allStaff.filter(s => s.role === 'admin').length}
              icon={<People />}
              color="primary"
            />
          </Grid>
        </Grid>

        {/* Actions Bar */}
        <Paper className="glass" sx={{ p: 3, mb: 3 }}>
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={2}
            alignItems={{ xs: 'flex-start', lg: 'center' }}
            justifyContent="space-between"
            sx={{ mb: 2 }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Mitarbeiter ({filteredStaff.length})
            </Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ width: { xs: '100%', lg: 'auto' } }}
            >
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => setCreateDialogOpen(true)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Neuer Mitarbeiter
              </Button>
              <Button
                variant="outlined"
                onClick={inviteStaff}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Mitarbeiter einladen
              </Button>
              <Button
                variant="outlined"
                startIcon={<Group />}
                onClick={() => setCategoryManagerOpen(true)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Kategorien verwalten
              </Button>
              <Button
                variant="outlined"
                onClick={exportCsv}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Export CSV
              </Button>
              {/* Export Excel entfernt */}
            </Stack>
          </Stack>

          {selectedIds.length > 0 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ mb: 2 }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
            >
              <Typography variant="body2">{selectedIds.length} ausgewählt</Typography>
              <Button
                size="small"
                onClick={() => bulkActivate(true)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Aktivieren
              </Button>
              <Button
                size="small"
                onClick={() => bulkActivate(false)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Deaktivieren
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => setBulkConfirmOpen(true)}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Löschen
              </Button>
              <Button
                size="small"
                onClick={clearSelection}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Auswahl aufheben
              </Button>
            </Stack>
          )}

          {/* Filters */}
          <StaffFilters
            searchTerm={searchTermInput}
            onSearchChange={setSearchTermInput}
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            groupFilter={groupFilter}
            onGroupFilterChange={setGroupFilter}
            availableGroups={
              Array.from(
                new Set(allStaff.map(s => (s as User & { group?: string }).group).filter(Boolean))
              ) as string[]
            }
          />
        </Paper>

        {/* Staff List */}
        {staffLoading ? (
          <Grid container spacing={3}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card
                  className="glass"
                  sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Skeleton variant="circular" width={40} height={40} sx={{ mr: 2 }} />
                      <Box sx={{ flexGrow: 1 }}>
                        <Skeleton variant="text" width="60%" height={28} />
                        <Skeleton variant="text" width="40%" height={20} />
                      </Box>
                    </Box>
                    <Skeleton variant="text" width="80%" />
                    <Skeleton variant="text" width="50%" />
                  </CardContent>
                  <CardActions sx={{ p: 2 }}>
                    <Skeleton variant="rectangular" width={80} height={32} />
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Grid container spacing={3}>
            {paginatedStaff.map(member => (
              <Grid key={member.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card
                  className="glass"
                  sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Avatar sx={{ mr: 2, bgcolor: 'primary.main' }}>
                        {(member.displayName || member.email || '?').charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                          {escapeHtml(member.displayName || member.email || 'Unbekannter Benutzer')}
                        </Typography>
                        <Chip
                          label={getRoleLabel(member.role)}
                          color={getRoleColor(member.role)}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      <input
                        aria-label="Mitarbeiter auswählen"
                        type="checkbox"
                        checked={selectedIds.includes(member.id)}
                        onChange={() => toggleSelected(member.id)}
                      />
                    </Box>

                    <Box sx={{ mb: 2 }}>
                      {member.jobTitle && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          {escapeHtml(member.jobTitle)}
                        </Typography>
                      )}
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
                      >
                        <MailOutline sx={{ fontSize: 16, color: 'text.disabled' }} />
                        {escapeHtml(member.email)}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
                        className="tabular-nums"
                      >
                        <PhoneOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
                        {member.phone}
                      </Typography>
                      {(member as User & { group?: string }).group && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <BusinessOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
                          {(member as User & { group?: string }).group}
                        </Typography>
                      )}
                    </Box>

                    {member.qualifications.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mb: 1 }}
                        >
                          Qualifikationen:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {member.qualifications.slice(0, 2).map((qual, index) => (
                            <Chip
                              key={index}
                              label={qual}
                              size="small"
                              variant="outlined"
                              color="info"
                            />
                          ))}
                          {member.qualifications.length > 2 && (
                            <Chip
                              key={`${member.id}-more-qual`}
                              label={`+${member.qualifications.length - 2}`}
                              size="small"
                              variant="outlined"
                              color="default"
                            />
                          )}
                        </Box>
                      </Box>
                    )}

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={member.active ? 'Aktiv' : 'Inaktiv'}
                        color={member.active ? 'success' : 'default'}
                        size="small"
                        variant={member.active ? 'filled' : 'outlined'}
                      />
                      {(member as User & { lastActive?: Date }).lastActive && (
                        <Typography variant="caption" color="text.secondary">
                          Zuletzt aktiv:{' '}
                          {new Date(
                            (member as User & { lastActive?: Date }).lastActive!
                          ).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </Typography>
                      )}
                    </Box>
                  </CardContent>

                  <CardActions sx={{ justifyContent: 'space-between', p: 2 }}>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setSelectedStaff(member);
                          setEditDialogOpen(true);
                        }}
                        color="primary"
                        aria-label={`${member.displayName || member.email || 'Mitarbeiter'} bearbeiten`}
                      >
                        <Edit />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleToggleActive(member.id)}
                        color={member.active ? 'warning' : 'success'}
                        disabled={toggleActiveMutation.isPending}
                        aria-label={member.active ? 'Deaktivieren' : 'Aktivieren'}
                      >
                        <Visibility />
                      </IconButton>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteStaff(member.id)}
                      color="error"
                      disabled={deleteStaffMutation.isPending}
                      aria-label={`${member.displayName || member.email || 'Mitarbeiter'} löschen`}
                    >
                      <Delete />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Pagination Controls */}
        {!staffLoading && (filteredStaff.length > 0 || allStaff.length > 0) && (
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3 }}
          >
            <Box>
              <Typography variant="body2" color="text.secondary">
                {`Zeige ${filteredStaff.length === 0 ? 0 : (page - 1) * rowsPerPage + 1}–${(page - 1) * rowsPerPage + filteredStaff.length} von ${totalCount}`}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Pro Seite</InputLabel>
                <Select
                  label="Pro Seite"
                  value={rowsPerPage}
                  onChange={e => setRowsPerPage(Number(e.target.value))}
                >
                  <MenuItem value={12}>12</MenuItem>
                  <MenuItem value={24}>24</MenuItem>
                  <MenuItem value={48}>48</MenuItem>
                </Select>
              </FormControl>
              <Pagination
                count={totalPages}
                page={page}
                color="primary"
                onChange={(_e, val) => setPage(val)}
              />
            </Box>
          </Box>
        )}

        {filteredStaff.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
              Keine Mitarbeiter gefunden
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {searchTerm || roleFilter !== 'all' || statusFilter !== 'all' || groupFilter !== 'all'
                ? 'Versuchen Sie andere Filterkriterien'
                : 'Erstellen Sie den ersten Mitarbeiter'}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Mitarbeiter hinzufügen
            </Button>
          </Box>
        )}
      </PageContainer>
      {/* Dialogs */}
      <StaffCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSave={handleCreateStaff}
      />

      <StaffEditDialog
        open={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setSelectedStaff(null);
        }}
        onSave={handleEditStaff}
        staff={
          selectedStaff
            ? {
                ...selectedStaff,
                jobTitle: selectedStaff.jobTitle || '',
                phone: selectedStaff.phone || '',
                group: (selectedStaff as User & { group?: string }).group || '',
                lastActive:
                  (selectedStaff as User & { lastActive?: Date }).lastActive || new Date(),
              }
            : null
        }
      />

      <CategoryManager
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        onSave={_categories => {
          // Handle category management
          showSnackbar('Kategorien erfolgreich aktualisiert', 'success');
        }}
      />

      {/* Dialog: E-Mail für Einladung eingeben (ersetzt window.prompt) */}
      <Dialog
        open={inviteInput.open}
        onClose={() => !inviteInput.submitting && setInviteInput(prev => ({ ...prev, open: false }))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Mitarbeiter einladen</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Die Person erhält eine E-Mail mit einem Link, um ihr Konto anzulegen und Ihrer Firma
            beizutreten.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            type="email"
            label="E-Mail-Adresse"
            placeholder="name@beispiel.de"
            value={inviteInput.email}
            onChange={e => setInviteInput(prev => ({ ...prev, email: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteInput.email.trim())) {
                setInviteInput(prev => ({ ...prev, submitting: true }));
                void submitInvite(inviteInput.email.trim());
              }
            }}
            disabled={inviteInput.submitting}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setInviteInput(prev => ({ ...prev, open: false }))}
            disabled={inviteInput.submitting}
          >
            Abbrechen
          </Button>
          <Button
            variant="contained"
            disabled={
              inviteInput.submitting ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteInput.email.trim())
            }
            onClick={() => {
              setInviteInput(prev => ({ ...prev, submitting: true }));
              void submitInvite(inviteInput.email.trim());
            }}
          >
            {inviteInput.submitting ? 'Wird gesendet…' : 'Einladung senden'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog: Einladungslink anzeigen (für manuelles Weiterleiten, falls E-Mail nicht ankommt) */}
      <Dialog
        open={inviteLinkDialog.open}
        onClose={() => setInviteLinkDialog(prev => ({ ...prev, open: false }))}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Einladung erstellt</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Einladung für <strong>{inviteLinkDialog.email}</strong> ({inviteLinkDialog.companyName}).
          </Typography>
          {inviteLinkDialog.emailSendFailed && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Die E-Mail konnte nicht automatisch versendet werden (z. B. E-Mail-Dienst nicht konfiguriert oder
              Fehler beim Versand). Bitte senden Sie den folgenden Link manuell an die eingeladene Person (z. B. per
              E-Mail oder WhatsApp).
            </Alert>
          )}
          {inviteLinkDialog.firebaseSendFailed && !inviteLinkDialog.emailSendFailed && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Die Einladungs-E-Mail wurde versendet. Ein zusätzlicher Anmeldelink (Firebase) konnte nicht gesendet
              werden – der unten stehende Link reicht zur Annahme der Einladung.
            </Alert>
          )}
          {!inviteLinkDialog.emailSendFailed && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {inviteLinkDialog.firebaseSendFailed
                ? 'Falls die Person die E-Mail nicht erhält, können Sie den Link manuell weiterleiten:'
                : 'Falls die Person keine E-Mail erhält, können Sie den Link manuell weiterleiten:'}
            </Typography>
          )}
          {inviteLinkDialog.acceptLink?.includes('localhost') && (
            <Alert severity="info" sx={{ mb: 1 }}>
              Der Link verweist auf localhost. Damit Empfänger die Einladung öffnen können, setzen Sie in .env.local
              <strong> NEXT_PUBLIC_APP_URL</strong> auf Ihre öffentliche URL (z. B. https://app.ihredomain.de) und starten
              Sie den Dev-Server neu.
            </Alert>
          )}
          <TextField
            fullWidth
            size="small"
            label="Einladungslink"
            value={inviteLinkDialog.acceptLink}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => {
                      if (inviteLinkDialog.acceptLink && navigator.clipboard) {
                        navigator.clipboard.writeText(inviteLinkDialog.acceptLink);
                        showSnackbar('Link in Zwischenablage kopiert', 'success');
                      }
                    }}
                    aria-label="Link kopieren"
                  >
                    <ContentCopy />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteLinkDialog(prev => ({ ...prev, open: false }))}>
            Schließen
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity={snackbarSeverity}
          sx={{ width: '100%' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span>{snackbarMessage}</span>
            {(undoData || (bulkUndoData && snackbarSeverity === 'success')) && (
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  await (async () => {
                    try {
                      if (undoData) {
                        await userService.restore(undoData.id, undoData.prev);
                        setUndoData(null);
                      } else if (bulkUndoData) {
                        await Promise.all(
                          bulkUndoData.items.map(item => userService.restore(item.id, item.prev))
                        );
                        setBulkUndoData(null);
                      }
                      queryClient.invalidateQueries({ queryKey: ['users'] });
                      showSnackbar('Wiederhergestellt', 'success');
                    } catch (_e) {
                      showSnackbar('Rückgängig fehlgeschlagen', 'error');
                    }
                  })();
                }}
              >
                Rückgängig
              </Button>
            )}
          </Box>
        </Alert>
      </Snackbar>

      <ConfirmDestructiveDialog
        open={confirmOpen}
        title="Mitarbeiter löschen"
        description="Diese Aktion ist irreversibel. Der Benutzer wird deaktiviert und personenbezogene Daten werden entfernt. Tippen Sie LÖSCHEN zur Bestätigung."
        confirmWord="LÖSCHEN"
        confirmLabel="Löschen"
        onClose={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onConfirm={handleConfirmDelete}
      />

      <ConfirmDestructiveDialog
        open={bulkConfirmOpen}
        title="Auswahl löschen"
        description={`Diese Aktion ist irreversibel. ${selectedIds.length} Mitarbeiter werden deaktiviert und personenbezogene Daten entfernt. Tippen Sie LÖSCHEN zur Bestätigung.`}
        confirmWord="LÖSCHEN"
        confirmLabel="Löschen"
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={confirmBulkDelete}
      />
    </>
  );
}
