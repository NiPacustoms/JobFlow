'use client';

import { useAuth } from '@/contexts/AuthContext';
import { assignmentService, cloudFunctions, userService } from '@/lib/services';
import { Assignment, Shift, User } from '@/lib/types';
import { sendAssignmentFormEmail } from '@/lib/services/email';
import { toast } from '@/lib/utils/toast';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Add, AutoAwesome, Close, Person, Search, Warning } from '@mui/icons-material';
import { logger, PerformanceMonitor, UserActionTracker } from '@/lib/logging';

const ASSIGN_USER_TYPE = 'ASSIGN_USER';

interface DraggableUserRowProps {
  userId: string;
  children: React.ReactNode;
}
function DraggableUserRow({ userId, children }: DraggableUserRowProps) {
  const [{ isDragging }, dragRef] = useDrag({
    type: ASSIGN_USER_TYPE,
    item: { userId },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });
  return (
    <div ref={dragRef as unknown as React.Ref<HTMLDivElement>} style={{ opacity: isDragging ? 0.5 : 1 }}>
      {children}
    </div>
  );
}

interface AssignedDropZoneProps {
  onDrop: (userId: string) => void;
  disabled: boolean;
  children: React.ReactNode;
}
function AssignedDropZone({ onDrop, disabled, children }: AssignedDropZoneProps) {
  const [{ isOver }, dropRef] = useDrop({
    accept: ASSIGN_USER_TYPE,
    drop: (item: { userId: string }) => {
      if (!disabled) onDrop(item.userId);
    },
    collect: (monitor) => ({ isOver: monitor.isOver() }),
  });
  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      style={{
        minHeight: 120,
        borderRadius: 8,
        border: '2px dashed',
        borderColor: isOver && !disabled ? 'var(--mui-palette-primary-main)' : 'var(--mui-palette-divider)',
        backgroundColor: isOver && !disabled ? 'var(--mui-palette-action-hover)' : 'transparent',
        transition: 'background-color 0.2s, border-color 0.2s',
      }}
    >
      {children}
    </div>
  );
}

interface AssignShiftDialogProps {
  open: boolean;
  onClose: () => void;
  shift: Shift;
}

type AssignedUserEntry = {
  assignment: Assignment;
  user: User;
};

export function AssignShiftDialog({ open, onClose, shift }: AssignShiftDialogProps) {
  const { user: _user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  // Load assigned users inkl. Assignment-Infos
  const { data: assignedUsers = [], isLoading: assignedUsersLoading } = useQuery<
    AssignedUserEntry[]
  >({
    queryKey: ['assignedUsers', shift.id],
    queryFn: async () => {
      const assignments = await assignmentService.getByShiftId(shift.id);
      const activeAssignments = assignments.filter(assignment =>
        ['assigned', 'accepted', 'requested'].includes(assignment.status)
      );
      if (activeAssignments.length === 0) {
        return [];
      }

      const users = await Promise.all(
        activeAssignments.map(assignment => userService.getById(assignment.userId))
      );

      return activeAssignments
        .map((assignment, index) => {
          const user = users[index];
          if (!user) {
            return null;
          }
          return { assignment, user };
        })
        .filter((entry): entry is AssignedUserEntry => Boolean(entry?.user));
    },
  });

  // Load available users
  const { data: availableUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['availableUsers', shift.id, searchTerm, roleFilter],
    queryFn: async () => {
      const filters = {
        search: searchTerm || undefined,
        role: roleFilter === 'all' ? undefined : (roleFilter as User['role']),
        excludeAssigned: true,
        shiftId: shift.id,
      };
      return await userService.getAvailableForShift(filters);
    },
  });

  // Batch-Konfliktprüfung für alle angezeigten verfügbaren User (Konflikt-Highlighting)
  const userIdsStable = useMemo(
    () => availableUsers.map(u => u.id).sort().join(','),
    [availableUsers]
  );
  const { data: conflictMap = {} } = useQuery({
    queryKey: ['checkConflicts', shift.id, userIdsStable],
    queryFn: () =>
      assignmentService.checkConflictsForShift(
        shift.id,
        availableUsers.map(u => u.id)
      ),
    enabled: open && availableUsers.length > 0,
    staleTime: 60 * 1000,
  });

  // Assign user mutation via Cloud Function
  const assignUserMutation = useMutation({
    mutationFn: async (user: User) => {
      // Admins können Konflikte überschreiben
      const result = await cloudFunctions.assignShiftToUser(shift.id, user.id, false, true);
      return { result, user };
    },
    retry: 2,
    retryDelay: attempt => Math.min(1000 * Math.pow(2, attempt), 5000),
    onSuccess: ({ result, user }) => {
      if (process.env.NODE_ENV === 'development') {
        PerformanceMonitor.endTimer('shift.assign', { result: 'success' });
      }
      logger.info('User assigned to shift', { shiftId: shift.id } as Record<string, unknown>);
      queryClient.invalidateQueries({ queryKey: ['assignedUsers', shift.id] });
      queryClient.invalidateQueries({ queryKey: ['availableUsers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(result.message || 'Mitarbeiter zugewiesen');
      const assignmentId = result.assignmentId;
      const formLink = assignmentId ? `/employee/formulare/einsaetze/${assignmentId}` : null;
      const shiftInfo = `${format(shift.date, 'dd.MM.yyyy', { locale: de })} • ${shift.startTime} - ${shift.endTime}`;
      const fullFormLink =
        formLink && typeof window !== 'undefined'
          ? new URL(formLink, window.location.origin).toString()
          : (formLink ?? undefined);

      if (user.email && formLink) {
        void sendAssignmentFormEmail({
          to: user.email,
          employeeName: user.displayName,
          formLink: fullFormLink ?? formLink ?? '',
          shiftInfo,
        });
      }
    },
    onError: (error: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        PerformanceMonitor.endTimer('shift.assign', { result: 'error' });
      }
      const err = error instanceof Error ? error : new Error('Unknown error');
      logger.error('Assign user failed', err, { shiftId: shift.id } as Record<string, unknown>);
      const message = err.message || 'Unbekannter Fehler';
      toast.error('Fehler beim Zuweisen: ' + message);
    },
  });

  // Unassign user mutation via Cloud Function
  const unassignUserMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await cloudFunctions.unassignUser(assignmentId, 'Zuweisung durch Admin entfernt');
    },
    retry: 2,
    retryDelay: attempt => Math.min(1000 * Math.pow(2, attempt), 5000),
    onSuccess: result => {
      if (process.env.NODE_ENV === 'development') {
        PerformanceMonitor.endTimer('shift.unassign', { result: 'success' });
      }
      logger.info('User unassigned from shift', { shiftId: shift.id } as Record<string, unknown>);
      queryClient.invalidateQueries({ queryKey: ['assignedUsers', shift.id] });
      queryClient.invalidateQueries({ queryKey: ['availableUsers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(result?.message || 'Zuweisung erfolgreich entfernt');
    },
    onError: (error: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        PerformanceMonitor.endTimer('shift.unassign', { result: 'error' });
      }
      const err = error instanceof Error ? error : new Error('Unknown error');
      logger.error('Unassign user failed', err, { shiftId: shift.id } as Record<string, unknown>);
      const message = err.message || 'Unbekannter Fehler';
      toast.error('Fehler beim Entfernen der Zuweisung: ' + message);
    },
  });

  const handleAssignUser = (userId: string) => {
    if (process.env.NODE_ENV === 'development') {
      PerformanceMonitor.startTimer('shift.assign');
      UserActionTracker.trackAction('shift_assign_click', { userId, shiftId: shift.id });
    }
    const userObj = availableUsers.find(u => u?.id === userId) as User | undefined;
    if (!userObj) {
      toast.error('Mitarbeiter nicht gefunden');
      return;
    }
    assignUserMutation.mutate(userObj);
  };

  // Matching-Vorschläge der Cloud Function (Qualifikation, Konflikte, Score).
  // Bereits dieser Schicht zugewiesene Mitarbeiter werden ausgeblendet
  // (sonst wäre eine Doppel-Zuweisung per Chip-Klick möglich).
  const { data: candidateSuggestionsRaw = [] } = useQuery({
    queryKey: ['assignCandidates', shift.id],
    queryFn: async () => {
      const result = await cloudFunctions.findAvailableCandidates(shift.id, { limit: 8 });
      return result.candidates || [];
    },
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const candidateSuggestions = useMemo(() => {
    const assignedIds = new Set(assignedUsers.map(a => a.user.id));
    return candidateSuggestionsRaw.filter(c => !assignedIds.has(c.userId)).slice(0, 5);
  }, [candidateSuggestionsRaw, assignedUsers]);

  /** Vorschlag zuweisen – Kandidat kann außerhalb der aktuellen Suchliste liegen. */
  const handleAssignCandidate = async (userId: string) => {
    const inList = availableUsers.find(u => u?.id === userId) as User | undefined;
    if (inList) {
      assignUserMutation.mutate(inList);
      return;
    }
    try {
      const userObj = await userService.getById(userId);
      if (!userObj) {
        toast.error('Mitarbeiter nicht gefunden');
        return;
      }
      assignUserMutation.mutate(userObj as User);
    } catch {
      toast.error('Mitarbeiter konnte nicht geladen werden');
    }
  };

  const handleUnassignUser = (userId: string) => {
    if (process.env.NODE_ENV === 'development') {
      PerformanceMonitor.startTimer('shift.unassign');
      UserActionTracker.trackAction('shift_unassign_click', { userId, shiftId: shift.id });
    }
    const entry = assignedUsers.find(assigned => assigned.user.id === userId);
    if (!entry) {
      toast.error('Keine aktive Zuweisung gefunden');
      return;
    }
    unassignUserMutation.mutate(entry.assignment.id);
  };

  const handleBulkAssign = () => {
    selectedUsers.forEach(userId => {
      const userObj = availableUsers.find(u => u?.id === userId);
      if (userObj) {
        assignUserMutation.mutate(userObj);
      }
    });
    setSelectedUsers([]);
  };

  const handleUserSelect = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleClose = () => {
    setSearchTerm('');
    setRoleFilter('all');
    setSelectedUsers([]);
    onClose();
  };

  const availableSlots = useMemo(
    () => Math.max(0, shift.capacity - assignedUsers.length),
    [shift.capacity, assignedUsers.length]
  );
  const isFullyAssigned = availableSlots <= 0;
  const isOverAssigned = assignedUsers.length > shift.capacity;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3 },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: '20px', py: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '20px' }}>
              Schicht zuweisen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '14px', mt: 0.5 }}>
              {format(shift.date, 'dd.MM.yyyy', { locale: de })} • {shift.startTime} -{' '}
              {shift.endTime}
            </Typography>
          </Box>
          <Button
            onClick={handleClose}
            aria-label="Dialog schließen"
            size="small"
            startIcon={<Close />}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: 2,
            }}
          >
            Schließen
          </Button>
        </Box>
      </DialogTitle>

      <DialogContent>
        <DndProvider backend={HTML5Backend}>
        {/* Shift Info */}
        <Alert
          severity="info"
          sx={{
            mb: 3,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'info.main',
          }}
        >
          <Typography variant="body2" sx={{ fontSize: '14px', lineHeight: 1.6 }}>
            <strong>Kapazität:</strong> {assignedUsers.length}/{shift.capacity} Mitarbeiter
            {availableSlots > 0 && ` • ${availableSlots} Plätze frei`}
            {isFullyAssigned && !isOverAssigned && ' • Voll besetzt'}
            {isOverAssigned && ' • Überbelegt!'}
          </Typography>
        </Alert>

        {isOverAssigned && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Überbelegung:</strong> Mehr Mitarbeiter zugewiesen als Kapazität erlaubt.
            </Typography>
          </Alert>
        )}

        <Grid container spacing={3}>
          {/* Assigned Users (Drop-Zone für Drag & Drop) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <AssignedDropZone
              onDrop={handleAssignUser}
              disabled={isFullyAssigned || assignedUsersLoading}
            >
              <Typography variant="h6" sx={{ mb: 2 }}>
                Zugewiesene Mitarbeiter ({assignedUsers.length})
              </Typography>
              {assignedUsersLoading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    Lädt Zuweisungen...
                  </Typography>
                </Box>
              ) : assignedUsers.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Person sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    Keine Mitarbeiter zugewiesen – hierher ziehen zum Zuweisen
                  </Typography>
                </Box>
              ) : (
                <List>
                  {assignedUsers.map(({ assignment, user }) => (
                    <ListItem key={assignment.id} sx={{ px: 0 }}>
                      <ListItemAvatar>
                        <Avatar>{user.displayName.charAt(0).toUpperCase()}</Avatar>
                      </ListItemAvatar>
                      <ListItemText primary={user.displayName} secondary={user.email} />
                      <Button
                        size="small"
                        color="error"
                        onClick={() => handleUnassignUser(user.id)}
                        disabled={unassignUserMutation.isPending}
                      >
                        Entfernen
                      </Button>
                    </ListItem>
                  ))}
                </List>
              )}
            </AssignedDropZone>
          </Grid>

          {/* Available Users */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Verfügbare Mitarbeiter
            </Typography>

            {/* Matching-Vorschläge (Cloud Function: Qualifikation, Konflikte, Score) */}
            {candidateSuggestions.length > 0 && (
              <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                  <AutoAwesome fontSize="small" color="primary" />
                  <Typography variant="subtitle2">Vorschläge</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {candidateSuggestions.map(candidate => (
                    <Tooltip
                      key={candidate.userId}
                      title={
                        candidate.hasConflict
                          ? candidate.conflictDetails || 'Zeitkonflikt vorhanden'
                          : `Score ${Math.round(candidate.score)} · ${candidate.qualifications?.join(', ') || 'keine Qualifikationen hinterlegt'}`
                      }
                    >
                      <Chip
                        label={`${candidate.displayName} (${Math.round(candidate.score)})`}
                        color={candidate.hasConflict ? 'warning' : 'primary'}
                        variant="outlined"
                        icon={candidate.hasConflict ? <Warning /> : <Add />}
                        onClick={() => void handleAssignCandidate(candidate.userId)}
                        disabled={assignUserMutation.isPending}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            )}

            {/* Search and Filter */}
            <Box sx={{ mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Mitarbeiter suchen..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
                sx={{ mb: 2 }}
              />

              <FormControl fullWidth size="small">
                <InputLabel>Rolle</InputLabel>
                <Select
                  value={roleFilter}
                  label="Rolle"
                  onChange={e => setRoleFilter(e.target.value)}
                >
                  <MenuItem value="all">Alle</MenuItem>
                  <MenuItem value="nurse">Krankenschwester</MenuItem>
                  <MenuItem value="admin">Administrator</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {/* Bulk Actions */}
            {selectedUsers.length > 0 && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {selectedUsers.length} Mitarbeiter ausgewählt
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleBulkAssign}
                  disabled={assignUserMutation.isPending || isFullyAssigned}
                >
                  Alle zuweisen
                </Button>
              </Box>
            )}

            {/* Available Users List */}
            {usersLoading ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  Lade verfügbare Mitarbeiter...
                </Typography>
              </Box>
            ) : availableUsers.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Person sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Keine verfügbaren Mitarbeiter gefunden
                </Typography>
              </Box>
            ) : (
              <List>
                {availableUsers.map(user => {
                  const conflict = conflictMap[user.id];
                  const hasConflict = conflict?.hasConflict ?? false;
                  return (
                    <DraggableUserRow key={user.id} userId={user.id}>
                    <ListItem
                      key={user.id}
                      sx={{
                        px: 0,
                        ...(hasConflict && {
                          borderLeft: 3,
                          borderColor: 'warning.main',
                          bgcolor: 'rgba(237, 108, 2, 0.12)',
                          borderRadius: 1,
                          mb: 1,
                          '&:last-of-type': { mb: 0 },
                        }),
                      }}
                    >
                      <ListItemButton
                        onClick={() => handleUserSelect(user.id)}
                        selected={selectedUsers.includes(user.id)}
                        sx={{ py: 1.5 }}
                      >
                        <ListItemAvatar>
                          <Avatar>{user.displayName.charAt(0).toUpperCase()}</Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {user.displayName}
                              {hasConflict && (
                                <Tooltip title={conflict.conflictDetails ?? 'Zeitkonflikt'}>
                                  <Warning color="warning" fontSize="small" aria-label="Zeitkonflikt" />
                                </Tooltip>
                              )}
                            </Box>
                          }
                          secondary={
                            <Box>
                              <Typography variant="body2" color="text.secondary">
                                {user.email}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                                {hasConflict && (
                                  <Chip
                                    label="Zeitkonflikt"
                                    size="small"
                                    color="warning"
                                    variant="filled"
                                  />
                                )}
                                <Chip
                                  label={
                                    user.role === 'nurse'
                                      ? 'Krankenschwester'
                                      : 'Administrator'
                                  }
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                                {user.qualifications?.map(qual => (
                                  <Chip key={qual} label={qual} size="small" variant="outlined" />
                                ))}
                              </Box>
                            </Box>
                          }
                          secondaryTypographyProps={{ component: 'div' }}
                        />
                      </ListItemButton>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Add />}
                        onClick={() => handleAssignUser(user.id)}
                        disabled={assignUserMutation.isPending || isFullyAssigned}
                        color={hasConflict ? 'warning' : 'primary'}
                      >
                        Zuweisen
                      </Button>
                    </ListItem>
                    </DraggableUserRow>
                  );
                })}
              </List>
            )}
          </Grid>
        </Grid>
        </DndProvider>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 2 }}>
        <Button
          onClick={handleClose}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 2,
            px: 3,
          }}
        >
          Schließen
        </Button>
      </DialogActions>
    </Dialog>
  );
}
