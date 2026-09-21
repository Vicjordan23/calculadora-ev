// Fuente: Geoportal de Precios de Carburantes (Ministerio para la Transicion Ecologica)
// API publica, sin necesidad de clave.
const MINETUR_URL =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

// Coincidencia exacta de municipio para no confundir "Alcala de Henares" con
// "Alcala de Guadaira" u otros municipios que empiecen igual.
const MUNICIPIOS_OBJETIVO = ["guadalajara", "alcala de henares"];
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

async function fetchDieselPrice() {
  const res = await fetch(MINETUR_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Fallo al consultar precios de carburantes: HTTP ${res.status}`);
  }
  const data = await res.json();
  const lista = data.ListaEESSPrecio || [];

  const estaciones = lista
    .filter((e) => normaliza(e["Rótulo"]).includes(MARCA_OBJETIVO))
    .filter((e) => MUNICIPIOS_OBJETIVO.includes(normaliza(e["Municipio"])))
    .map((e) => ({
      rotulo: e["Rótulo"],
      municipio: e["Municipio"],
      direccion: e["Dirección"],
      horario: e["Horario"],
      precioGasoleoA: parsePrecio(e["Precio Gasoleo A"]),
    }))
    .filter((e) => e.precioGasoleoA !== null);

  if (estaciones.length === 0) {
    throw new Error(
      "No se encontraron estaciones Ballenoil en Guadalajara o Alcala de Henares en la respuesta del Ministerio."
    );
  }

  const precios = estaciones.map((e) => e.precioGasoleoA);
  const precioMedio = precios.reduce((a, b) => a + b, 0) / precios.length;
  const precioMinimo = Math.min(...precios);

  return {
    fechaPublicacion: data.Fecha,
    fetchedAt: new Date().toISOString(),
    precioPorLitro: Number(precioMedio.toFixed(3)),
    precioMinimo: Number(precioMinimo.toFixed(3)),
    estaciones,
  };
}

module.exports = { fetchDieselPrice };
