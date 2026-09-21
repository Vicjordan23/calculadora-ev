/**
 * Busca la mejor ventana continua de `duracionHoras` para cargar, dado un
 * array de precios horarios que puede encadenar varios dias (para permitir
 * ventanas que cruzan la medianoche). Como la potencia de carga se asume
 * constante, minimizar el precio medio de la ventana equivale a minimizar
 * el coste total para una duracion fija.
 *
 * @param {Array<{fecha, hora, precioEurKwh}>} serieHoras horas ordenadas cronologicamente
 * @param {number} duracionHoras duracion deseada (admite decimales, p.ej. 3.5)
 */
function mejorVentana(serieHoras, duracionHoras) {
  if (!serieHoras || serieHoras.length === 0) return null;

  const horasEnteras = Math.floor(duracionHoras);
  const fraccionFinal = Number((duracionHoras - horasEnteras).toFixed(4));
  const ventanaLen = fraccionFinal > 0 ? horasEnteras + 1 : horasEnteras;
  if (ventanaLen <= 0 || ventanaLen > serieHoras.length) return null;

  let mejor = null;

  for (let inicio = 0; inicio <= serieHoras.length - ventanaLen; inicio++) {
    let coste = 0;
    for (let i = 0; i < ventanaLen; i++) {
      const peso = i === ventanaLen - 1 && fraccionFinal > 0 ? fraccionFinal : 1;
      coste += serieHoras[inicio + i].precioEurKwh * peso;
    }
    const precioMedio = coste / duracionHoras;

    if (!mejor || coste < mejor.costeRelativo) {
      mejor = {
        inicio: serieHoras[inicio],
        fin: serieHoras[inicio + ventanaLen - 1],
        costeRelativo: coste,
        precioMedioEurKwh: Number(precioMedio.toFixed(5)),
        horas: serieHoras.slice(inicio, inicio + ventanaLen),
      };
    }
  }

  return mejor;
}

/**
 * Construye la serie horaria concatenando los dias necesarios (hoy + manana)
 * a partir del cache de electricidad, para poder recomendar ventanas que
 * crucen la medianoche.
 */
function construyeSerie(diasPrecios) {
  // diasPrecios: [{fecha, horas: [{hora, precioEurKwh, datetime}]}, ...] en orden cronologico
  const serie = [];
  for (const dia of diasPrecios) {
    if (!dia) continue;
    for (const h of dia.horas) {
      serie.push({ fecha: dia.fecha, hora: h.hora, precioEurKwh: h.precioEurKwh });
    }
  }
  return serie;
}

module.exports = { mejorVentana, construyeSerie };
