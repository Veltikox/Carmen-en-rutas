# Publicación en GitHub Pages

La versión de GitHub Pages muestra rutas, mapas, ubicación del pasajero (con permiso del navegador) y simulación. No incluye el servidor GPS, autenticación de conductores ni base D1. Las posiciones y tiempos de la simulación no son datos reales.

En **Settings → Pages → Build and deployment → Source**, selecciona **GitHub Actions**. El flujo `.github/workflows/pages.yml` publica automáticamente al actualizar `main`; también se puede ejecutar desde Actions → Publicar en GitHub Pages → Run workflow.

Dirección prevista tras un despliegue exitoso: https://Veltikox.github.io/Carmen-en-rutas/

Para comprobar la versión estática localmente (Node 24 y Python 3):

```sh
node --test tests/*.test.mjs
node scripts/build-pages.mjs
python3 -m http.server 8080 --directory _site
```

El código completo original está incluido. La generación de Pages conserva las rutas relativas de recursos para que funcione bajo `/Carmen-en-rutas/`. No requiere instalar dependencias npm. El modo estático solo se activa en el HTML generado; la versión con servidor conserva su funcionamiento.

---

# Amor X Carmen — pasajeros y conductores

Rutas Costera, Laguna de Términos y Campus III sobre Leaflet/OpenStreetMap, ubicación del pasajero y ubicación de camiones compartida por los conductores.

## Probar en dos dispositivos

1. Abre el sitio en el celular con tu cuenta autorizada. Pulsa **Soy conductor**, elige ruta y unidad y pulsa **Iniciar transmisión GPS**.
2. Acepta el permiso y mantén la página abierta, con la pantalla encendida.
3. En otro dispositivo abre esa ruta y el modo **GPS de conductores**. Se consulta cada 5 segundos. **Ver unidades GPS** centra los camiones.
4. Pulsa **Finalizar transmisión** al terminar. Cerrar solo el diálogo permite continuar transmitiendo; «Conductor · transmisión activa» permite volver a abrirlo.

El alojamiento sigue privado para el propietario. Para más conductores hay que concederles acceso al sitio y añadir sus correos a `DRIVER_ALLOWED_EMAILS` en el servidor. No se cambia automáticamente la audiencia.

## GPS y simulación

En modo GPS se muestran solo posiciones recibidas de teléfonos autorizados. Las lecturas se marcan desactualizadas a los 30 segundos y se ocultan a los 90 segundos. Sin conductores no aparecen camiones ficticios. La simulación conserva los vehículos y tiempos ilustrativos anteriores en un modo separado.

El ETA GPS estima la llegada hasta el punto seleccionado usando distancia por el recorrido, sentido y velocidad reciente. Al usar la ubicación del pasajero, se elige automáticamente una referencia cercana. No se consulta tráfico real ni se predicen tiempos de espera en paraderos. La web no garantiza seguimiento con el teléfono bloqueado o el navegador en segundo plano. La ubicación del pasajero sigue siendo una lectura independiente y no se transmite como ubicación de camión.

## ETA para el pasajero

Pulsa **Usar mi ubicación**: el punto cercano queda seleccionado y se estima la llegada de las unidades que avanzan hacia él. También puedes seleccionar un punto manualmente. La tarjeta muestra la unidad, minutos aproximados y un rango orientativo. El tiempo corresponde al camión hasta ese punto; no incluye la caminata del pasajero. Para Laguna se consideran sus 11 paraderos de referencia; los otros recorridos conservan puntos de referencia pendientes de validar como lugares de ascenso.

Si no hay velocidad o sentido suficientes, aparece «Calculando…». Se distinguen camiones detenidos, unidades que ya pasaron, GPS desactualizado, posiciones fuera del trazado y cruces ambiguos. No se usa una velocidad ficticia para crear un ETA. Las precisiones y rangos son heurísticos, no intervalos estadísticos garantizados. Consulta `docs/ETA.md`.

## Código

| Carpeta o archivo | Función |
| --- | --- |
| `web/` | HTML/CSS/JavaScript, mapas, imágenes y datos de rutas |
| `web/driver.mjs` | Compartir GPS del conductor, como máximo un envío cada 5 segundos |
| `web/live-fleet.mjs` | Consulta y caducidad de las posiciones |
| `web/eta.mjs` | Proyección al recorrido, sentido, velocidad observada y estimaciones de llegada |
| `app/route.ts` | Página HTML original |
| `app/api/fleet/route.ts` | API GET/POST/PUT/DELETE |
| `server/fleet.mjs` | Autorización, sesiones y validación |
| `db/schema.ts` y `drizzle/` | Base D1/SQLite y migraciones |
| `scripts/build-ordered-routes.py` | Generador de rutas en Python |
| `tests/` | Pruebas de rutas, ubicación, conductor y API |

La API usa TypeScript/Vinext sobre Cloudflare Workers. `web/` es la fuente editable; `public/` y `dist/` se generan. El proyecto completo ahora requiere un backend y una base D1: no es suficiente publicar HTML estático.

## Desarrollo local

Probado con Node.js 24.19.0 y pnpm 11.25.0, versión indicada en `package.json`.

```sh
pnpm install --frozen-lockfile
```

Copia `.dev.vars.example` a `.dev.vars` y ejecuta:

```sh
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_wild_zarek.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_mean_red_shift.sql
pnpm run dev
```

Aplica cada migración pendiente una sola vez, en orden. La base local es independiente de la alojada. En desarrollo portable, `/signin-with-chatgpt?return_to=/` habilita la identidad simulada `seedy@sites.test`. Esa simulación no se incluye en producción. Abre el localhost indicado por la terminal.

```sh
pnpm test
```

Para regenerar rutas: `python scripts/build-ordered-routes.py`, revisar `web/` y repetir las pruebas. Python 3.10 o posterior, sin bibliotecas externas. Véase `docs/RECORRIDOS.md` para las limitaciones de los trazados y Calle 37.

## Sesiones y datos

Si una versión anterior mostró «Illegal invocation» al iniciar como conductor, recarga completamente la página para obtener la corrección de los temporizadores del navegador. La prueba de regresión reproduce ese fallo de contexto y comprueba que iniciar y finalizar ya lo conservan correctamente. No indica por sí mismo que el teléfono sea incompatible con GPS.

En el celular abre la URL HTTPS alojada en Chrome o Safari, inicia sesión con la cuenta autorizada, pulsa «Soy conductor» y acepta el permiso de ubicación. El teléfono obtiene y envía las coordenadas automáticamente. Si la unidad está ocupada, finaliza la sesión anterior o elige otra unidad; una sesión desconectada caduca en 90 segundos. Mantén la página abierta y la pantalla encendida durante la transmisión.

Solo las cuentas autenticadas de `DRIVER_ALLOWED_EMAILS` pueden transmitir. Cada dispositivo recibe un token en memoria; el servidor conserva su hash. Una unidad ocupada rechaza otra sesión. Las lecturas fuera de orden o con más de 30 segundos se rechazan.

Solo se conserva la última posición por unidad, con velocidad y rumbo opcionales, sin historial de recorridos. La consulta de pasajeros no incluye nombres, correos ni credenciales. Finalizar borra coordenadas y cierra la sesión. Si se pierde la conexión, la posición deja de mostrarse por caducidad; el último registro puede permanecer en la base hasta finalizar o reasignar la unidad.

El manifiesto declara el binding D1 `DB`. Las variables del servidor se configuran en el alojamiento, nunca en el frontend. Se deben conservar los helpers y la integración `sites()` del starter. Las migraciones alojadas se aplican al publicar.

Se verificaron tipos, compilación, SQL y pruebas automáticas. Sigue pendiente la revisión visual y la transmisión GPS real desde dos dispositivos; las pruebas no solicitan ubicaciones reales.

Leaflet conserva su licencia en `web/vendor/leaflet/LICENSE`. Cartografía y geometría: © OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright. Los carteles los proporcionó el usuario. El mapa requiere internet.
