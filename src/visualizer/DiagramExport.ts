/**
 * Exports the pitch diagram as PNG or PDF, drawn by the same renderer with the same settings
 * as on screen (tracks, takes, harmony, bar lines, mistake highlights, theme), plus a header
 * with the song, date, settings and a colour legend.
 */

import { NoteGridRenderer, RendererOptions, MicTake, NOTE_AXIS_WIDTH } from './NoteGridRenderer';
import { AudioTrackState } from '../audio/MultiTrackMixer';

export interface ExportScene {
  tracks: AudioTrackState[];
  takes: MicTake[];
  options: RendererOptions;
  /** Size of the diagram on screen, CSS pixels */
  width: number;
  height: number;
  /** Song length, seconds (for whole-song export) */
  duration: number;
  title: string;
  /** Settings shown under the title */
  details: string[];
  legend: { color: string; label: string }[];
}

export type ExportRange = 'view' | 'song';
export type ExportFormat = 'png' | 'pdf';

const HEADER_HEIGHT = 58;
const MAX_CANVAS_PX = 16000; // stay well inside browser canvas limits

/** Renders one diagram image (header + diagram) for a time window. */
function renderImage(scene: ExportScene, timeOffset: number, visibleDuration: number, width: number, scale: number, page?: string) {
  const height = scene.height + HEADER_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const theme = scene.options.theme;

  // Header
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = theme.bgPanel;
  ctx.fillRect(0, 0, width, HEADER_HEIGHT);
  ctx.fillStyle = theme.border;
  ctx.fillRect(0, HEADER_HEIGHT - 1, width, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.gridTextOctave;
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.fillText(scene.title, 14, 22);
  ctx.fillStyle = theme.gridText;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillText(scene.details.join('  ·  '), 14, 42);

  // Legend (right-aligned)
  ctx.textAlign = 'right';
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  let x = width - 14;
  if (page) {
    ctx.fillStyle = theme.gridText;
    ctx.fillText(page, x, 42);
  }
  for (const item of [...scene.legend].reverse()) {
    const color = NoteGridRenderer.readable(item.color, theme.bgPanel);
    ctx.fillStyle = color;
    ctx.fillText(item.label, x, 22);
    x -= ctx.measureText(item.label).width + 6;
    ctx.fillRect(x - 12, 15, 12, 4);
    x -= 24;
  }

  // Diagram: an offscreen canvas drawn by the screen renderer, then copied below the header
  const plot = document.createElement('canvas');
  plot.width = canvas.width;
  plot.height = Math.round(scene.height * scale);
  const renderer = new NoteGridRenderer(plot);
  plot.getContext('2d')!.setTransform(scale, 0, 0, scale, 0, 0);
  renderer.render(scene.tracks, scene.takes, { ...scene.options, timeOffset, visibleDuration }, width, scene.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(plot, 0, Math.round(HEADER_HEIGHT * scale));
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality));

/** Builds a PDF with one JPEG image per page, each fitted to an A4 page. */
async function buildPdf(images: HTMLCanvasElement[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObj = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds = images.map((_, i) => 3 + i * 3);

  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${images.length} >>\nendobj\n`);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const jpeg = new Uint8Array(await (await toBlob(img, 'image/jpeg', 0.92)).arrayBuffer());
    const landscape = img.width >= img.height;
    const pw = landscape ? 842 : 595;
    const ph = landscape ? 595 : 842;
    const margin = 24;
    const fit = Math.min((pw - 2 * margin) / img.width, (ph - 2 * margin) / img.height);
    const w = img.width * fit;
    const h = img.height * fit;
    const x = (pw - w) / 2;
    const y = ph - margin - h; // top-aligned
    const [pageId, contentId, imageId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

    startObj(pageId);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
    startObj(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObj(imageId);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\nendobj\n');
  }

  const xref = length;
  const count = 3 + images.length * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/** Creates the export file. */
export async function exportDiagram(scene: ExportScene, format: ExportFormat, range: ExportRange): Promise<File> {
  const o = scene.options;
  const plotWidth = Math.max(1, scene.width - NOTE_AXIS_WIDTH);
  const stamp = new Date();
  const name = `choiropractics-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const song = range === 'song' && scene.duration > 0;

  if (format === 'png') {
    let canvas: HTMLCanvasElement;
    if (song) {
      // One long image at the on-screen zoom level (reduced if the song would be too wide)
      let pxPerSecond = plotWidth / Math.max(0.01, o.visibleDuration);
      pxPerSecond = Math.min(pxPerSecond, (MAX_CANVAS_PX - NOTE_AXIS_WIDTH) / scene.duration);
      const width = Math.round(NOTE_AXIS_WIDTH + pxPerSecond * scene.duration);
      const scale = Math.max(1, Math.min(2, MAX_CANVAS_PX / width));
      canvas = renderImage(scene, 0, scene.duration, width, scale);
    } else {
      canvas = renderImage(scene, o.timeOffset, o.visibleDuration, scene.width, 2);
    }
    return new File([await toBlob(canvas, 'image/png')], `${name}.png`, { type: 'image/png' });
  }

  // PDF: the current view, or the song page by page at the on-screen zoom level
  const images: HTMLCanvasElement[] = [];
  if (song) {
    const pages = Math.max(1, Math.ceil(scene.duration / o.visibleDuration - 0.02));
    for (let p = 0; p < pages; p++) {
      images.push(renderImage(scene, p * o.visibleDuration, o.visibleDuration, scene.width, 2, `Page ${p + 1} / ${pages}`));
    }
  } else {
    images.push(renderImage(scene, o.timeOffset, o.visibleDuration, scene.width, 2));
  }
  return new File([await buildPdf(images)], `${name}.pdf`, { type: 'application/pdf' });
}

/** Saves the file: share sheet on phones (when available), download otherwise. */
export async function saveFile(file: File, preferShare: boolean) {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (preferShare && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Sharing failed: fall back to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
