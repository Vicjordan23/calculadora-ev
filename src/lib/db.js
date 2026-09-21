const path = require("path");
const fs = require("fs");
const { createClient } = require("@libsql/client");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// En local, sin variables de entorno, usa un fichero SQLite dentro de data/.
// En produccion (Render, etc.), define TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
// apuntando a una base de datos gratuita de turso.tech para que los datos
// no se pierdan cuando el servicio gratuito se reinicia o duerme.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, "app.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diesel_history (
  fecha TEXT PRIMARY KEY,
  precio_por_litro REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS electricity_cache (
  fecha TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  hora_inicio REAL NOT NULL,
  duracion_horas REAL NOT NULL,
  bateria_antes_pct REAL,
  bateria_despues_pct REAL,
  kwh_cargados REAL NOT NULL,
  coste_total REAL NOT NULL,
  precio_medio_eur_kwh REAL,
  cobertura_datos REAL,
  detalle TEXT NOT NULL,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diesel_fills (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  litros REAL NOT NULL,
  precio_por_litro REAL NOT NULL,
  coste_total REAL NOT NULL,
  km_odometro REAL,
  estacion TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS electricity_history (
  fecha TEXT PRIMARY KEY,
  precio_medio_eur_kwh REAL NOT NULL
);
`;

let ready = null;
function init() {
  if (!ready) {
    ready = client.executeMultiple(SCHEMA);
  }
  return ready;
}

module.exports = { client, init };
