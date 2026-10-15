# Verificación de la corrección del modo conductor

- La prueba de regresión reproduce «Illegal invocation» en la implementación anterior cuando una API del navegador exige su contexto global.
- La corrección conserva el contexto de setInterval, clearInterval y fetch. La prueba pasa al iniciar y finalizar la transmisión.
- 39 pruebas automáticas aprobadas, incluida la regresión, las rutas, GPS, sesiones, permisos y ETA.
- Comprobación TypeScript y compilación aprobadas.
- Se mantuvieron la configuración del servidor, D1 y el acceso privado. No se eliminaron las comprobaciones de cuentas autorizadas.
- No se solicitó una ubicación real ni se crearon posiciones ficticias en la base alojada.
- Sigue pendiente verificar el GPS real y el aspecto en el navegador del teléfono del usuario.

Para probar la corrección: recargar completamente el sitio HTTPS en Chrome o Safari, entrar con la cuenta autorizada, elegir ruta/unidad e iniciar la transmisión. Aceptar el permiso de ubicación. Las coordenadas se capturan automáticamente. Mantener la página abierta y la pantalla encendida.

Entorno de pruebas: Linux, Node.js 24.19.0 y pnpm 11.25.0. Para instalar de cero se necesitan las migraciones 0000 y 0001, en orden y una sola vez. Consulte README.md.
