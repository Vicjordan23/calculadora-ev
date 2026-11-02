// Parte de la factura de la luz que corresponde al coche (para repartirla con el compañero de piso).
// Las cargas ya llevan el coste de la energia con el PVPC de cada hora (precio con peajes y cargos,
// sin impuestos); aqui solo se anaden los impuestos y se agrupa por ciclo de facturacion.
const IEE = 0.0511269632; // impuesto electrico (factura de junio 2026)
const IVA = 0.21; // el IVA se aplica tambien sobre el impuesto electrico

const iso = (d) => d.toISOString().slice(0, 10);

// Ciclo de facturacion que contiene `hoyISO` (+ offset ciclos): del dia `diaInicio` (incluido)
// al mismo dia del mes siguiente (excluido). Tu factura: 3 de mayo -> 2 de junio.
function cicloFacturacion(hoyISO, offset = 0, diaInicio = 3) {
  const [y, m, d] = hoyISO.split("-").map(Number);
  const mes = m - 1 + (d < diaInicio ? -1 : 0) + offset;
  const desde = new Date(Date.UTC(y, mes, diaInicio));
  const hasta = new Date(Date.UTC(y, mes + 1, diaInicio));
  const ultimo = new Date(hasta.getTime() - 86400000);
  return { desde: iso(desde), hasta: iso(hasta), ultimoDia: iso(ultimo) };
}

function conImpuestos(base, { iee = IEE, iva = IVA } = {}) {
  const impuestoElectrico = base * iee;
  const ivaImporte = (base + impuestoElectrico) * iva;
  return { base, impuestoElectrico, iva: ivaImporte, total: base + impuestoElectrico + ivaImporte };
}

const r2 = (n) => Number(n.toFixed(2));

function resumenFactura(cargas, ciclo, opciones) {
  const delCiclo = cargas.filter((c) => c.tipo !== "fuera" && c.fecha >= ciclo.desde && c.fecha < ciclo.hasta);
  const kwh = delCiclo.reduce((a, c) => a + c.kwhCargados, 0);
  const base = delCiclo.reduce((a, c) => a + c.costeTotal, 0);
  const t = conImpuestos(base, opciones);
  const incompletas = delCiclo.filter((c) => c.coberturaDatos != null && c.coberturaDatos < 100).length;
  return {
    desde: ciclo.desde,
    hasta: ciclo.hasta,
    ultimoDia: ciclo.ultimoDia,
    nCargas: delCiclo.length,
    incompletas,
    kwh: r2(kwh),
    base: r2(t.base),
    impuestoElectrico: r2(t.impuestoElectrico),
    iva: r2(t.iva),
    total: r2(t.total),
    cargas: delCiclo.map((c) => ({ id: c.id, fecha: c.fecha, kwh: c.kwhCargados, coste: r2(conImpuestos(c.costeTotal, opciones).total) })),
  };
}

module.exports = { IEE, IVA, cicloFacturacion, conImpuestos, resumenFactura };
