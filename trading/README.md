# Calendario de trading (PWA)

App web personal para apuntar cada operación del día y ver el resultado mensual en verde y rojo. HTML, CSS y JS puros, sin build. Funciona offline y se instala en el iPhone.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura, metaetiquetas iOS y PWA |
| `styles.css` | Estilo iOS oscuro |
| `app.js` | Lógica: calendario, resumen, registro, copia de seguridad |
| `manifest.json` | Manifest de la PWA |
| `sw.js` | Service worker (caché offline) |
| `icons/icon-180.png`, `icons/icon-512.png` | Iconos |

## Ejecutar en local

```bash
cd trading
python3 -m http.server 8000
# abre http://localhost:8000
```

Para probarlo en el iPhone dentro de la misma wifi: `python3 -m http.server 8000 --bind 0.0.0.0` y abre `http://IP-DE-TU-ORDENADOR:8000`. Sin HTTPS no se registra el service worker ni hay modo offline; para eso, despliega.

## Desplegar gratis con HTTPS

**GitHub Pages**: en el repo, Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)` → Save. La app queda en `https://<usuario>.github.io/plan-your-day/trading/`.

**Netlify**: app.netlify.com → *Add new site* → *Deploy manually* → arrastra la carpeta `trading`. Te da una URL `https://xxxx.netlify.app`.

Al publicar cambios, sube la versión de `CACHE` en `sw.js` (`trading-cal-v2`, …). La nueva versión aparece en la segunda apertura.

## Instalar en el iPhone

1. Abre la URL HTTPS en **Safari**.
2. Botón **Compartir** → **Añadir a pantalla de inicio** → **Añadir**.
3. Ábrela desde el icono: pantalla completa y funciona sin conexión.

## Datos

- Clave única de `localStorage`: `trading-cal`.
- Formato: `{ "version": 1, "trades": [{ "id", "date": "YYYY-MM-DD", "asset", "entry", "exit", "pnl", "note" }], "lastExport" }`. `pnl` va con signo.
- Los datos de la app instalada y los de Safari están **separados**: apunta siempre desde el icono.
- iOS puede borrar los datos si la app no se usa durante semanas. Exporta el JSON de vez en cuando (se guarda en Archivos o iCloud desde la hoja de compartir).
