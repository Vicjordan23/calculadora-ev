// Precios PVPC (tarifa regulada 2.0TD) por horas, EUR/kWh. Se publican
// para el dia siguiente a partir de ~20:15-20:30. Hay dos fuentes oficiales
// de REE con los MISMOS valores (comprobado: diferencia 0.000 EUR/MWh) y se
// prueban en orden, quedandose con la primera que responda:
//   1) ESIOS, archivo 70 "PVPC": sin token, respuesta limpia.
//   2) apidatos.ree.es, serie "PVPC" (id 1001): la que usabamos hasta ahora.
const ESIOS_URL = "https://api.esios.ree.es/archives/70/download_json";
const REE_URL = "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real";
const TIMEOUT_MS = 15000;

function toDateParam(date) {
  // date: objeto Date -> "YYYY-MM-DD" usando la fecha LOCAL (no UTC), para
  // que no se desplace de dia cerca de medianoche segun la zona horaria.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function errorNoPublicado(mensaje) {
  const err = new Error(mensaje);
  err.noPublicado = true; // "todavia no hay datos", no un fallo tecnico: no merece reintentos
  return err;
}

async function fetchDesdeEsios(date) {
  const day = toDateParam(date);
  const res = await fetch(`${ESIOS_URL}?locale=es&date=${day}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESIOS: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.PVPC) || data.PVPC.length === 0) {
    throw errorNoPublicado(`ESIOS: ${data.message || "sin datos"}`);
  }

  const [dd, mm, yyyy] = String(data.PVPC[0].Dia).split("/");
  if (`${yyyy}-${mm}-${dd}` !== day) throw new Error(`ESIOS: devolvio el dia ${data.PVPC[0].Dia} en vez de ${day}`);

  const vistas = new Set();
  const horas = [];
  for (const fila of data.PVPC) {
    const hora = parseInt(String(fila.Hora).slice(0, 2), 10);
    const eurMwh = parseFloat(String(fila.PCB).replace(",", "."));
    // En el dia de 25 horas (cambio de hora de octubre) la hora 02-03 sale
    // dos veces: nos quedamos con la primera.
    if (Number.isNaN(hora) || !Number.isFinite(eurMwh) || vistas.has(hora)) continue;
    vistas.add(hora);
    horas.push({ hora, datetime: `${day}T${String(hora).padStart(2, "0")}:00:00`, precioEurKwh: Number((eurMwh / 1000).toFixed(5)) });
  }
  horas.sort((a, b) => a.hora - b.hora);
  if (horas.length < 20) throw new Error(`ESIOS: solo ${horas.length} horas`);

  return { fecha: day, fetchedAt: new Date().toISOString(), ultimaActualizacion: null, fuente: "esios", horas };
}

async function fetchDesdeApidatos(date) {
  const day = toDateParam(date);
  const url = `${REE_URL}?start_date=${day}T00:00&end_date=${day}T23:59&time_trunc=hour`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    // apidatos responde 502 "Los datos solicitados no estan disponibles" mientras no hay datos.
    if (res.status === 502 || res.status === 404) throw errorNoPublicado(`apidatos: HTTP ${res.status} (no disponible)`);
    throw new Error(`apidatos: HTTP ${res.status}`);
  }
  const data = await res.json();

  const pvpc = (data.included || []).find((s) => s.type === "PVPC");
  if (!pvpc || !Array.isArray(pvpc.attributes?.values) || pvpc.attributes.values.length === 0) {
    throw errorNoPublicado("apidatos: sin serie PVPC");
  }

  const horas = pvpc.attributes.values.map((v) => ({
    hora: new Date(v.datetime).getHours(),
    datetime: v.datetime,
    precioEurKwh: Number((v.value / 1000).toFixed(5)),
  }));
  horas.sort((a, b) => a.hora - b.hora);

  return { fecha: day, fetchedAt: new Date().toISOString(), ultimaActualizacion: pvpc.attributes["last-update"], fuente: "apidatos", horas };
}

/**
 * Devuelve los precios PVPC horarios (EUR/kWh) del dia indicado, probando
 * las dos fuentes. Si ninguna tiene datos y todas dicen "aun no publicado",
 * el error lleva `noPublicado = true`.
 * @param {Date} date dia a consultar (hora local)
 */
async function fetchElectricityPrices(date = new Date()) {
  const errores = [];
  let todosNoPublicado = true;

  for (const fuente of [fetchDesdeEsios, fetchDesdeApidatos]) {
    try {
      return await fuente(date);
    } catch (err) {
      errores.push(err.message);
      if (!err.noPublicado) todosNoPublicado = false;
    }
  }

  const err = new Error(`Precios PVPC de ${toDateParam(date)} no disponibles (${errores.join(" | ")})`);
  err.noPublicado = todosNoPublicado;
  throw err;
}

module.exports = { fetchElectricityPrices, toDateParam };
