# Poner la calculadora accesible desde casa y desde el móvil

Vamos a usar 3 servicios gratuitos que **no piden tarjeta de crédito**:

| Servicio | Para qué | Coste |
|---|---|---|
| [Turso](https://turso.tech) | Base de datos (precios, historial de cargas) | Gratis |
| [Render](https://render.com) | Ejecutar la app en internet | Gratis |
| [GitHub Actions](https://docs.github.com/actions) | "Despertar" la app y refrescar precios a su hora | Gratis (viene con tu repositorio) |

El plan gratuito de Render "duerme" la app tras 15 min sin uso (tarda ~25-50s en despertar la primera vez que la abres). Por eso los datos van en Turso (que no depende de si Render está dormido) y una tarea programada de GitHub Actions es quien la despierta a las horas clave para refrescar precios aunque tú no la estés usando.

No puedo crear estas cuentas por ti (necesitan tu email/verificación), pero aquí tienes cada paso.

---

## 1. Crear la base de datos en Turso

1. Entra en https://turso.tech y crea una cuenta gratis (puedes entrar con GitHub).
2. En el dashboard, crea una base de datos nueva (botón "Create Database"). Ponle un nombre, por ejemplo `calculadora-ev`.
3. Dentro de la base de datos, busca:
   - **Database URL** (empieza por `libsql://...`)
   - Crea un **token** (botón "Create Token" o similar) — es una clave larga.
4. Guarda esos dos valores, los necesitas en el paso 3.

## 2. Subir el proyecto a GitHub

El proyecto ya tiene un repositorio git local con el primer commit hecho. Solo falta subirlo:

1. Entra en https://github.com/new y crea un repositorio nuevo (puede ser privado), por ejemplo `calculadora-ev`. No añadas README ni .gitignore desde GitHub (ya los tenemos).
2. En tu terminal, dentro de la carpeta del proyecto:

```bash
git remote add origin https://github.com/TU_USUARIO/calculadora-ev.git
git branch -M main
git push -u origin main
```

(Sustituye `TU_USUARIO` por tu usuario de GitHub. Te pedirá iniciar sesión la primera vez.)

## 3. Desplegar en Render

1. Entra en https://render.com y crea una cuenta gratis (puedes entrar con GitHub, así se conecta solo).
2. Dashboard → **New** → **Web Service**.
3. Elige el repositorio `calculadora-ev` que acabas de subir.
4. Configura:
   - **Name**: `calculadora-ev` (o lo que quieras — será parte de tu URL)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Antes de darle a "Create", despliega la sección **Environment Variables** y añade:
   - `TURSO_DATABASE_URL` = la URL que copiaste de Turso
   - `TURSO_AUTH_TOKEN` = el token que copiaste de Turso
6. Dale a **Create Web Service**. Tardará 1-2 minutos en desplegar.
7. Cuando termine, te da una URL tipo `https://calculadora-ev.onrender.com`. Ábrela — es tu app, ya accesible desde cualquier sitio (casa, móvil con datos móviles, etc.), no solo desde este PC.

## 4. Programar los refrescos automáticos (GitHub Actions)

Como Render gratis se duerme, necesitamos que algo externo llame a la app a las horas clave. El repositorio ya incluye `.github/workflows/refresh.yml`, que GitHub ejecuta solo: **no hay que crear cuentas ni configurar nada más** (si subiste el proyecto a GitHub en el paso 2, ya está). Hace esto:

- **Diésel** (`POST /api/diesel/refresh`): dos veces al día, sobre las 07:17 y las 14:17 de Madrid.
- **PVPC de mañana** (`POST /api/electricity/refresh-manana`): cada 10 minutos entre las ~20:00 y las ~22:50 de Madrid. REE publica los precios de mañana entre las ~20:15 y las ~20:45 y no hay hora exacta; en cuanto están guardados, las siguientes ejecuciones no hacen nada. Si aún no están publicados responde 200 con `"ok":false` (no es un fallo).
- Las horas del fichero van en UTC y los rangos cubren horario de verano e invierno.
- Si la app tarda en despertar (~25 s) o responde con un error, **reintenta hasta 5 veces con 20 s de espera**.

Para probarlo a mano: pestaña **Actions** del repositorio → **Refrescar precios** → **Run workflow**. Verás en el registro las respuestas de la app.

Notas:
- GitHub a veces retrasa las tareas programadas 5-15 minutos; no importa.
- Si el repositorio pasa 60 días sin ninguna actividad, GitHub puede pausar las tareas programadas (repositorios públicos): se reactivan desde la pestaña Actions.
- Si una ejecución falla, GitHub te avisa por email.
- Para ver a qué hora aparecen realmente los precios cada día: `https://calculadora-ev.onrender.com/api/electricity/diagnostico`.

> **Por qué no cron-job.org:** se probó y no sirve para esto. Render responde **HTTP 429 (Too Many Requests)** a las peticiones programadas de cron-job.org en cuanto las recibe, antes de llegar a la app (la prueba manual desde su consola sí funcionaba, las programadas no). Tras unos días de 429 seguidos, cron-job.org desactiva el job. No se arregla con ajustes (ni timeout ni frecuencia).

Con esto, aunque tú no abras la app, los precios se mantienen actualizados solos.

### Si los precios dejan de actualizarse

1. Abre la pestaña **Actions** del repositorio en GitHub y mira las últimas ejecuciones de **Refrescar precios**: si salen en rojo, el registro dice qué respondió la app (por ejemplo un 429 o un 5xx de Render). Puedes lanzarla a mano con **Run workflow**.
2. Mientras las tareas estén caídas la app no se rompe: al abrirla (y en cada ping) rellena sola los fines de semana recientes que falten, así que los números vuelven a ser correctos en cuanto la abres. Lo único que no puede hacer sola es tener el precio de **mañana** antes de que alguien la abra después de las 20:30.
3. Para ver a qué hora y con qué resultado se han descargado los precios: `https://calculadora-ev.onrender.com/api/electricity/diagnostico` (guarda los últimos 40 intentos).

## 5. Usarla desde el móvil como si fuera una app

1. Abre `https://calculadora-ev.onrender.com` en el navegador del móvil (Chrome/Safari).
2. Menú del navegador → **"Añadir a pantalla de inicio"** (Android) o **"Compartir" → "Añadir a inicio"** (iPhone).
3. Te queda un icono como una app normal. Sigue siendo una web, pero se abre a pantalla completa.

---

## Actualizar la app en el futuro

Cada vez que quieras subir un cambio de código:

```bash
git add -A
git commit -m "descripción del cambio"
git push
```

Render vuelve a desplegar solo en cuanto detecta el push a GitHub (puede tardar 1-2 min).

## Cuando quieras dejar de depender de que Render "duerma"

Si más adelante te compras un Raspberry Pi o similar para tener casa, puedes mover la misma app allí sin tocar código: simplemente no defines `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (usará un fichero SQLite local) o los mantienes (sigue usando Turso) y ejecutas `npm start` directamente en el Pi, dejándolo siempre encendido. En ese caso los cron internos de `server.js` (que ya están programados a las mismas horas) hacen innecesaria la tarea de GitHub Actions.
