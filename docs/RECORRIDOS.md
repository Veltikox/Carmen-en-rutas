# Amor X Carmen

Sitio HTML/CSS/JavaScript con Leaflet y cartografía de OpenStreetMap. Se publica `web/` sin compilación.

## Fuente y orden de las rutas

La lista de calles y paraderos que el usuario proporcionó el 15 de octubre de 2026 es la fuente vigente. Tiene prioridad sobre los carteles y sobre las reconstrucciones anteriores.

| Ruta | Color | Inicio | Final | Entradas ordenadas |
| --- | --- | --- | --- | --- |
| Costera | Rosa #ca3d83 | Calle 22 | Av. Constelación | 9 |
| Laguna de Términos | Verde #188574 | Paradero Mercado AFA | Calle 39 | 30: 11 paraderos y 19 calles |
| Campus III | Azul #4e65cf | Calle 31 | Campus III | 13 |

Las rutas son recorridos abiertos. No se agrega un regreso al origen ni se invierte el orden de la lista. En la demo los vehículos se detienen al final; no reaparecen como llegadas futuras después de haber pasado por un punto. El botón Reiniciar demo reinicia la reproducción. Al abrir una ruta se encuadra su geometría completa. Ver las tres rutas es opcional.

La lista de paraderos de Laguna de Términos se distingue de sus calles de tránsito en el selector y la lista lateral. Las posiciones de los paraderos siguen siendo de referencia, especialmente Parque del Pescador y Capilla San Judas Tadeo; el usuario aportó sus nombres y orden, no coordenadas GPS.

## Intersecciones y nombres alternativos

El generador une nodos reales compartidos por las calles, considera `name` y `alt_name` y conecta los cambios de calzada mediante los cruces de la red. Ejemplos: Calle 47 / Páez Urquidi, Avenida 10 de Julio / Luis D. Colosio, Calle 31 / Aviación, y Abasolo / Laguna de Términos. Las continuaciones de un corredor pueden tener otra etiqueta en OpenStreetMap.

Los tramos entre paraderos pueden incluir calles de aproximación: una lista de paraderos no es una lista exhaustiva de todas las calles de acceso. Las conexiones y nombres atravesados quedan auditados en `scripts/ordered-route-report.json`. No se certifican sentidos legales ni giros de conducción: es un trazado de visualización, pendiente de validación operativa.

## Continuación de Calle 37

La red OSM disponible no conecta la continuación de Calle 37 por la ribera sur hasta Boquerón del Palmar. El cartel y la lista del usuario sí indican esa continuidad. Se conserva como una línea punteada de referencia con extremos conectados, registrada en `source-data/manual-corrections.json`, y se señala expresamente como pendiente de confirmación GPS. No debe tratarse como geometría verificada.

## Simulación, mapas y datos locales

Camiones y tiempos son simulados, sin GPS ni tráfico real, a velocidad ×10. Las duraciones configuradas son ilustrativas. Leaflet 1.9.4 y su licencia están incluidos localmente. Las teselas se solicitan a OpenStreetMap por HTTPS con atribución visible, caché y Referer normales. No hay descarga masiva ni precarga offline; el proveedor es configurable en `web/maps-config.mjs`. El mapa necesita internet y el servicio no garantiza disponibilidad.

Los favoritos se guardan en el navegador con una versión de datos nueva para evitar asociar favoritos antiguos a otros paraderos. Se cargan cartografía de OpenStreetMap y tipografías de Google Fonts. Los carteles originales se conservan en `web/references/` como referencia complementaria.

## Ubicación del pasajero

El botón «Usar mi ubicación» pide una lectura mediante `navigator.geolocation.getCurrentPosition`, solo después de pulsarlo. Requiere HTTPS o localhost y permiso del navegador. `web/geolocation.mjs` controla los estados, valida coordenadas y gestiona permiso bloqueado, posición no disponible y timeout. Solicita alta precisión, espera de adquisición de 15 segundos y admite una lectura en caché de hasta 30 segundos. No hay seguimiento continuo, ni almacenamiento de coordenadas, ni coordenadas en los enlaces compartidos. Al mostrar la zona, Leaflet solicita sus teselas al proveedor cartográfico.

Una capa independiente muestra la posición azul y el radio de precisión, y permanece al cambiar de ruta. «Actualizar ubicación» obtiene otra lectura; «Centrar en mí» vuelve a ella y «Quitar ubicación» borra la lectura de la aplicación e ignora respuestas tardías. No revoca el permiso concedido en el navegador.

Se propone la referencia más cercana de la ruta seleccionada por distancia en línea recta: para Laguna se consideran sus 11 paraderos; para Costera y Campus III se usan los puntos de referencia actuales, sin presentarlos como paraderos verificados. No se dibuja un itinerario peatonal ni se calculan tiempos a pie. El acceso y lugar de ascenso requieren validación. Los camiones y sus tiempos siguen siendo simulados.

Pruebas: `node --test tests/*.test.mjs`. La geolocalización se comprueba con una API de prueba; no se solicitó la ubicación real del usuario durante la verificación. La prueba manual del permiso y del marcador en un navegador real sigue pendiente.

## Regenerar

- `scripts/ordered-route-input.json`: lista vigente en el orden exacto del usuario, nombres alternativos y zonas de búsqueda.
- `scripts/build-ordered-routes.py`: generador de geometrías abiertas y metadatos; usa Python y la biblioteca estándar.
- `scripts/ordered-route-report.json`: conexiones y métricas auditables.
- `source-data/roads.osm.json.gz`: red vial fuente, © OpenStreetMap contributors, licencia ODbL: https://www.openstreetmap.org/copyright.
- `source-data/manual-corrections.json`: continuación aproximada no verificada de Calle 37.
- `source-data/poster-reference-trace.json`: digitalización anterior de carteles, archivada; no define las rutas actuales.
- `web/routes-geo.mjs` y `web/route-metadata.mjs`: resultados utilizados por la web.

Ejecutar `python scripts/build-ordered-routes.py`. Los visitantes no hacen llamadas a servicios de ruteo.
