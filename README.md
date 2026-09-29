# Calculadora EV vs Diesel

Compara el gasto de tu coche diesel actual con el de un Tesla Model Y Standard cargado en casa con tarifa regulada (PVPC), usando precios reales obtenidos automáticamente:

- **Diesel**: API pública del Ministerio para la Transición Ecológica, filtrada a la estación Ballenoil de Guadalajara en Calle Trafalgar (no la media de varias estaciones).
- **Electricidad (PVPC)**: API pública de Red Eléctrica de España (REE), precio por horas. El precio de mañana se publica sobre las 20:30.

## Arrancar

```bash
npm install
npm start
```

Abre `http://localhost:3000`.

## Usarla desde casa y desde el móvil (no solo en este PC)

Ver [DEPLOY.md](DEPLOY.md) para la guía paso a paso: desplegar gratis en Render + Turso y acceder desde cualquier sitio.

## Qué hace ahora mismo

- Compara coste diario/mensual/anual diesel vs eléctrico con precios de hoy.
- Gráfico de precios PVPC por horas (hoy y mañana en cuanto se publican).
- **Planificador de carga**: compara en tiempo real dos estrategias con precios PVPC reales — (A) cargar solo la energía justa para mañana, o (B) aprovechar ahora (hoy+mañana) las horas más baratas para cargar hasta el 100% si compensa y cubre varios días (la lógica de "cargar el fin de semana para toda la semana"). Todo el cálculo reparte la energía a la potencia real del cargador de casa (nunca se carga de golpe en una hora) y respeta tu ventana real disponible (entre semana solo fuera de tu horario de trabajo; el fin de semana entero) — todo configurable en Ajustes.
- El coste "Eléctrico" del resumen ya no es una media plana de precios: es lo que costaría de verdad cargar tu consumo diario usando solo horas permitidas y la potencia real de tu cargador.
- Simulación retroactiva ("💡 Lo que habría costado cargar..."): con los precios PVPC reales ya guardados, calcula cuánto habría costado cargar de verdad. Con la estrategia "fin de semana" es un evento por fin de semana (sábado+domingo juntos, mejores horas combinadas de los dos días, no la media de un día suelto ni una carga inventada entre semana); con "diaria", día a día respetando tu ventana real. Se compara con tu gasto real de diésel en el mismo periodo. La tabla muestra solo los últimos 4 findes/días por defecto, con "Ver todos" para el resto. Útil mientras aún no tienes el coche eléctrico.
- Registro de cargas reales: en casa (fecha, hora de inicio, duración y batería antes/después o kWh directos, coste calculado con el PVPC de cada hora) o fuera de casa (Supercharger u otra compañía, con precio manual).
- Registro de repostajes reales de diésel (mientras no tengas el eléctrico): litros, precio/L o coste total, y km del cuentakilómetros opcionales. Calcula gasto real acumulado del mes/año y el consumo real L/100km a partir de los km entre repostajes, para contrastarlo con la estimación teórica de los ajustes.
- Gráfico de evolución mensual: gasto real (repostajes/cargas) frente al coste teórico de cada mes, calculado con el precio medio real de ese mes.
- Exportar a CSV el historial de repostajes y de cargas.
- **Estrategia de carga configurable**: "concentrada el fin de semana" (por defecto) simula cargar la batería del sábado/domingo (cuando el PVPC suele tener muchas horas baratas o gratis, sin restricción de horario de trabajo) hasta cubrir toda la semana, tirando de batería el resto de días sin volver a enchufar; o "diaria", cargando cada día en tus horas más baratas. Dentro de "fin de semana" hay un segundo ajuste, **cargar siempre al 100%** (por defecto, así es como de verdad se usa el cargador) frente a cargar solo la energía justa para la semana. El resumen, la comparativa y la evolución mensual usan siempre la estrategia elegida en Ajustes, y las proyecciones mensual/anual escalan por los días/semana que de verdad conduces (no asumen que conduces y cargas los 7 días).
- **"Cuánto cuesta" con Día/Semana/Mes/Año** en una sola tarjeta por combustible, separando lo estimado (según ajustes) de lo realmente gastado (repostajes/cargas registrados) — igual para diésel que para eléctrico.
- **🗓️ Tu semana de carga**: visualiza la batería bajando de lunes a viernes y recargando el fin de semana, con las horas reales usadas el último fin de semana con datos (no un ejemplo genérico). Incluye:
  - **Batería estimada hoy**: sin integración con el coche, estima el % actual contando los días laborables transcurridos desde el domingo de la última carga completa.
  - **Aviso "toca cargar"**: banner que aparece viernes/sábado/domingo cuando la batería estimada ya está baja, con la previsión de coste para llenarla.
  - **Previsión del próximo fin de semana**: cuánto costará (media de tus fines de semana con histórico), sin esperar a que se publiquen los precios reales.
- **Comparativa real histórica**: si hay suficiente histórico de precios de fin de semana guardado (≥80% de cobertura desde tu primer repostaje), la comparativa "Diésel real vs Tesla" deja de extrapolar un precio medio y suma el coste real de cada fin de semana concreto — con gráfico mensual, insignia de "% más barato" y **gráfico de ahorro acumulado** mes a mes desde tu primer repostaje. Para rellenar ese histórico de golpe (una sola vez) desde tu primer repostaje: `POST /api/electricity/backfill-findes` (opcionalmente `?desde=YYYY-MM-DD`); es idempotente, se puede volver a lanzar sin duplicar nada.
- **Copia de seguridad**: botón "Exportar todo (JSON)" que descarga ajustes, repostajes, cargas y el histórico de precios ya guardado en un solo archivo (`GET /api/export`).
- **🚗 Coste real de tener el coche (con la cuota)**: si hay financiación/renting/leasing, un ajuste de cuota mensual y fecha de inicio suma ese gasto fijo a la luz, para ver si el ahorro en combustible compensa la cuota de verdad o no — proyección mensual siempre, y acumulado real desde la fecha de inicio en cuanto pasan unos días.
- Formularios rápidos: los campos opcionales (fecha, km, kWh directos...) están plegados en "Más detalles" para que lo habitual (litros+precio, o duración+batería) se rellene en dos toques.
- PWA instalable: manifest + iconos + service worker con cache del "cascarón" de la app (nunca de los precios), para que abra rápido y puedas añadirla a la pantalla de inicio del móvil.
- Ajustes editables: consumos, km/día, días de conducción por semana, capacidad de batería, batería mínima antes de recargar, estrategia de carga, hora de llegada a casa / salida al trabajo y potencia de carga en casa.
- Refresco automático programado: diesel a las 07:00 y 14:00, PVPC de mañana a las 20:35 y 21:00 (por si la publicación se retrasa). Además cada endpoint refresca solo si el dato en caché tiene más de 1h.

Los datos se guardan en SQLite vía [libSQL](https://turso.tech/libsql): en local usa automáticamente un fichero en `data/app.db` (cero configuración); en producción usa una base de datos Turso gratuita a través de las variables de entorno `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver `.env.example` y [DEPLOY.md](DEPLOY.md)).

## Ideas para ampliar (pendientes, a propósito fuera de alcance por ahora)

- **Multi-vehículo / multi-tarifa**: soportar más de un coche, otra tarifa eléctrica (mercado libre) o comparar con gasolina 95/98.
- **Integración con la API de Tesla** (Tessie, TeslaMate...) para registrar cargas solas en vez de a mano — con sentido en cuanto llegue el coche.
- **Visión financiera más amplia**: coste total de propiedad (TCO) con seguro/mantenimiento/impuestos (la cuota de financiación ya está cubierta), modo "coste por viaje".
- Importar la factura PDF de la luz para contrastar el coste real facturado vs. el PVPC teórico.
