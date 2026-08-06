'use client';

import { logger } from '@/lib/logging';

import { PageContainer } from '@/components/layout/PageContainer';
import { useAdminReports } from '@/lib/hooks/useAdminReports';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { facilityService } from '@/lib/services/facilities';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { toast } from '@/lib/utils/toast';
import Link from 'next/link';
import {
  Assessment,
  Download,
  Refresh,
  Schedule,
  Work,
  BarChart,
} from '@mui/icons-material';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Paper,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Avatar,
  Divider,
  CircularProgress,
} from '@mui/material';
import { useState } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { de } from 'date-fns/locale';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from 'recharts';

export default function AdminBerichtePage() {
  const { user } = useAuth();

  // Echte Einrichtungen der eigenen Firma für den Filter laden
  const { data: facilityOptions = [] } = useQuery({
    queryKey: ['facilities', user?.companyId],
    queryFn: () => facilityService.getAll(user?.companyId),
    enabled: !!user?.companyId,
  });

  const [filters, setFilters] = useState({
    startDate: undefined as Date | undefined,
    endDate: undefined as Date | undefined,
    facilityId: undefined as string | undefined,
    userId: undefined as string | undefined,
  });
  const [activeTab, setActiveTab] = useState(0);
  const [reportType, setReportType] = useState<'time' | 'employee' | 'all'>('all');
  const [isExporting, setIsExporting] = useState(false);

  const {
    timeAccountReport,
    employeeStatistics,
    isLoading,
    error,
    formatHours,
    getTrendIcon,
    getTrendText,
    exportTimeAccountReport,
    exportEmployeeStatistics,
    exportAllReports,
    refetch,
  } = useAdminReports(filters);

  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    setIsExporting(true);
    try {
      switch (reportType) {
        case 'time':
          await exportTimeAccountReport(format);
          break;
        case 'employee':
          await exportEmployeeStatistics(format);
          break;
        case 'all':
          await exportAllReports(format);
          break;
      }
      toast.success(`${format.toUpperCase()}-Export erfolgreich`);
    } catch (error) {
      toast.error('Export fehlgeschlagen');
      logger.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const _getReportTitle = () => {
    switch (reportType) {
      case 'time':
        return 'Zeitkonten-Bericht';
      case 'employee':
        return 'Mitarbeiter-Statistiken';
      case 'all':
        return 'Alle Berichte';
      default:
        return 'Zeitkonten-Bericht';
    }
  };

  if (isLoading) {
    return <LoadingSpinner variant="skeleton" message="Berichte werden geladen..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  if (!user) {
    return (
      <PageContainer maxWidth="wide">
        <Alert severity="error">Bitte melde dich an, um Berichte zu sehen.</Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="wide">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Typography
            component="h1"
            sx={{ fontSize: { xs: 28, sm: 32 }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.08 }}
          >
            Berichte
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              component={Link}
              href="/admin/berichte/geplante-berichte"
              variant="outlined"
              startIcon={<Schedule />}
              size="small"
            >
              Geplante Berichte
            </Button>
            <Button
              variant="outlined"
              startIcon={<Download />}
              onClick={() => handleExport('pdf')}
              size="small"
              disabled={isExporting}
            >
              {isExporting ? <CircularProgress size={16} /> : 'PDF'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<Download />}
              onClick={() => handleExport('excel')}
              size="small"
              disabled={isExporting}
            >
              {isExporting ? <CircularProgress size={16} /> : 'Excel'}
            </Button>
            <IconButton onClick={() => refetch()} aria-label="Aktualisieren">
              <Refresh />
            </IconButton>
          </Box>
        </Box>

        {/* Filter */}
        <Paper className="glass" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Filter
          </Typography>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
                <DatePicker
                  label="Von Datum"
                  value={filters.startDate || null}
                  onChange={date => handleFilterChange({ startDate: date || undefined })}
                  slotProps={{
                    textField: { fullWidth: true, size: 'small' },
                  }}
                />
              </LocalizationProvider>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
                <DatePicker
                  label="Bis Datum"
                  value={filters.endDate || null}
                  onChange={date => handleFilterChange({ endDate: date || undefined })}
                  slotProps={{
                    textField: { fullWidth: true, size: 'small' },
                  }}
                />
              </LocalizationProvider>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Berichtstyp</InputLabel>
                <Select
                  value={reportType}
                  label="Berichtstyp"
                  onChange={e => setReportType((e.target.value || 'all') as 'time' | 'employee' | 'all')}
                >
                  <MenuItem value="time">Zeitkonten</MenuItem>
                  <MenuItem value="employee">Mitarbeiter</MenuItem>
                  <MenuItem value="all">Alle</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Einrichtung</InputLabel>
                <Select
                  value={filters.facilityId || ''}
                  label="Einrichtung"
                  onChange={e => handleFilterChange({ facilityId: e.target.value || undefined })}
                >
                  <MenuItem value="">Alle</MenuItem>
                  {facilityOptions.map((f) => (
                    <MenuItem key={f.id} value={f.id}>
                      {f.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        {/* Tabs */}
        <Paper className="glass" sx={{ mb: 3 }}>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
            <Tab label="Übersicht" icon={<Assessment />} iconPosition="start" />
            <Tab label="Diagramme" icon={<BarChart />} iconPosition="start" />
            <Tab label="Details" icon={<Work />} iconPosition="start" />
          </Tabs>
        </Paper>

        {/* Übersicht Tab */}
        {activeTab === 0 && (
          <Grid container spacing={3}>
            {/* Zeitkonten-Statistiken */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Zeitkonten-Übersicht
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Gesamtstunden</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatHours(timeAccountReport?.totalHours ?? 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={100}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Reguläre Stunden</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatHours(timeAccountReport?.regularHours ?? 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        (timeAccountReport?.totalHours ?? 0) > 0
                          ? ((timeAccountReport?.regularHours ?? 0) / (timeAccountReport?.totalHours ?? 1)) * 100
                          : 0
                      }
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Überstunden</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatHours(timeAccountReport?.overtimeHours ?? 0)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        (timeAccountReport?.totalHours ?? 0) > 0
                          ? ((timeAccountReport?.overtimeHours ?? 0) / (timeAccountReport?.totalHours ?? 1)) * 100
                          : 0
                      }
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">Durchschnitt pro Tag</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatHours(timeAccountReport?.averageHoursPerDay ?? 0)}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Arbeitstage</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {timeAccountReport?.workingDays ?? 0}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Mitarbeiter-Statistiken */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Mitarbeiter-Übersicht
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Gesamtmitarbeiter</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {employeeStatistics?.totalEmployees ?? 0}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={100}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Aktive Mitarbeiter</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {employeeStatistics?.activeEmployees ?? 0}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={
                        (employeeStatistics?.totalEmployees ?? 0) > 0
                          ? ((employeeStatistics?.activeEmployees ?? 0) / (employeeStatistics?.totalEmployees ?? 1)) * 100
                          : 0
                      }
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2">Durchschnittliche Schichten</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {employeeStatistics?.averageShiftsPerEmployee ?? 0}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(
                        100,
                        ((employeeStatistics?.averageShiftsPerEmployee ?? 0) / 20) * 100
                      )}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">Durchschnittliche Stunden</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatHours(employeeStatistics?.averageHoursPerEmployee ?? 0)}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Top Performer</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {employeeStatistics?.topPerformers ?? 0}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Trend-Analyse */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Trend-Analyse
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Avatar
                      sx={{
                        bgcolor:
                          timeAccountReport?.trend === 'up'
                            ? 'success.main'
                            : timeAccountReport?.trend === 'down'
                              ? 'error.main'
                              : 'info.main',
                      }}
                    >
                      {getTrendIcon(timeAccountReport?.trend ?? 'flat')}
                    </Avatar>
                    <Box>
                      <Typography variant="h6">
                        Arbeitszeit: {getTrendText(timeAccountReport?.trend ?? 'flat')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatHours(timeAccountReport?.averageHoursPerWeek ?? 0)} pro Woche
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar
                      sx={{
                        bgcolor:
                          employeeStatistics?.employeeTrend === 'up'
                            ? 'success.main'
                            : employeeStatistics?.employeeTrend === 'down'
                              ? 'error.main'
                              : 'info.main',
                      }}
                    >
                      {getTrendIcon(employeeStatistics?.employeeTrend ?? 'flat')}
                    </Avatar>
                    <Box>
                      <Typography variant="h6">
                        Mitarbeiter: {getTrendText(employeeStatistics?.employeeTrend ?? 'flat')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {employeeStatistics?.averageShiftsPerEmployee ?? 0} Schichten pro Mitarbeiter
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Charts Tab */}
        {activeTab === 1 && (
          <Grid container spacing={3}>
            {/* Arbeitszeit-Chart */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Arbeitszeit pro Tag
                  </Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart data={timeAccountReport?.hoursByDay}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="day"
                          tickFormatter={value =>
                            new Date(value).toLocaleDateString('de-DE', {
                              day: '2-digit',
                              month: '2-digit',
                            })
                          }
                        />
                        <YAxis />
                        <RechartsTooltip
                          formatter={(value, name) => [`${value}h`, name]}
                          labelFormatter={value => new Date(value).toLocaleDateString('de-DE')}
                        />
                        <Line
                          type="monotone"
                          dataKey="totalHours"
                          stroke="#005f73"
                          strokeWidth={2}
                          name="Gesamtstunden"
                        />
                        <Line
                          type="monotone"
                          dataKey="regularHours"
                          stroke="#047857"
                          strokeWidth={2}
                          name="Regulär"
                        />
                        <Line
                          type="monotone"
                          dataKey="overtimeHours"
                          stroke="#b45309"
                          strokeWidth={2}
                          name="Überstunden"
                        />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>


            {/* Mitarbeiter-Chart */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Mitarbeiter pro Einrichtung
                  </Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBarChart data={employeeStatistics?.employeesByFacility}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="facility"
                          tickFormatter={value =>
                            value.length > 10 ? value.substring(0, 10) + '...' : value
                          }
                        />
                        <YAxis />
                        <RechartsTooltip
                          formatter={(value, name) => [`${value}`, name]}
                          labelFormatter={value => value}
                        />
                        <Bar dataKey="count" fill="#0a9396" name="Mitarbeiter" />
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Verteilung-Chart */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Stunden-Verteilung
                  </Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={[
                            {
                              name: 'Regulär',
                              value: timeAccountReport?.regularHours,
                              color: '#047857',
                            },
                            {
                              name: 'Überstunden',
                              value: timeAccountReport?.overtimeHours,
                              color: '#b45309',
                            },
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#0a9396"
                          dataKey="value"
                        >
                          {[
                            {
                              name: 'Regulär',
                              value: timeAccountReport?.regularHours,
                              color: '#047857',
                            },
                            {
                              name: 'Überstunden',
                              value: timeAccountReport?.overtimeHours,
                              color: '#b45309',
                            },
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip formatter={value => [`${value}h`, 'Stunden']} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Details Tab */}
        {activeTab === 2 && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Detaillierte Berichte
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Mitarbeiter</TableCell>
                          <TableCell align="right">Gesamtstunden</TableCell>
                          <TableCell align="right">Regulär</TableCell>
                          <TableCell align="right">Überstunden</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {timeAccountReport?.employees.slice(0, 20).map(employee => (
                          <TableRow key={employee.userId}>
                            <TableCell>{employee.userName}</TableCell>
                            <TableCell align="right">{formatHours(employee.totalHours)}</TableCell>
                            <TableCell align="right">{formatHours(employee.regularHours)}</TableCell>
                            <TableCell align="right">{formatHours(employee.overtimeHours)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
    </PageContainer>
  );
}
