const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

function svgIcon({ padding = 0 } = {}) {
  const size = 512;
  const inner = size - padding * 2;
  const x = padding;
  const y = padding;
  // Rayo vectorial (no emoji: evita depender de fuentes de color del renderizador)
  const boltPath = `M ${x + inner * 0.56} ${y + inner * 0.12}
    L ${x + inner * 0.28} ${y + inner * 0.56}
    L ${x + inner * 0.46} ${y + inner * 0.56}
    L ${x + inner * 0.4} ${y + inner * 0.88}
    L ${x + inner * 0.72} ${y + inner * 0.4}
    L ${x + inner * 0.52} ${y + inner * 0.4}
    Z`;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bolt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffd45e"/>
        <stop offset="100%" stop-color="#4ac0e0"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="#0f1115"/>
    <rect x="${x}" y="${y}" width="${inner}" height="${inner}" rx="${inner * 0.22}" fill="#171a21"/>
    <path d="${boltPath}" fill="url(#bolt)"/>
  </svg>`;
}

async function main() {
  const sizes = [192, 512];
  for (const size of sizes) {
    await sharp(Buffer.from(svgIcon({ padding: 0 })))
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`icon-${size}.png generado`);
  }

  // apple-touch-icon: sin transparencia, con algo de padding para que iOS no lo recorte raro
  await sharp(Buffer.from(svgIcon({ padding: 24 })))
    .resize(180, 180)
    .flatten({ background: "#0f1115" })
    .png()
    .toFile(path.join(outDir, "apple-touch-icon.png"));
  console.log("apple-touch-icon.png generado");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
