const fmtEur = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const fmtEur3 = (n) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`);

let chartHoy, chartManana;

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error de API");
  return data;
}

function pintaGraficoHoras(canvasId, chartRef, horas, colorHex) {
  const ctx = document.getElementById(canvasId);
  const labels = horas.map((h) => `${String(h.hora).padStart(2, "0")}h`);
  const valores = horas.map((h) => h.precioEurKwh);

  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "€/kWh", data: valores, backgroundColor: colorHex, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" } },
        y: { ticks: { color: "#9aa1ac" }, grid: { color: "#2a2f3a" }, beginAtZero: true },
      },
    },
  });
}

async function cargaResumen() {
  const data = await api("/summary");

  if (data.diesel) {
    document.getElementById("diesel-precio").textContent = fmtEur3(data.diesel.precioPorLitro);
    document.getElementById("diesel-meta").textContent = `Publicado: ${data.diesel.fechaPublicacion} · ${data.diesel.estaciones.length} estaciones`;
  }
  if (data.resumenDiesel) {
    document.getElementById("diesel-litros").textContent = `${data.resumenDiesel.litrosDia} L`;
    document.getElementById("diesel-dia").textContent = fmtEur(data.resumenDiesel.costeDia);
    document.getElementById("diesel-mes").textContent = fmtEur(data.resumenDiesel.costeMes);
    document.getElementById("diesel-anio").textContent = fmtEur(data.resumenDiesel.costeAnio);
  }

  if (data.electricidadHoy) {
    document.getElementById("elec-precio").textContent = fmtEur3(data.electricidadHoy.precioMedioEurKwh);
    document.getElementById("elec-meta").textContent = `PVPC ${data.electricidadHoy.fecha}`;
    chartHoy = pintaGraficoHoras("chart-hoy", chartHoy, data.electricidadHoy.horas, "#4ac0e0");
  }
  if (data.resumenElectrico) {
    document.getElementById("elec-kwh").textContent = `${data.resumenElectrico.kwhDia} kWh`;
    document.getElementById("elec-dia").textContent = fmtEur(data.resumenElectrico.costeDia);
    document.getElementById("elec-mes").textContent = fmtEur(data.resumenElectrico.costeMes);
    document.getElementById("elec-anio").textContent = fmtEur(data.resumenElectrico.costeAnio);
  }

  if (data.ahorro) {
    document.getElementById("ahorro-anio").textContent = fmtEur(data.ahorro.anioEur);
    document.getElementById("ahorro-dia").textContent = fmtEur(data.ahorro.diaEur);
    document.getElementById("ahorro-mes").textContent = fmtEur(data.ahorro.mesEur);
  }

  // Ajustes: precarga los valores actuales
  const s = data.settings;
  document.getElementById("set-diesel-consumo").value = s.diesel.consumoL100km;
  document.getElementById("set-diesel-km").value = s.diesel.kmDiaMedio;
  document.getElementById("set-elec-consumo").value = s.electrico.consumoKwh100km;
  document.getElementById("set-elec-capacidad").value = s.electrico.capacidadBateriaKwh;
  document.getElementById("set-elec-km").value = s.electrico.kmDiaMedio;
}

async function cargaGraficoManana() {
  try {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const fecha = manana.toISOString().slice(0, 10);
    const data = await api(`/electricity/prices?fecha=${fecha}`);
    document.getElementById("panel-manana").style.display = "block";
    chartManana = pintaGraficoHoras("chart-manana", chartManana, data.horas, "#6d8dff");
  } catch (err) {
    document.getElementById("panel-manana").style.display = "none";
  }
}

function formatoVentana(v) {
  if (!v) return "";
  const inicio = `${String(v.inicio.hora).padStart(2, "0")}:00 (${v.inicio.fecha})`;
  const fin = `${String((v.fin.hora + 1) % 24).padStart(2, "0")}:00`;
  return `de ${inicio} a ${fin} · precio medio ${fmtEur3(v.precioMedioEurKwh)}/kWh`;
}

async function recomendar(duracionHoras) {
  const resultado = document.getElementById("recomendacion-resultado");
  resultado.innerHTML = "Calculando...";
  try {
    const data = await api(`/recommend?duracionHoras=${duracionHoras}`);
    let html = "";
    if (data.recomendacionConManana) {
      html += `<div class="ok">✅ Mejor franja disponible: ${formatoVentana(data.recomendacionConManana)}</div>`;
    }
    if (!data.mananaDisponible) {
      html += `<div class="warn">ℹ️ ${data.avisoManana}</div>`;
      if (data.recomendacionHoy) {
        html += `<div>Dentro de las horas que quedan hoy: ${formatoVentana(data.recomendacionHoy)}</div>`;
      }
    }
    if (!data.recomendacionConManana) {
      html = `<div class="err">No hay suficientes horas de datos para una ventana de ${duracionHoras}h todavía.</div>`;
    }
    resultado.innerHTML = html;
  } catch (err) {
    resultado.innerHTML = `<div class="err">${err.message}</div>`;
  }
}

async function cargaTablaCargas() {
  const charges = await api("/charges");
  const tbody = document.querySelector("#tabla-cargas tbody");
  tbody.innerHTML = "";
  charges
    .slice()
    .reverse()
    .forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.fecha}</td>
        <td>${String(c.horaInicio).padStart(2, "0")}:00</td>
        <td>${c.duracionHoras} h</td>
        <td>${c.kwhCargados} kWh</td>
        <td>${fmtEur(c.costeTotal)}</td>
        <td>${c.precioMedioEurKwh != null ? fmtEur3(c.precioMedioEurKwh) : "—"}</td>
        <td><button data-id="${c.id}">✕</button></td>
      `;
      tbody.appendChild(tr);
    });

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/charges/${btn.dataset.id}`, { method: "DELETE" });
      cargaTablaCargas();
    });
  });
}

function initFormularios() {
  document.getElementById("carga-fecha").value = new Date().toISOString().slice(0, 10);

  document.getElementById("btn-refresh-diesel").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/diesel/refresh", { method: "POST" });
    cargaResumen();
  });

  document.getElementById("btn-refresh-elec").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/electricity/refresh", { method: "POST" });
    cargaResumen();
  });

  document.getElementById("form-recomendar").addEventListener("submit", (e) => {
    e.preventDefault();
    const duracion = document.getElementById("rec-duracion").value;
    recomendar(duracion);
  });

  document.getElementById("form-carga").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultado = document.getElementById("carga-resultado");
    const body = {
      fecha: document.getElementById("carga-fecha").value,
      horaInicio: Number(document.getElementById("carga-hora").value),
      duracionHoras: Number(document.getElementById("carga-duracion").value),
      bateriaAntesPct: document.getElementById("carga-bat-antes").value || null,
      bateriaDespuesPct: document.getElementById("carga-bat-despues").value || null,
      kwhCargados: document.getElementById("carga-kwh").value || null,
    };
    try {
      const registro = await api("/charges", { method: "POST", body: JSON.stringify(body) });
      resultado.innerHTML = `<div class="ok">Guardado: ${registro.kwhCargados} kWh · coste ${fmtEur(registro.costeTotal)} (cobertura de datos: ${registro.coberturaDatos}%)</div>`;
      e.target.reset();
      document.getElementById("carga-fecha").value = new Date().toISOString().slice(0, 10);
      cargaTablaCargas();
    } catch (err) {
      resultado.innerHTML = `<div class="err">${err.message}</div>`;
    }
  });

  document.getElementById("form-ajustes").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/settings", {
      method: "POST",
      body: JSON.stringify({
        diesel: {
          consumoL100km: Number(document.getElementById("set-diesel-consumo").value),
          kmDiaMedio: Number(document.getElementById("set-diesel-km").value),
        },
        electrico: {
          consumoKwh100km: Number(document.getElementById("set-elec-consumo").value),
          capacidadBateriaKwh: Number(document.getElementById("set-elec-capacidad").value),
          kmDiaMedio: Number(document.getElementById("set-elec-km").value),
        },
      }),
    });
    cargaResumen();
  });
}

initFormularios();
cargaResumen();
cargaGraficoManana();
cargaTablaCargas();
