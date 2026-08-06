'use client';

import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { logger } from '@/lib/logging';

export interface ExportOptions {
  filename?: string;
  includeHeaders?: boolean;
  dateFormat?: string;
  delimiter?: string;
}

export type ExportData = Record<string, unknown>;

export class ExportService {
  // CSV Export
  static async exportToCSV(
    data: ExportData[],
    options: ExportOptions = {}
  ): Promise<string> {
    const {
      filename = `export-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}.csv`,
      includeHeaders = true,
      delimiter = ',',
    } = options;

    if (data.length === 0) {
      throw new Error('Keine Daten zum Exportieren vorhanden');
    }

    const headers = Object.keys(data[0]);
    let csvContent = '';

    // Add headers
    if (includeHeaders) {
      csvContent += headers.map(header => `"${header}"`).join(delimiter) + '\n';
    }

    // Add data rows
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return `"${JSON.stringify(value)}"`;
        if (typeof value === 'string' && value.includes(delimiter)) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return `"${String(value)}"`;
      });
      csvContent += values.join(delimiter) + '\n';
    });

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return filename;
  }

  // Excel Export (using HTML table format)
  static async exportToExcel(
    data: ExportData[],
    options: ExportOptions = {}
  ): Promise<string> {
    const {
      filename = `export-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}.xls`,
      includeHeaders = true,
    } = options;

    if (data.length === 0) {
      throw new Error('Keine Daten zum Exportieren vorhanden');
    }

    const headers = Object.keys(data[0]);
    
    let htmlContent = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <meta name="ExcelCreated" content="true">
          <style>
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .number { text-align: right; }
            .date { text-align: center; }
          </style>
        </head>
        <body>
          <table>
    `;

    // Add headers
    if (includeHeaders) {
      htmlContent += '<tr>';
      headers.forEach(header => {
        htmlContent += `<th>${this.escapeHtml(header)}</th>`;
      });
      htmlContent += '</tr>';
    }

    // Add data rows
    data.forEach(row => {
      htmlContent += '<tr>';
      headers.forEach(header => {
        const value = row[header];
        const cellClass = this.getCellClass(value);
        htmlContent += `<td class="${cellClass}">${this.escapeHtml(this.formatCellValue(value))}</td>`;
      });
      htmlContent += '</tr>';
    });

    htmlContent += `
          </table>
        </body>
      </html>
    `;

    // Create and download file
    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return filename;
  }

  // PDF Export (using HTML format)
  static async exportToPDF(
    data: ExportData[],
    title: string,
    options: ExportOptions = {}
  ): Promise<string> {
    const {
      filename = `${title}-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}.html`,
      includeHeaders = true,
    } = options;

    if (data.length === 0) {
      throw new Error('Keine Daten zum Exportieren vorhanden');
    }

    const headers = Object.keys(data[0]);
    
    let htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${ExportService.escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .number { text-align: right; }
            .date { text-align: center; }
            .footer { margin-top: 40px; font-size: 12px; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${ExportService.escapeHtml(title)}</h1>
            <p>Erstellt am: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}</p>
          </div>
          
          <table>
    `;

    // Add headers
    if (includeHeaders) {
      htmlContent += '<thead><tr>';
      headers.forEach(header => {
        htmlContent += `<th>${this.escapeHtml(header)}</th>`;
      });
      htmlContent += '</tr></thead>';
    }

    // Add data rows
    htmlContent += '<tbody>';
    data.forEach(row => {
      htmlContent += '<tr>';
      headers.forEach(header => {
        const value = row[header];
        const cellClass = this.getCellClass(value);
        htmlContent += `<td class="${cellClass}">${this.escapeHtml(this.formatCellValue(value))}</td>`;
      });
      htmlContent += '</tr>';
    });
    htmlContent += '</tbody>';

    htmlContent += `
          </table>
          
          <div class="footer">
            <p>Gesamt: ${data.length} Einträge</p>
            <p>Erstellt mit Schichtklar System</p>
          </div>
        </body>
      </html>
    `;

    // Create and download file
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return filename;
  }

  // Helper methods
  private static getCellClass(value: unknown): string {
    if (typeof value === 'number') return 'number';
    if (value instanceof Date) return 'date';
    return '';
  }

  /**
   * HTML-Escaping für die HTML-basierten Exporte (Excel/PDF).
   * Ohne diese Behandlung landen Firestore-Werte – etwa ein
   * Einrichtungsname mit Markup – ungefiltert in der Datei und werden beim
   * Öffnen im Browser ausgeführt.
   */
  private static escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private static formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      return format(value, 'dd.MM.yyyy HH:mm', { locale: de });
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  // Bulk export with progress tracking
  static async bulkExport(
    dataSets: { name: string; data: ExportData[]; title: string }[],
    format: 'csv' | 'excel' | 'pdf' = 'csv'
  ): Promise<string[]> {
    const results: string[] = [];
    
    for (let i = 0; i < dataSets.length; i++) {
      const { name, data, title } = dataSets[i];
      
      try {
        let filename: string;
        
        switch (format) {
          case 'csv':
            filename = await this.exportToCSV(data, { filename: `${name}.csv` });
            break;
          case 'excel':
            filename = await this.exportToExcel(data, { filename: `${name}.xls` });
            break;
          case 'pdf':
            filename = await this.exportToPDF(data, title, { filename: `${name}.html` });
            break;
          default:
            throw new Error(`Unsupported format: ${format}`);
        }
        
        results.push(filename);
      } catch (error) {
        logger.error(`Error exporting ${name}`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }
    
    return results;
  }
}
