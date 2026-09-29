// Fuente: Geoportal de Precios de Carburantes (Ministerio para la Transicion Ecologica)
// API publica, sin necesidad de clave.
const MINETUR_URL =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

// Una sola estacion: la Ballenoil de Guadalajara capital en Calle Trafalgar.
// En el municipio de Guadalajara hay OTRAS dos Ballenoil (Julian Besteiro y
// Carretera Fontanar) que antes se promediaban con esta por error, dando un
// precio que no correspondia con el que se ve de verdad en el surtidor.
const MUNICIPIO_OBJETIVO = "guadalajara";
const DIRECCION_OBJETIVO = "trafalgar";
const MARCA_OBJETIVO = "ballenoil";

function normaliza(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function parsePrecio(valor) {
  if (!valor) return null;
  const n = parseFloat(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// La lista de TODA Espana pesa ~12 MB: en Render gratis (CPU muy limitada)
// tardaba 37-50 s en descargarse y procesarse, mas que el timeout de 30 s
// de cron-job.org. Guadalajara (provincia 19) sola pesa mucho menos.
const PROVINCIAS_OBJETIVO = ["19"];
const TIMEOUT_MS = 20000;

async function pideJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Fallo al consultar precios de carburantes: HTTP ${res.status}`);
  }
  return res.json();
}

async function pideEstaciones() {
  try {
    const respuestas = await Promise.all(PROVINCIAS_OBJETIVO.map((p) => pideJson(`${MINETUR_URL}FiltroProvincia/${p}`)));
    return { fecha: respuestas[0].Fecha, lista: respuestas.flatMap((r) => r.ListaEESSPrecio || []) };
  } catch (err) {
    // Si el filtro por provincia falla, se recurre a la lista completa (mas lenta).
    const data = await pideJson(MINETUR_URL);
    return { fecha: data.Fecha, lista: data.ListaEESSPrecio || [] };
  }
}

async function fetchDieselPrice() {
  const { fecha, lista } = await pideEstaciones();

  const estaciones = lista
    .filter((e) => normaliza(e["Rótulo"]).includes(MARCA_OBJETIVO))
    .filter((e) => normaliza(e["Municipio"]) === MUNICIPIO_OBJETIVO)
    .filter((e) => normaliza(e["Dirección"]).includes(DIRECCION_OBJETIVO))
    .map((e) => ({
      rotulo: e["Rótulo"],
      municipio: e["Municipio"],
      direccion: e["Dirección"],
      horario: e["Horario"],
      precioGasoleoA: parsePrecio(e["Precio Gasoleo A"]),
    }))
    .filter((e) => e.precioGasoleoA !== null);

  if (estaciones.length === 0) {
    throw new Error("No se encontro la estacion Ballenoil de Guadalajara (Calle Trafalgar) en la respuesta del Ministerio.");
  }

  const precios = estaciones.map((e) => e.precioGasoleoA);
  const precioMedio = precios.reduce((a, b) => a + b, 0) / precios.length;
  const precioMinimo = Math.min(...precios);

  return {
    fechaPublicacion: fecha,
    fetchedAt: new Date().toISOString(),
    precioPorLitro: Number(precioMedio.toFixed(3)),
    precioMinimo: Number(precioMinimo.toFixed(3)),
    estaciones,
  };
}

module.exports = { fetchDieselPrice };
