'use client';

import { logger } from '@/lib/logging';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  LinearProgress,
} from '@mui/material';
import { UploadFile } from '@mui/icons-material';
import { staffCreateSchema, type StaffCreateInput, roleOptions } from '@/lib/validations/staff';

interface StaffImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (rows: StaffCreateInput[]) => Promise<void> | void;
}

type ParsedRow = Partial<StaffCreateInput> & { __rowNum__: number; __error__?: string };

export function StaffImportDialog({ open, onClose, onImport }: StaffImportDialogProps) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const { validRows, invalidRows } = useMemo(() => {
    const valids: StaffCreateInput[] = [];
    const invalids: ParsedRow[] = [];
    for (const row of rows) {
      const parsed = staffCreateSchema.safeParse({
        displayName: row.displayName ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        role: (row.role as StaffCreateInput['role']) ?? 'nurse',
        qualifications: (row.qualifications as string[]) ?? [],
        group: row.group ?? '',
        active: row.active ?? true,
      });
      if (parsed.success) {
        valids.push(parsed.data);
      } else {
        invalids.push({ ...row, __error__: parsed.error.issues[0]?.message || 'Ungültige Daten' });
      }
    }
    return { validRows: valids, invalidRows: invalids };
  }, [rows]);

  const handleFile = async (file: File) => {
    try {
      setFileName(file.name);
      const data = await file.arrayBuffer();
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(data);
      
      // Erste Worksheet verwenden
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('Keine Daten in der Excel-Datei gefunden');
      }
      
      // Header-Zeile finden (erste Zeile)
      const headerRow = worksheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(String(cell.value || '').toLowerCase().trim());
      });
      
      // Daten aus Zeilen extrahieren
      const json: Record<string, unknown>[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // Header überspringen
        
        const rowData: Record<string, unknown> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const headerName = headers[colNumber - 1] || '';
          rowData[headerName] = cell.value ?? '';
          // Zusätzlich auch mit Spaltenbuchstaben mappen (fallback)
          const columnLetter = cell.address.charAt(0);
          rowData[columnLetter] = cell.value ?? '';
        });
        json.push(rowData);
      });
      
      const parsed: ParsedRow[] = json.map((r, idx) => {
        const roleRaw = String((r as Record<string, unknown>).role || (r as Record<string, unknown>).rolle || (r as Record<string, unknown>).berufsbezeichnung || '').trim().toLowerCase();
        const roleMap: Record<string, typeof roleOptions[number]> = {
          nurse: 'nurse', krankenschwester: 'nurse', pflegekraft: 'nurse',
          admin: 'admin', administrator: 'admin',
        };
        const role = roleMap[roleRaw] || 'nurse';
        const quals = String((r as Record<string, unknown>).qualifications || (r as Record<string, unknown>).qualifikationen || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const active = String((r as Record<string, unknown>).active || (r as Record<string, unknown>).aktiv || 'true').toLowerCase() !== 'false';
        return {
          __rowNum__: idx + 2,
          displayName: String((r as Record<string, unknown>).displayname || (r as Record<string, unknown>).name || '').trim(),
          email: String((r as Record<string, unknown>).email || '').trim(),
          phone: String((r as Record<string, unknown>).phone || (r as Record<string, unknown>).telefon || '').trim(),
          role,
          qualifications: quals,
          group: String((r as Record<string, unknown>).group || (r as Record<string, unknown>).gruppe || '').trim(),
          active,
        };
      });
      setRows(parsed);
    } catch (error) {
      logger.error('Fehler beim Lesen der Excel-Datei:', error);
      setRows([]);
      setFileName('');
      alert('Fehler beim Lesen der Datei. Bitte überprüfen Sie, ob es sich um eine gültige Excel-Datei handelt.');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      await onImport(validRows);
      setRows([]);
      setFileName('');
      onClose();
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mitarbeiter importieren (CSV/Excel)</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <Button component="label" startIcon={<UploadFile />} variant="outlined">
            Datei auswählen
            <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" hidden onChange={handleChange} />
          </Button>
          {fileName && (
            <Typography variant="body2" color="text.secondary">{fileName}</Typography>
          )}
          {rows.length > 0 && (
            <>
              <Alert severity="info">
                {validRows.length} gültig, {invalidRows.length} ungültig. Spalten: displayName, email, phone, role, qualifications, group, active
              </Alert>
              {invalidRows.length > 0 && (
                <Typography variant="caption" color="error">Beispiel-Fehler in Zeile {invalidRows[0].__rowNum__}: {invalidRows[0].__error__}</Typography>
              )}
            </>
          )}
          {isImporting && <LinearProgress />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={isImporting}>Abbrechen</Button>
        <Button onClick={handleImport} disabled={isImporting || validRows.length === 0} variant="contained">
          {isImporting ? 'Importiere...' : `Importieren (${validRows.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default StaffImportDialog;


