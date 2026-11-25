/**
 * Saves a chart (an SVG, as Recharts draws it) as a PNG image: the chart on a
 * white background with its title and a line of detail above it, at twice the
 * screen's resolution so it stays sharp in a document or a slide. White
 * whichever theme is on, so the image reads the same wherever it is pasted.
 */
export async function downloadChartPng(
  svg: SVGSVGElement,
  options: { title: string; subtitle?: string; filename: string },
): Promise<void> {
  const box = svg.getBoundingClientRect();
  const width = Math.round(box.width);
  const height = Math.round(box.height);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // Text in the chart takes its font from the page's CSS, which an image
  // doesn't carry: name it on the SVG itself.
  clone.style.fontFamily = "Inter, 'Segoe UI', system-ui, sans-serif";

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await image.decode();

  const scale = 2;
  const pad = 24;
  const head = options.subtitle ? 66 : 46;
  const canvas = document.createElement('canvas');
  canvas.width = (width + pad * 2) * scale;
  canvas.height = (height + head + pad) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width + pad * 2, height + head + pad);
  ctx.fillStyle = '#0f172a';
  ctx.font = "600 18px Inter, 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(options.title, pad, pad + 16);
  if (options.subtitle) {
    ctx.fillStyle = '#6b7a90';
    ctx.font = "13px Inter, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(options.subtitle, pad, pad + 38);
  }
  ctx.drawImage(image, pad, head, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be made.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${options.filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'chart'}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
