const { client, init } = require("./db");

const DEFAULT_SETTINGS = {
  diesel: {
    consumoL100km: 6,
    kmDiaMedio: 80,
  },
  electrico: {
    modelo: "Tesla Model Y Standard",
    consumoKwh100km: 15,
    capacidadBateriaKwh: 62.5,
    kmDiaMedio: 80,
  },
};

async function getKv(key) {
  await init();
  const res = await client.execute({ sql: "SELECT value FROM kv WHERE key = ?", args: [key] });
  if (res.rows.length === 0) return null;
  return JSON.parse(res.rows[0].value);
}

async function setKv(key, value) {
  await init();
  await client.execute({
    sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, JSON.stringify(value)],
  });
}

async function getSettings() {
  const stored = await getKv("settings");
  if (!stored) return DEFAULT_SETTINGS;
  return {
    diesel: { ...DEFAULT_SETTINGS.diesel, ...(stored.diesel || {}) },
    electrico: { ...DEFAULT_SETTINGS.electrico, ...(stored.electrico || {}) },
  };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const merged = {
    diesel: { ...current.diesel, ...(partial.diesel || {}) },
    electrico: { ...current.electrico, ...(partial.electrico || {}) },
  };
  await setKv("settings", merged);
  return merged;
}

async function getDieselCache() {
  return getKv("dieselCache");
}

async function saveDieselCache(value) {
  await init();
  await setKv("dieselCache", value);
  const fecha = value.fetchedAt.slice(0, 10);
  await client.execute({
    sql: "INSERT INTO diesel_history (fecha, precio_por_litro) VALUES (?, ?) ON CONFLICT(fecha) DO UPDATE SET precio_por_litro = excluded.precio_por_litro",
    args: [fecha, value.precioPorLitro],
  });
}

async function getDieselHistory() {
  await init();
  const res = await client.execute("SELECT fecha, precio_por_litro AS precioPorLitro FROM diesel_history ORDER BY fecha DESC LIMIT 365");
  return res.rows.map((r) => ({ fecha: r.fecha, precioPorLitro: r.precioPorLitro }));
}

async function getElectricityForDate(fecha) {
  await init();
  const res = await client.execute({ sql: "SELECT payload FROM electricity_cache WHERE fecha = ?", args: [fecha] });
  if (res.rows.length === 0) return null;
  return JSON.parse(res.rows[0].payload);
}

async function saveElectricityPrices(dayResult) {
  await init();
  await client.execute({
    sql: "INSERT INTO electricity_cache (fecha, payload) VALUES (?, ?) ON CONFLICT(fecha) DO UPDATE SET payload = excluded.payload",
    args: [dayResult.fecha, JSON.stringify(dayResult)],
  });
  return dayResult;
}

async function getCharges() {
  await init();
  const res = await client.execute("SELECT * FROM charges ORDER BY creado_en ASC");
  return res.rows.map(rowToCharge);
}

function rowToCharge(r) {
  return {
    id: r.id,
    fecha: r.fecha,
    horaInicio: r.hora_inicio,
    duracionHoras: r.duracion_horas,
    bateriaAntesPct: r.bateria_antes_pct,
    bateriaDespuesPct: r.bateria_despues_pct,
    kwhCargados: r.kwh_cargados,
    costeTotal: r.coste_total,
    precioMedioEurKwh: r.precio_medio_eur_kwh,
    coberturaDatos: r.cobertura_datos,
    detalle: JSON.parse(r.detalle),
  };
}

async function addCharge(charge) {
  await init();
  const id = Date.now().toString(36);
  const creadoEn = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO charges
      (id, fecha, hora_inicio, duracion_horas, bateria_antes_pct, bateria_despues_pct, kwh_cargados, coste_total, precio_medio_eur_kwh, cobertura_datos, detalle, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      charge.fecha,
      charge.horaInicio,
      charge.duracionHoras,
      charge.bateriaAntesPct,
      charge.bateriaDespuesPct,
      charge.kwhCargados,
      charge.costeTotal,
      charge.precioMedioEurKwh,
      charge.coberturaDatos,
      JSON.stringify(charge.detalle),
      creadoEn,
    ],
  });
  return { id, ...charge };
}

async function deleteCharge(id) {
  await init();
  await client.execute({ sql: "DELETE FROM charges WHERE id = ?", args: [id] });
  return getCharges();
}

module.exports = {
  getSettings,
  saveSettings,
  getDieselCache,
  saveDieselCache,
  getDieselHistory,
  getElectricityForDate,
  saveElectricityPrices,
  getCharges,
  addCharge,
  deleteCharge,
};
