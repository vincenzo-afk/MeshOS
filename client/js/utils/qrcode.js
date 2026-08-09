/**
 * MeshOS QR Code Helper
 * Thin wrapper around the vendored qrcode-generator library
 * (client/js/vendor/qrcode.mjs — MIT licensed, Kazuhiko Arase).
 */
import qrcodegen from '../vendor/qrcode.mjs';

/**
 * Renders a QR code as an <img> element (data URI) into the given container.
 * @param {HTMLElement} container
 * @param {string} text - data to encode (e.g. join URL)
 * @param {number} [size=180]
 */
export function renderQRCode(container, text, size = 180) {
  container.innerHTML = '';
  const qr = qrcodegen(0, 'M'); // type auto-detected via typeNumber=0
  qr.addData(text);
  qr.make();

  const cellCount = qr.getModuleCount();
  const cellSize = Math.max(2, Math.floor(size / cellCount));
  const canvas = document.createElement('canvas');
  const dim = cellSize * cellCount;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#0B0D17';
  for (let row = 0; row < cellCount; row++) {
    for (let col = 0; col < cellCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  container.appendChild(canvas);
  return canvas;
}