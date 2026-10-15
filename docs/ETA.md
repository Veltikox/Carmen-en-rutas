# ETA GPS del camión hasta un punto del recorrido

## Uso

1. Un conductor autorizado transmite una unidad en la ruta correcta.
2. El pasajero selecciona esa ruta, activa GPS de conductores y pulsa «Usar mi ubicación».
3. Se selecciona una referencia cercana al pasajero. La tarjeta estima qué unidad puede llegar antes siguiendo el sentido de la ruta. El pasajero puede cambiar manualmente el punto o volver al cercano con «Calcular ETA en este punto».

El tiempo corresponde al camión hasta el punto indicado. La distancia del pasajero a ese punto es una referencia en línea recta: no es un itinerario ni un tiempo a pie. Las coordenadas de paraderos siguen siendo de referencia.

## Método

- Se proyecta la lectura del camión sobre los segmentos de la geometría ordenada. Las distancias acumuladas permiten medir el camino restante por las calles, no la separación en línea recta al pasajero.
- Se usa la velocidad del teléfono en metros por segundo cuando está disponible. Si falta, se observa el avance entre lecturas y se suaviza la velocidad con observaciones anteriores. El estado temporal se conserva únicamente en memoria del navegador del pasajero.
- El rumbo del teléfono y/o el signo del avance ayudan a comprobar el sentido. Una lectura previa ayuda a resolver intersecciones y calles repetidas. Si el tramo sigue ambiguo no se publica un número.
- Tiempo base: distancia restante dividida entre velocidad reciente, convertido a minutos. Se elige el menor ETA disponible entre las unidades que todavía pueden alcanzar el punto en este recorrido abierto. No se agrega una vuelta al origen.
- Se presenta un número redondeado y un rango orientativo con una variación mínima de medio minuto o 25 % del cálculo, además del efecto de la precisión GPS. Ese rango es una heurística de presentación; no es una garantía ni un intervalo de confianza calibrado.

## Condiciones

Para ETA se exigen lecturas del camión de hasta 30 segundos y precisión de 80 metros o mejor. Se rechazan posiciones alejadas de la ruta y saltos de avance incompatibles con el tiempo entre lecturas. Los marcadores pueden seguir visibles hasta 90 segundos, aunque ya no tengan ETA.

Se conserva velocidad cero como detención. Para teléfonos sin velocidad, se espera avance medible o un periodo sin movimiento. No se sustituye un camión detenido por una velocidad configurada ficticia. La primera lectura puede requerir otras lecturas para conocer el sentido.

Cuando la lectura cae aproximadamente dentro de 25 metros del punto (o su margen de precisión, como máximo 40 metros para anunciar cercanía), se muestra 0 min/cerca del punto. Esto describe la última lectura, no confirma un abordaje ni una parada operativa.

La ubicación del pasajero se pide al pulsar el botón, no se almacena en el servidor y debe actualizarse si se desplaza. Para cálculo automático se solicita una lectura de hasta cinco minutos, precisión de 150 metros o mejor y una referencia a menos de un kilómetro; si no se cumple, se explica cómo actualizarla o elegir manualmente un punto.

## Límites

No incorpora tráfico en vivo, semáforos, esperas en paraderos, aceleraciones futuras ni una red operativa validada. La geometría de Calle 37 conserva un tramo aproximado. Una unidad sin estimación puede llegar antes que las que sí tienen datos; la tarjeta lo advierte. El modelo necesita una prueba real en recorrido y calibración con viajes observados.

No se añade un historial de ubicaciones al servidor: la migración 0001 agrega velocidad y rumbo opcionales a la única posición actual de cada unidad. Los clientes anteriores pueden seguir enviando posiciones sin esos campos.

Referencias de los campos del dispositivo: https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/speed y https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/heading.
