const { client, init } = require("./db");

const DEFAULT_SETTINGS = {
  diesel: {
    consumoL100km: 6,
    kmDiaMedio: 60,
  },
  electrico: {
    modelo: "Tesla Model Y Standard",
    consumoKwh100km: 15,
    capacidadBateriaKwh: 62.5,
    kmDiaMedio: 60,
    // Ventana real en la que puedes cargar en casa: entre semana solo puedes
    // cargar fuera de tu horario de trabajo (llegas a horaLlegadaCasa, sales
    // a horaSalidaTrabajo al dia siguiente); los fines de semana no aplica
    // ninguna restriccion.
    horaSalidaTrabajo: 8,
    horaLlegadaCasa: 19,
    // Potencia real disponible para el coche en casa (no toda la potencia
    // contratada: cable/toma domestica tipica en Espana sin wallbox trifasico).
    potenciaCargaKw: 3,
  },
  notificaciones: {
    avisoStaleDias: 10,
    umbralAnomaliaPct: 3,
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
    notificaciones: { ...DEFAULT_SETTINGS.notificaciones, ...(stored.notificaciones || {}) },
  };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const merged = {
    diesel: { ...current.diesel, ...(partial.diesel || {}) },
    electrico: { ...current.electrico, ...(partial.electrico || {}) },
    notificaciones: { ...current.notificaciones, ...(partial.notificaciones || {}) },
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

  if (dayResult.horas && dayResult.horas.length > 0) {
    const media = dayResult.horas.reduce((a, h) => a + h.precioEurKwh, 0) / dayResult.horas.length;
    await client.execute({
      sql: "INSERT INTO electricity_history (fecha, precio_medio_eur_kwh) VALUES (?, ?) ON CONFLICT(fecha) DO UPDATE SET precio_medio_eur_kwh = excluded.precio_medio_eur_kwh",
      args: [dayResult.fecha, Number(media.toFixed(5))],
    });
  }

  return dayResult;
}

async function getElectricityHistory() {
  await init();
  const res = await client.execute(
    "SELECT fecha, precio_medio_eur_kwh AS precioMedioEurKwh FROM electricity_history ORDER BY fecha DESC LIMIT 365"
  );
  return res.rows.map((r) => ({ fecha: r.fecha, precioMedioEurKwh: r.precioMedioEurKwh }));
}

// Devuelve el desglose horario completo (no solo la media) de todos los
// dias que tenemos guardados, para poder simular retroactivamente que
// habria costado cargar respetando la ventana horaria real disponible.
async function getElectricityCacheAll() {
  await init();
  const res = await client.execute("SELECT fecha, payload FROM electricity_cache ORDER BY fecha ASC");
  return res.rows.map((r) => JSON.parse(r.payload));
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
    tipo: r.tipo || "casa",
    proveedor: r.proveedor,
  };
}

async function addCharge(charge) {
  await init();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const creadoEn = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO charges
      (id, fecha, hora_inicio, duracion_horas, bateria_antes_pct, bateria_despues_pct, kwh_cargados, coste_total, precio_medio_eur_kwh, cobertura_datos, detalle, creado_en, tipo, proveedor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      charge.fecha,
      charge.horaInicio ?? 0,
      charge.duracionHoras ?? 0,
      charge.bateriaAntesPct,
      charge.bateriaDespuesPct,
      charge.kwhCargados,
      charge.costeTotal,
      charge.precioMedioEurKwh,
      charge.coberturaDatos,
      JSON.stringify(charge.detalle || []),
      creadoEn,
      charge.tipo || "casa",
      charge.proveedor ?? null,
    ],
  });
  return { id, ...charge };
}

async function deleteCharge(id) {
  await init();
  await client.execute({ sql: "DELETE FROM charges WHERE id = ?", args: [id] });
  return getCharges();
}

function rowToDieselFill(r) {
  return {
    id: r.id,
    fecha: r.fecha,
    litros: r.litros,
    precioPorLitro: r.precio_por_litro,
    costeTotal: r.coste_total,
    kmOdometro: r.km_odometro,
    estacion: r.estacion,
    notas: r.notas,
  };
}

async function getDieselFills() {
  await init();
  const res = await client.execute("SELECT * FROM diesel_fills ORDER BY fecha ASC, creado_en ASC");
  return res.rows.map(rowToDieselFill);
}

async function addDieselFill(fill) {
  await init();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const creadoEn = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO diesel_fills
      (id, fecha, litros, precio_por_litro, coste_total, km_odometro, estacion, notas, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      fill.fecha,
      fill.litros,
      fill.precioPorLitro,
      fill.costeTotal,
      fill.kmOdometro ?? null,
      fill.estacion ?? null,
      fill.notas ?? null,
      creadoEn,
    ],
  });
  return { id, ...fill };
}

async function deleteDieselFill(id) {
  await init();
  await client.execute({ sql: "DELETE FROM diesel_fills WHERE id = ?", args: [id] });
  return getDieselFills();
}

module.exports = {
  getSettings,
  saveSettings,
  getDieselCache,
  saveDieselCache,
  getDieselHistory,
  getElectricityForDate,
  saveElectricityPrices,
  getElectricityHistory,
  getElectricityCacheAll,
  getCharges,
  addCharge,
  deleteCharge,
  getDieselFills,
  addDieselFill,
  deleteDieselFill,
};
