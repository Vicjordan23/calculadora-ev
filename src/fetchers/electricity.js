// Fuente: API publica de datos de Red Electrica de Espana (REE / apidatos.ree.es)
// Serie "PVPC" (id 1001) = tarifa regulada 2.0TD, precio final por hora en EUR/MWh.
// Los precios del dia siguiente se publican en torno a las 20:30.
const REE_URL = "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real";

function toDateParam(date) {
  // date: objeto Date -> "YYYY-MM-DD" usando la fecha LOCAL (no UTC), para
  // que no se desplace de dia cerca de medianoche segun la zona horaria.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Devuelve los precios PVPC horarios (EUR/kWh) para el dia indicado.
 * @param {Date} date dia a consultar (hora local)
 */
async function fetchElectricityPrices(date = new Date()) {
  const day = toDateParam(date);
  const url = `${REE_URL}?start_date=${day}T00:00&end_date=${day}T23:59&time_trunc=hour`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Fallo al consultar precios PVPC (REE): HTTP ${res.status}`);
  }
  const data = await res.json();

  const pvpc = (data.included || []).find((s) => s.type === "PVPC");
  if (!pvpc || !Array.isArray(pvpc.attributes?.values) || pvpc.attributes.values.length === 0) {
    throw new Error(`No hay datos PVPC disponibles todavia para ${day}.`);
  }

  const horas = pvpc.attributes.values.map((v) => ({
    hora: new Date(v.datetime).getHours(),
    datetime: v.datetime,
    precioEurKwh: Number((v.value / 1000).toFixed(5)),
  }));

  horas.sort((a, b) => a.hora - b.hora);

  return {
    fecha: day,
    fetchedAt: new Date().toISOString(),
    ultimaActualizacion: pvpc.attributes["last-update"],
    horas,
  };
}

module.exports = { fetchElectricityPrices, toDateParam };
