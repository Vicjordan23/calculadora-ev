const test = require("node:test");
const assert = require("node:assert/strict");
const { cicloFacturacion, conImpuestos, resumenFactura } = require("../src/lib/factura");

test("ciclo de facturacion: del dia 3 al 2 del mes siguiente", () => {
  assert.deepEqual(cicloFacturacion("2026-05-20"), { desde: "2026-05-03", hasta: "2026-06-03", ultimoDia: "2026-06-02" });
  assert.equal(cicloFacturacion("2026-05-02").desde, "2026-04-03");
  assert.equal(cicloFacturacion("2026-01-02").desde, "2025-12-03");
  assert.equal(cicloFacturacion("2026-05-20", -1).desde, "2026-04-03");
  assert.equal(cicloFacturacion("2026-12-20", 1).desde, "2027-01-03");
});

test("impuestos como en la factura: IEE sobre la base e IVA sobre base+IEE", () => {
  const t = conImpuestos(35.33);
  assert.ok(Math.abs(t.impuestoElectrico - 1.81) < 0.01);
  assert.ok(Math.abs(conImpuestos(10).total - 10 * 1.0511269632 * 1.21) < 1e-9);
});

test("resumenFactura suma solo cargas en casa del ciclo", () => {
  const cargas = [
    { id: 1, fecha: "2026-05-03", tipo: "casa", kwhCargados: 10, costeTotal: 1 },
    { id: 2, fecha: "2026-06-02", tipo: "casa", kwhCargados: 20, costeTotal: 2, coberturaDatos: 50 },
    { id: 3, fecha: "2026-06-03", tipo: "casa", kwhCargados: 99, costeTotal: 9 },
    { id: 4, fecha: "2026-05-10", tipo: "fuera", kwhCargados: 30, costeTotal: 15 },
  ];
  const r = resumenFactura(cargas, cicloFacturacion("2026-05-20"));
  assert.equal(r.nCargas, 2);
  assert.equal(r.kwh, 30);
  assert.equal(r.base, 3);
  assert.equal(r.incompletas, 1);
  assert.equal(r.total, Number((3 * 1.0511269632 * 1.21).toFixed(2)));
});
