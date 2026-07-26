/**
 * Konvertiert eine Data-URL (z. B. canvas.toDataURL()) in einen Blob.
 * Ohne fetch(), damit CSP connect-src keine data:-URLs erlauben muss.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  // Leerer Treffer ('data:;base64,…') muss ebenfalls auf image/png fallen –
  // ein Blob ohne contentType wird von den Storage-Rules abgelehnt.
  const mime = mimeMatch?.[1] || 'image/png';
  const bstr = atob(arr[1] ?? '');
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}
