# ExDev API

API de ExDev desarrollada con NestJS 10, TypeScript y PostgreSQL mediante `pg`. Sirve contenido público para la web y recibe postulaciones al club.

Este README describe los endpoints implementados en el código local al **25 de septiembre de 2026**, no funcionalidades futuras ni el estado de un despliegue particular.

## Índice

- [Configuración y ejecución](#configuración-y-ejecución)
- [Convenciones y seguridad](#convenciones-y-seguridad)
- [Endpoints disponibles](#endpoints-disponibles)
- [POST /applications](#post-applications)
- [GET /members](#get-members)
- [POST /members](#post-members)
- [GET /projects](#get-projects)
- [POST /projects](#post-projects)
- [GET /events](#get-events)
- [Errores](#errores)
- [Estructura y pruebas](#estructura-y-pruebas)
- [Base de datos y pendientes](#base-de-datos-y-pendientes)

## Configuración y ejecución

Se necesita Node.js/npm, acceso a PostgreSQL y el esquema actualizado de ExDev. No hay ORM ni migraciones automáticas al arrancar.

```sh
npm install
```

Crear `.env` en la raíz del proyecto y configurar los valores del ambiente mediante el canal seguro definido por el equipo. Este README documenta únicamente los nombres y el propósito de las variables; no incluye un bloque de configuración para copiar.

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión de `pg` a la base de datos. |
| `PORT` | Puerto HTTP; el código usa 3000 si se omite. Localmente usar 3001 si el frontend ocupa 3000. |
| `RUT_ENCRYPTION_KEY_VERSION` | Entero positivo que selecciona la versión de la clave de cifrado. |
| `RUT_ENCRYPTION_KEY_V1` | Para versión 1: clave aleatoria de **32 bytes codificados en Base64**. No una contraseña elegida manualmente. Para versión 2 se usa `RUT_ENCRYPTION_KEY_V2`, etc. |


```sh
# Desarrollo con recarga
npm run start:dev

# Compilar y ejecutar la versión compilada
npm run build
npm run start:prod
```

Con `PORT=3001`, la base local es `http://localhost:3001`. Las rutas no llevan prefijo `/api` en NestJS. Cualquier prefijo externo dependerá del proxy del despliegue.

El `docker-compose.yml` usa `/opt/exdev-api/.env` y publica `3001:3000`: dentro del contenedor la API debe escuchar en 3000, no copiar sin revisar el PORT del ejemplo local. El compose consume una imagen; no compila los cambios locales.

## Convenciones y seguridad

- POST: enviar `Content-Type: application/json`. GET: parámetros en la URL, sin body.
- GET exitoso: HTTP **200**. POST exitoso: HTTP **201**. Las listas vacías devuelven 200 con `data: []`.
- `/applications` usa nombres **snake_case**. Los POST `/members` y `/projects` usan **camelCase**. Las respuestas GET conservan nombres del esquema SQL.
- Los IDs `bigint` leídos directamente por `pg` se devuelven como strings. En `projects.miembros`, los IDs se construyen dentro de JSON de PostgreSQL y actualmente llegan como números. No asumir un contrato numérico uniforme ni convertir strings grandes a `Number`.
- Campos opcionales de texto suelen admitir omisión o NULL; el servicio elimina espacios exteriores. No enviar cadenas vacías para campos obligatorios. Los límites de texto de aplicaciones se validan con `.length` de JavaScript; emojis pueden contar como dos unidades.
- El código actual no instala un ValidationPipe global ni rechaza sistemáticamente propiedades extra. Enviar solo los campos documentados.
- CORS local permite `http://localhost:3000` y `http://127.0.0.1:3000`. Antes de usar otro frontend, configurar explícitamente su origen. **CORS no es autenticación.**

**Pendiente de seguridad antes de exponer administración:** los POST `/members` y `/projects` existen, pero no tienen guards IAM en el código actual. Deben protegerse o bloquearse en el despliegue; no tratarlos como endpoints públicos autorizados. No se implementó autenticación, autorización por rol ni limitación de solicitudes en estos controladores.

## Endpoints disponibles

| Método | Ruta | Función | Acceso previsto |
|---|---|---|---|
| POST | `/applications` | Registrar una postulación en el período habilitado. | Formulario público. |
| GET | `/members` | Listar perfiles públicos activos. | Público. |
| POST | `/members` | Crear miembro con roles y especialidades. | Administración; IAM pendiente. |
| GET | `/projects` | Listar proyectos publicados y participantes públicos. | Público. |
| POST | `/projects` | Crear proyecto y sus asociaciones de miembros. | Administración; IAM pendiente. |
| GET | `/events` | Consultar agenda publicada. | Público. |

No hay GET por ID, PUT/PATCH/DELETE, GET de postulaciones, descifrado de RUT ni endpoints de votos, períodos, patrocinadores o catálogos implementados actualmente. Que exista una tabla no implica que exista una ruta.

## POST /applications

### Qué hace

1. Valida los datos y el dígito verificador del RUT; normaliza RUT y correo.
2. Cifra el RUT en la API con AES-256-GCM. La BD recibe bytes cifrados, no el RUT en texto plano.
3. Abre una transacción, selecciona y bloquea el período `habilitado` y comprueba que `fecha_apertura <= ahora < fecha_cierre`.
4. Inserta la postulación con ese período; usa el estado por defecto `pendiente`. Confirma todo o revierte ante un error.

Debe existir un período habilitado dentro de fechas. No se crea automáticamente y no lo selecciona el navegador. No enviar `periodo_id`, `estado_postulacion`, `resuelta_por`, `rut_cifrado` ni `rut_clave_version`: los valores enviados para esos campos no se usan en este POST.

### Body

| Campo | Tipo JSON | Obligatorio | Límites / significado |
|---|---|---|---|
| `nombre_completo` | string | Sí | No vacío; máximo 200. |
| `rut` | string | Sí | Máximo 20 en entrada. Admite puntos; formato normalizado de 1–8 dígitos, guion y dígito/K. Valida módulo 11; no acepta cuerpo cero. |
| `edad` | number entero | No | 16–99. |
| `correo_institucional` | string | Sí | Máximo 150; dominio @utem.cl. Se recorta y convierte a minúsculas. |
| `campus` | string | No | Máximo 50. |
| `carrera` | string | Sí | No vacío; máximo 100. |
| `anio_ingreso` | number entero | No | Año actual de Chile y 10 anteriores, inclusive. En 2026: 2016–2026. |
| `anio_actual` | number entero | No | 1–2.147.483.647; año que cursa. |
| `area_interes1` | string | Sí | No vacío; máximo 80. |
| `area_interes2` | string | No | Máximo 80. |
| `area_interes3` | string | No | Máximo 80. |
| `ayudantias` | string | No | Máximo 1000. |
| `horas_disponibles_semanales` | number entero | No | 0–2.147.483.647; máximo técnico, no recomendación de negocio. |
| `motivo_postulacion` | string | No | Máximo 5000. |
| `proyecto_idea` | string | No | Máximo 5000. |
| `portafolio` | string | No | Máximo 500; no valida que sea URL. |
| `postulacion_conjunta` | string | No | Máximo 500; nombres/referencias, no asociación automática. |
| `pitch` | string | No | Máximo 10000. |
| `apodo` | string | No | Máximo 100. |

Los opcionales aceptan omisión, NULL o texto vacío, que se guarda como NULL. Los enteros también aceptan cadenas de dígitos, aunque se recomienda enviar números JSON. El frontend puede exigir más campos que este contrato mínimo de API. No existe género en este body.

Ejemplo ficticio, solo para staging; actualizar anio_ingreso cuando corresponda:

```json
{
  "nombre_completo": "Persona de prueba",
  "rut": "12.345.678-5",
  "edad": 20,
  "correo_institucional": "prueba@utem.cl",
  "campus": "Macul",
  "carrera": "Ingeniería Civil en Computación Mención Informática",
  "anio_ingreso": 2026,
  "anio_actual": 1,
  "area_interes1": "Backend",
  "area_interes2": "Robótica",
  "area_interes3": null,
  "ayudantias": null,
  "horas_disponibles_semanales": 4,
  "motivo_postulacion": "Quiero aprender desarrollando proyectos en equipo.",
  "proyecto_idea": "Una aplicación para organizar actividades del club.",
  "portafolio": "https://example.com/portfolio",
  "postulacion_conjunta": null,
  "pitch": "Me interesa colaborar en proyectos web.",
  "apodo": null
}
```

Respuesta **201**:

```json
{
  "responseCode": "I001",
  "message": "La postulacion ha sido realizada con exito",
  "idPostulacion": "1"
}
```

### Reglas y cifrado

- El correo es único normalizado **por período**. Repetirlo dentro del mismo período devuelve 409; puede volver a postular en otro.
- No hay deduplicación por RUT en el esquema cifrado actual.
- El cifrado usa un nonce aleatorio de 12 bytes, tag de 16 bytes y ciphertext, concatenados en `rut_cifrado`. AAD: `exdev:postulaciones:rut:v<version>`. `rut_clave_version` indica la clave necesaria para descifrar, no contiene el secreto.
- No se devuelve el RUT, la clave, ciphertext ni detalles de PostgreSQL. No registrar cuerpos del formulario en logs/proxies; usar HTTPS fuera del desarrollo local.
- El cifrado protege el RUT almacenado; no cifra automáticamente nombre, correo ni edad.

## GET /members

```http
GET /members?limit=4
```

| Query | Default | Valores |
|---|---|---|
| `limit` | 4 | Entero de 1 a 100. |

Devuelve miembros con `estado = activo` y `perfil_publico = true`, ordenados por nombre. Solo incluye roles con asignación y catálogo activos, y especialidades activas. No devuelve correo, iam_subject ni información de postulaciones.

`activo` significa que sigue perteneciendo al club, no que participa con frecuencia. Un Titulado que mantiene su vínculo puede estar activo.

Respuesta **200**:

```json
{
  "data": [
    {
      "id": "1",
      "nombre": "Persona de prueba",
      "carrera": "Ingeniería Civil en Computación Mención Informática",
      "anio_ingreso_carrera": 2026,
      "foto_publica": false,
      "roles": ["Miembro activo"],
      "especialidades": ["Backend", "Frontend"]
    }
  ]
}
```

roles y especialidades son arreglos de nombres, no objetos con ID. Pueden estar vacíos. anio_ingreso_carrera puede ser NULL en la BD. foto_publica es una autorización: no hay URL de foto ni storage en esta respuesta. No hay offset, total ni hasMore para miembros.

## POST /members

**Endpoint administrativo todavía sin IAM.** Crea el miembro, sus asignaciones de roles activas y sus especialidades en una sola transacción. Si falla una relación, revierte todo.

### Body

| Campo | Tipo JSON | Obligatorio | Regla / default |
|---|---|---|---|
| `nombre` | string | Sí | No vacío; se recorta. |
| `correoInstitucional` | string | Sí | @utem.cl; se recorta y convierte a minúsculas; único normalizado. |
| `carrera` | string | Sí | No vacía; se recorta. |
| `anioIngresoCarrera` | number entero | Sí | 1900–2100. Este rango no es el del formulario de postulaciones. |
| `iamSubject` | string o null | No | Identidad IAM; no vacío si se proporciona. Default NULL. |
| `estado` | string | No | `activo` o `inactivo`; default activo. |
| `perfilPublico` | boolean | No | Default false. |
| `fotoPublica` | boolean | No | Default false; true exige perfilPublico = true. |
| `roleIds` | array de números enteros | No | IDs existentes de roles, positivos y sin duplicados. Default []; NULL no está admitido. |
| `specialtyIds` | array de números enteros | No | IDs existentes de especialidades, positivos y sin duplicados. Default []; NULL no está admitido. |

Estos textos son `text`, sin límite propio de longitud en el servicio/esquema. El servicio convierte IDs con Number y exige enteros seguros (hasta 9.007.199.254.740.991); preferir números JSON. Hoy comprueba existencia mediante FK, pero no impide asignar un catálogo inactivo. No se crean nuevos roles o especialidades con este POST.

Ejemplo: los IDs 1 y 2 son ilustrativos; verificar los catálogos de la base antes de usarlos.

```json
{
  "nombre": "Persona de prueba",
  "correoInstitucional": "prueba@utem.cl",
  "carrera": "Ingeniería Civil en Computación Mención Informática",
  "anioIngresoCarrera": 2026,
  "iamSubject": null,
  "estado": "activo",
  "perfilPublico": true,
  "fotoPublica": false,
  "roleIds": [1],
  "specialtyIds": [1, 2]
}
```

Respuesta **201**:

```json
{ "message": "Miembro creado correctamente", "id": "1" }
```

No crea una cuenta IAM ni convierte una postulación en aceptada. Aunque algunas columnas sean nullable en SQL, correoInstitucional y anioIngresoCarrera son obligatorios en este endpoint.

## GET /projects

```http
GET /projects?limit=4&featured=true
```

| Query | Default | Valores |
|---|---|---|
| `limit` | 100 | Entero de 1 a 100. |
| `featured` | Sin filtro | `true`: solo destacados; `false`: solo no destacados; omitir: ambos. |

Solo devuelve proyectos publicados, de cualquier estado. Ordena por orden ascendente y created_at descendente. Los participantes incluidos deben ser miembros activos con perfil público; se ordenan por nombre. No hay offset, total ni hasMore.

Respuesta **200**:

```json
{
  "data": [
    {
      "id": "1",
      "nombre": "exdev_website",
      "descripcion_breve": "Página web de ExDev.",
      "descripcion": "Sitio público para presentar el club y sus actividades.",
      "estado": "activo",
      "fecha_inicio": null,
      "fecha_fin": null,
      "destacado": true,
      "miembros": [
        { "id": 1, "nombre": "Persona de prueba", "funcion": "Desarrollo web" }
      ]
    }
  ]
}
```

Las descripciones, fechas y funcion pueden ser NULL; miembros puede ser []. Las fechas no nulas se seleccionan directamente como SQL date: con los parsers por defecto de pg se serializan como timestamps ISO y pueden depender de la zona horaria del proceso. **A diferencia de `/events`, todavía no se normalizan explícitamente a YYYY-MM-DD en este GET.**

## POST /projects

**Endpoint administrativo todavía sin IAM.** Crea un proyecto y sus asociaciones en proyecto_miembros dentro de una transacción. No crea los perfiles de los participantes.

### Body

| Campo | Tipo JSON | Obligatorio | Regla / default |
|---|---|---|---|
| `nombre` | string | Sí | No vacío; sin unicidad del nombre en BD. |
| `descripcionBreve` | string o null | No | Resumen; default NULL. |
| `descripcion` | string o null | No | Detalle; default NULL. |
| `estado` | string | No | Default planificacion; valores debajo. |
| `fechaInicio` | string o null | No | YYYY-MM-DD; default NULL. |
| `fechaFin` | string o null | No | YYYY-MM-DD; no anterior al inicio si ambas existen. |
| `publicado` | boolean | No | Default false. |
| `destacado` | boolean | No | Default false; true exige publicado = true. |
| `orden` | number entero | No | Default 0; menor primero. La BD admite el rango integer de 32 bits, incluidos negativos. |
| `members` | array de objetos | No | Default []; no repetir miembro. |

Todos los textos son `text`, sin máximo específico de longitud. Los textos opcionales vacíos se guardan como NULL. Las fechas se validan primero por formato y después por PostgreSQL; enviar fechas reales, no solo cadenas con apariencia de fecha.

| Estado | Significado |
|---|---|
| `planificacion` | Definición de objetivos, tareas y recursos. |
| `activo` | En ejecución o funcionamiento continuo. |
| `bloqueado` | No puede avanzar por una dependencia o recurso. |
| `pausado` | Detenido temporalmente. |
| `completado` | Objetivo alcanzado y proyecto cerrado. |
| `cancelado` | Cerrado sin completar y sin continuidad prevista. |

Cada objeto de `members`:

| Campo | Tipo JSON | Obligatorio | Regla |
|---|---|---|---|
| `memberId` | number entero | Sí | ID existente, positivo y seguro en JavaScript. |
| `functionName` | string o null | No | Función dentro del proyecto; default NULL. |
| `startDate` | string o null | No | YYYY-MM-DD; default NULL. |
| `endDate` | string o null | No | YYYY-MM-DD; no anterior a startDate si ambas existen. |

Ejemplo (memberId debe existir):

```json
{
  "nombre": "exdev_website",
  "descripcionBreve": "Página web de ExDev.",
  "descripcion": "Sitio público para presentar proyectos, miembros y actividades del club.",
  "estado": "activo",
  "fechaInicio": "2026-09-01",
  "fechaFin": null,
  "publicado": true,
  "destacado": true,
  "orden": 1,
  "members": [
    {
      "memberId": 1,
      "functionName": "Desarrollo web",
      "startDate": "2026-09-01",
      "endDate": null
    }
  ]
}
```

Respuesta **201**:

```json
{ "message": "Proyecto creado correctamente", "id": "1" }
```

## GET /events

```http
GET /events?limit=4&upcoming=true&offset=0
```

| Query | Default | Valores |
|---|---|---|
| `limit` | 20 | Entero de 1 a 100. |
| `upcoming` | `true` | `true`: solo próximos/en curso programados; `false`: toda la agenda publicada. |
| `offset` | 0 | Entero de 0 a 1.000.000; cantidad de filas que se omiten. |

Siempre filtra publicado = true. Con upcoming=true, exige estado programado y que `fecha_fin` (o fecha_inicio si no tiene fin) sea hoy o posterior, según America/Santiago. Los eventos de varios días siguen apareciendo hasta su último día.

Orden: primero eventos cuyo último día no ha pasado, por inicio ascendente; después los pasados, por inicio descendente; ID desempata. Con upcoming=false también pueden aparecer cancelados y finalizados publicados.

Respuesta **200** (evento de ejemplo):

```json
{
  "data": [
    {
      "id": "1",
      "tipo_evento": "feria",
      "titulo_evento": "Feria Vive la Investigación",
      "descripcion": "Exhibición de proyectos y actividades del club · sin inscripción.",
      "fecha_inicio": "2026-10-14",
      "fecha_fin": "2026-10-15",
      "fecha_texto": "14 y 15 OCT",
      "ubicacion": "UTEM — campus Macul",
      "url_evento": null,
      "tipo_accion": "acceso_libre",
      "url_accion": null,
      "estado": "programado"
    }
  ],
  "hasMore": false
}
```

Las fechas se devuelven explícitamente como YYYY-MM-DD, sin conversión a timestamps. Si hasMore=true, pedir la siguiente página con offset + limit. No se devuelve total.

| tipo_accion | Uso en frontend | url_accion |
|---|---|---|
| `postulacion` | Botón “Postularse”. | Obligatoria; `/apply` para el club o enlace externo. |
| `inscripcion` | Botón “Inscribirse”. | Obligatoria. |
| `acceso_libre` | Texto “Abierto a todos”. | NULL. |
| NULL | Sin acción. | NULL. |

tipo_evento clasifica la actividad (feria, charla, taller, curso, etc.); no decide el botón. estado admite programado/cancelado/finalizado. El frontend oculta acciones de eventos pasados/cancelados y valida los enlaces; el GET entrega los datos guardados, no modifica estados ni abre períodos de postulación.

La lista actual muestra título, descripción y etiqueta de fecha. ubicacion y url_evento se conservan para un futuro detalle, pero no se muestran en esa lista. Si fecha_texto es NULL, el frontend genera la etiqueta desde las fechas.

## Errores

### Postulaciones

Los errores de negocio de `/applications` usan este formato:

```json
{
  "responseCode": "E004",
  "message": "No hay un período de postulaciones abierto"
}
```

| HTTP | responseCode | Causa |
|---|---|---|
| 400 | E002 | Campo inválido, RUT incorrecto, correo no institucional o restricción de datos. |
| 409 | E001 | Correo ya registrado en el mismo período. |
| 409 | E004 | No hay un único período habilitado o está fuera de fechas. |
| 500 | E003 | Error interno, conexión/esquema incompatible o configuración de cifrado inválida. |

Un JSON mal formado puede fallar antes de llegar al servicio y usar el formato general de NestJS.

### Miembros, proyectos y eventos

Usan excepciones HTTP estándar de NestJS, por ejemplo:

```json
{
  "message": "limit debe ser un entero entre 1 y 100",
  "error": "Bad Request",
  "statusCode": 400
}
```

| HTTP | Situación |
|---|---|
| 400 | Parámetro/body inválido; en POST de miembros/proyectos también algunas restricciones o referencias inexistentes. |
| 409 | Conflicto de unicidad al crear miembro/proyecto o asociaciones. No significa que el nombre del proyecto sea único. |
| 500 | Error no clasificado o fallo de BD. |
| 404 | Ruta no implementada. |

No todos los errores SQL de miembros/proyectos se traducen a 400: enviar valores fuera del rango técnico de la BD puede terminar en 500. No depender de mensajes exactos de validación para la lógica del cliente; comprobar el estado HTTP y, en aplicaciones, responseCode.

## Estructura y pruebas

```text
src/
  applications/        POST de postulaciones, validación y cifrado de RUT
  members/             Lectura pública y creación de miembros
  projects/            Lectura pública y creación de proyectos
  events/              Lectura pública de agenda
  shared/connections/  Pool PostgreSQL (PG_POOL)
  common/              Utilidades comunes
  app.module.ts        Registro de módulos
  main.ts              Arranque, CORS y puerto
```

Los controladores reciben HTTP y delegan a servicios. Los servicios validan entradas y ejecutan SQL parametrizado. Los POST con asociaciones usan una transacción y liberan su conexión. No interpolar valores del usuario en SQL.

```sh
# Comprobación TypeScript sin generar dist
npx tsc --noEmit --incremental false

# Pruebas unitarias
npm test -- --runInBand

# Cobertura
npm run test:cov -- --runInBand
```

Hay pruebas de aplicaciones y eventos con pool simulado; no sustituyen pruebas de integración sobre staging. El script test:e2e del package.json referencia una configuración que no está incluida actualmente; no asumir que existe una suite E2E operativa. Los scripts lint y format modifican archivos: revisar el diff después de usarlos.

## Base de datos y pendientes

Los scripts y el diccionario de columnas se mantienen fuera del repositorio, en la carpeta de documentación del equipo `Knowledge/Software/ExDev`:

- `MASTER - Modelo de datos ExDev.md`: columnas, tipos, límites, relaciones y significados de negocio.
- `001_miembros_proyectos.sql`: esquema inicial consolidado. No ejecutarlo sobre tablas existentes ni usarlo como actualización incremental.
- `002_datos_iniciales_miembros_proyectos.sql`: datos iniciales de miembros/proyectos.
- `Postulaciones - cifrado y despliegue.md`: operación y gestión de claves.

Solicitar esos documentos al equipo al incorporarse. Un push del código no ejecuta scripts SQL. El nuevo POST requiere periodos_postulacion y las columnas periodo_id, rut_cifrado y rut_clave_version; es incompatible con el esquema antiguo que guardaba rut en texto.

Antes de desplegar: validar el esquema de staging, coordinar cambios de BD/API, configurar secretos y CORS, proteger los POST administrativos y verificar un período habilitado para probar postulaciones. No incluir datos reales en ejemplos o pruebas.

Pendientes de implementación: IAM, administración Rafael, edición y cierre de períodos, votaciones editables hasta su plazo, resolución de postulaciones, patrocinadores, detalle de eventos y storage. No hay endpoints para estas funciones salvo los seis documentados arriba.
