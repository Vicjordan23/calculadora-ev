# Calculadora EV vs Diesel

Compara el gasto de tu coche diesel actual con el de un Tesla Model Y Standard cargado en casa con tarifa regulada (PVPC), usando precios reales obtenidos automáticamente:

- **Diesel**: API pública del Ministerio para la Transición Ecológica, filtrada a estaciones Ballenoil de Guadalajara y Alcalá de Henares.
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
- Recomienda la franja horaria más barata para cargar, según las horas que necesites.
- Registro de cargas reales: indicas fecha, hora de inicio, duración y batería antes/después (o kWh directos), y calcula el coste real usando el precio de cada hora concreta.
- Ajustes editables: consumos, km/día y capacidad de batería.
- Refresco automático programado: diesel a las 07:00 y 14:00, PVPC de mañana a las 20:35 y 21:00 (por si la publicación se retrasa). Además cada endpoint refresca solo si el dato en caché tiene más de 1h.

Los datos se guardan en SQLite vía [libSQL](https://turso.tech/libsql): en local usa automáticamente un fichero en `data/app.db` (cero configuración); en producción usa una base de datos Turso gratuita a través de las variables de entorno `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` (ver `.env.example` y [DEPLOY.md](DEPLOY.md)).

## Ideas para ampliar

- **Historial y gráficas de ahorro acumulado** a lo largo de meses (ya se guarda el histórico de precios diesel; falta lo mismo para electricidad y un gráfico de evolución).
- **Notificación** (push, email o Telegram) avisando cada noche a las 20:35 de la franja más barata para cargar mañana.
- **Múltiples coches / tarifas**: soportar otra tarifa que no sea PVPC (mercado libre con precio fijo), o comparar con gasolina 95.
- **Detección automática de sesión de carga** si en el futuro conectas la API de Tesla (Tessie, TeslaMate, etc.) en vez de introducir los datos a mano.
- **Modo "coste por viaje"**: en vez de solo la media diaria, calcular un trayecto puntual (ej. viaje largo) con el precio real esperado.
- **Exportar a Excel/CSV** el historial de cargas y ahorro mensual.
- **PWA**: instalar la web como app en el móvil para registrar cargas rápidamente.
- **Comparar con carga rápida fuera de casa** (Supercharger u otros) para los días que no cargues en casa.
