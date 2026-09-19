# Piano Tutorial App — Plan de Escalamiento y Comercialización

## 1. Resumen ejecutivo

La aplicación ya superó la etapa inicial de prueba de concepto.

Actualmente existe un MVP funcional capaz de realizar el siguiente flujo:

```text
Audio de piano
→ carga del archivo
→ trabajo en cola
→ High-Resolution Piano Transcription
→ notas normalizadas
→ generación del tutorial
→ visualización falling-notes
→ reproducción sincronizada
```

El siguiente objetivo **no es rehacer el producto**, sino evolucionar el MVP actual hacia un producto comercial pequeño, capaz de atender usuarios reales de forma segura y con costos controlados.

Las prioridades inmediatas son:

1. validar la ejecución del modelo en GPU cloud,
2. eliminar la dependencia de la computadora personal del desarrollador,
3. preparar almacenamiento y hosting para producción,
4. reforzar la confiabilidad del sistema,
5. definir límites de uso y monetización,
6. mejorar presentación, UI y branding,
7. lanzar una beta controlada,
8. medir el uso real antes de escalar más.

La estrategia debe seguir siendo incremental. Ninguna decisión importante de infraestructura debe considerarse definitiva hasta validarla con datos reales.

---

# 2. Estado actual del producto

La implementación actual ya incluye los componentes técnicos más importantes.

## Modelo de IA actual

**High-Resolution Piano Transcription**

Implementación:

```text
piano_transcription_inference 0.0.6
```

Checkpoint:

```text
CRNN_note_F1=0.9677_pedal_F1=0.9186.pth
```

Tamaño aproximado:

```text
165 MB
```

Runtime:

```text
PyTorch 2.11.0 + CUDA 12.8
```

El modelo se carga de forma perezosa en la primera transcripción y permanece cargado dentro del proceso del worker.

---

# 3. Rendimiento medido actualmente

Hardware actual:

```text
NVIDIA RTX PRO 2000 Blackwell Laptop GPU
VRAM: ~8 GB
```

Consumo observado:

```text
VRAM pico:        ~0.36–0.40 GB
RAM del proceso:  ~1.8 GB
```

Transcripción típica:

```text
Duración del audio:        ~2:45–3:15
Inferencia:                ~27–35 segundos
Pipeline total en caliente:~35–45 segundos
Pipeline total en frío:    ~45–60 segundos
Carga del modelo:          ~6–19 segundos
```

Una prueba con una pieza de 6 minutos requirió aproximadamente:

```text
56 segundos de inferencia
~75 segundos totales en frío
```

Esto demuestra que el modelo corre varias veces más rápido que tiempo real en la GPU actual.

También demuestra algo muy importante: **el consumo de VRAM es muy bajo** en comparación con la capacidad de las GPUs cloud habituales.

---

# 4. Arquitectura actual

Arquitectura implementada actualmente:

```text
                    USUARIO
                      │
                      ↓
             ┌─────────────────┐
             │ Next.js / React │
             │ Aplicación Web  │
             └────────┬────────┘
                      │
                      ↓
              ┌──────────────┐
              │   Supabase   │
              │              │
              │ Auth         │
              │ PostgreSQL   │
              │ Storage      │
              └──────┬───────┘
                     │
                     │ tabla requests
                     ↓
              ┌──────────────┐
              │ Python Worker│
              │              │
              │ PC actual    │
              │ GPU          │
              └──────┬───────┘
                     │
                     ↓
          High-Resolution Piano Model
                     │
                     ↓
            notes / MIDI / playback
                     │
                     ↓
                 Supabase
```

Comportamiento actual del worker:

- consulta Supabase aproximadamente cada 15 segundos,
- reclama de forma atómica la solicitud más antigua con estado `queued`,
- procesa un trabajo de GPU a la vez,
- actualiza el estado del job,
- almacena los resultados,
- mantiene el modelo cargado entre trabajos.

La arquitectura ya permite varios workers porque el reclamo del job es atómico.

---

# 5. Stack tecnológico actual

## Frontend

```text
Next.js 15
React 19
Canvas 2D
```

Actualmente el frontend cloud está desplegado en Vercel.

## Backend / servicios locales

```text
FastAPI
Python 3.12
```

La API local actualmente maneja:

- jobs locales,
- biblioteca,
- publicación,
- panel de cola,
- funciones auxiliares de desarrollo.

## IA / audio

```text
PyTorch
CUDA
High-Resolution Piano Transcription
FFmpeg
decodificación a 16 kHz
```

## Persistencia

Cloud:

```text
Supabase Auth
Supabase PostgreSQL
Supabase Storage
```

Local:

```text
SQLite
```

---

# 6. Objetivo de evolución del producto

La aplicación debe pasar de:

> Aplicación personal que depende parcialmente de la computadora del desarrollador

a:

> Producto web público donde cualquier usuario pueda crear tutoriales de piano sin depender de la PC del desarrollador.

Flujo objetivo:

```text
Usuario
 ↓
Web App
 ↓
Upload
 ↓
Cola
 ↓
GPU Serverless
 ↓
Transcripción
 ↓
Object Storage
 ↓
Tutorial
```

La primera versión comercial debe seguir siendo una **aplicación web / PWA**.

No es necesario publicar todavía en App Store ni Google Play.

---

# 7. Arquitectura objetivo propuesta

Dirección preferida actualmente:

```text
                   USUARIO
                    │
                    ↓
          ┌────────────────────┐
          │ Cloudflare Pages   │
          │ o equivalente      │
          │                    │
          │ Next.js Web App    │
          └─────────┬──────────┘
                    │
             ┌──────┴───────┐
             │              │
             ↓              ↓
     ┌─────────────┐   ┌────────────┐
     │  Supabase   │   │Cloudflare R2│
     │             │   │            │
     │ Auth        │   │audio       │
     │ PostgreSQL  │   │notes JSON  │
     │ Queue       │   │MIDI        │
     │ Credits     │   │playback    │
     └──────┬──────┘   └─────┬──────┘
            │                │
            │ jobs queued    │
            ↓                │
     ┌────────────────┐      │
     │ Modal /        │←─────┘
     │ Serverless GPU │
     │                │
     │ Python Worker  │
     │ PyTorch        │
     │ HR Piano Model │
     └───────┬────────┘
             │
             ↓
       resultados generados
             │
             ↓
        Cloudflare R2
```

Esta arquitectura representa un **objetivo actual**, no una decisión irrevocable.

---

# 8. Por qué Cloudflare R2

Supabase Storage funciona bien para el MVP, pero no es la mejor opción para almacenamiento de audio a mayor escala.

Tamaños reales observados:

```text
MP3 ~2 MB para ~3 min
playback.m4a ~3 MB
notes.json ~0.1 MB
MIDI ~0.005 MB
```

Una canción puede ocupar aproximadamente:

```text
~5 MB
```

si se conservan tanto el archivo subido como el archivo de playback.

Escala aproximada:

```text
1,000 canciones   → ~5 GB
10,000 canciones  → ~50 GB
```

Por eso, Cloudflare R2 es un buen candidato para archivos pesados, mientras Supabase se mantiene para:

```text
autenticación
base de datos
RLS
usuarios
jobs
créditos
suscripciones
metadata
```

---

# 9. Principal candidato para GPU cloud

La primera opción a probar será:

**Modal**

No porque la arquitectura dependa de Modal, sino porque el workload actual encaja muy bien con un modelo serverless.

Características actuales:

```text
~0.4 GB de VRAM pico
~1.8 GB RAM
~165 MB modelo
~30 s inferencia
~40 s pipeline caliente
Dockerizable
Sin dependencias específicas de Windows
```

Por el momento no se necesita:

```text
cluster GPU
Kubernetes
multi-GPU
GPU VM permanente
```

Un solo contenedor serverless puede ser suficiente para una primera versión comercial.

---

# 10. Fase A — Prueba de concepto en Modal

## Objetivo

Confirmar que el worker actual puede ejecutar correctamente la transcripción en Modal sin rediseñar la aplicación.

Esta fase es únicamente un laboratorio.

Todavía no se migra producción.

## GPUs a probar

Primero:

```text
NVIDIA T4
NVIDIA L4
```

Usar exactamente el mismo audio en ambas.

Audio recomendado:

```text
una grabación representativa
3–4 minutos
ya utilizada previamente durante el desarrollo
```

## Métricas

Medir únicamente:

```text
cold start del contenedor
carga del modelo
tiempo de inferencia
tiempo total
costo real
```

Calcular:

```text
costo por transcripción exitosa
```

La decisión debe tomarse según **costo por canción completada**, no sólo precio por hora de GPU.

## Criterios de éxito

La prueba se considera exitosa si:

- el modelo funciona,
- FFmpeg funciona,
- el checkpoint carga correctamente,
- el resultado coincide con el worker local,
- la latencia es aceptable,
- el costo por canción sigue siendo comercialmente bajo.

---

# 11. Fase B — Migración del worker a la nube

Una vez validado Modal:

## Objetivo

Sustituir:

```text
Supabase Queue
      ↓
PC del desarrollador
```

por:

```text
Supabase Queue
      ↓
Cloud GPU Worker
```

sin cambiar la experiencia del producto.

El frontend no debe saber si el procesamiento ocurre localmente o en la nube.

## Tareas

- preparar runtime o contenedor del worker,
- garantizar disponibilidad del checkpoint,
- configurar variables de entorno,
- conectarse de forma segura a Supabase,
- conectarse a R2,
- reclamar jobs queued,
- procesar audio,
- subir resultados,
- actualizar estados,
- preservar el mismo formato de transcripción.

---

# 12. Fase C — Migración de almacenamiento a Cloudflare R2

## Objetivo

Mover los archivos pesados desde Supabase Storage hacia R2.

Estructura sugerida:

```text
users/
  <user-id>/
    songs/
      <song-id>/
        source.*
        playback.m4a
        notes.json
        transcription.mid
```

La estructura final puede cambiar.

## Política de retención futura

Posible estrategia:

```text
archivo original
→ conservar temporalmente
→ generar playback + transcripción
→ eliminar original después de cierto tiempo
```

Sólo debe implementarse después de confirmar que ninguna funcionalidad depende del archivo original.

---

# 13. Fase D — Hosting del frontend

Actualmente el frontend está en Vercel.

Antes de la salida comercial se debe decidir entre:

```text
Vercel en plan apto para uso comercial
```

o:

```text
Cloudflare Pages / Workers
```

Cloudflare es actualmente el candidato preferido porque el proyecto probablemente utilizará R2.

La migración no es necesaria antes de validar la GPU cloud.

---

# 14. Fase E — Endurecimiento para producción

El MVP funciona, pero la versión comercial necesita protecciones adicionales.

## Reintentos automáticos

Comportamiento actual:

```text
job
 ↓
error
 ↓
failed
```

Comportamiento objetivo:

```text
job
 ↓
error
 ↓
retry
 ↓
retry
 ↓
error definitivo
```

Configuración inicial recomendada:

```text
máximo 3 intentos
```

Usar backoff controlado o exponencial.

---

# 15. Mejoras de la cola

Polling actual:

```text
~15 segundos
```

Esto puede añadir hasta 15 segundos de espera antes de empezar a procesar.

Para una beta inicial es aceptable.

Objetivo posterior:

```text
2–5 segundos
```

o un mecanismo basado en eventos.

No se debe rediseñar la cola antes de necesitarlo realmente.

---

# 16. Rate limiting

Antes del lanzamiento público se deben agregar límites para:

```text
intentos de login
uploads
creación de tutoriales
creación de jobs
endpoints sensibles
```

El rate limiting debe proteger:

- infraestructura,
- abuso del free tier.

Cloudflare puede ser parte de esta capa.

---

# 17. Estrategia del modo gratuito

El free tier **no debe entregar una canción completa**.

Propuesta inicial:

```text
PREVIEW GRATIS

primeros 60 segundos
de una canción
```

Alternativa:

```text
30 segundos
```

Recomendación inicial:

```text
60 segundos
```

porque permite al usuario evaluar bien la calidad del tutorial.

## Procesamiento real de la preview

Idealmente, el backend debe procesar sólo el fragmento gratuito.

No conviene transcribir una canción de 10 minutos para después enseñar únicamente un minuto.

Flujo:

```text
canción subida
    ↓
extraer primeros 60 segundos
    ↓
AMT
    ↓
preview gratuita
```

Esto reduce:

```text
costo GPU
tiempo
abuso
almacenamiento
```

---

# 18. Protección contra abuso del trial

La primera versión no necesita fingerprinting excesivamente agresivo.

Protecciones iniciales:

```text
email verificado
Cloudflare Turnstile / CAPTCHA
rate limiting
trial asociado a la cuenta
```

Más adelante:

```text
heurísticas por IP
device signals
hash de archivos
audio fingerprint
```

No bloquear automáticamente por IP porque varias personas legítimas pueden compartirla.

---

# 19. Oportunidad de deduplicación

Optimización futura:

```text
audio
 ↓
fingerprint
 ↓
¿ya existe transcripción compatible?
 ├─ SÍ → reutilizar
 └─ NO → ejecutar GPU
```

La identidad del cache debe incluir como mínimo:

```text
audio fingerprint
versión del modelo
configuración de transcripción
```

No es obligatorio para la primera beta.

---

# 20. Dirección inicial de precios

La estrategia de precios debe priorizar adopción y prueba del producto.

## Free

```text
$0
preview de 60 segundos
```

## Mini Pack

```text
$2.99
5 tutoriales completos
pago único
créditos sin vencimiento
```

Este debe ser el producto de menor fricción para convertir usuarios gratuitos en clientes.

## Practice

Hipótesis inicial:

```text
$5.99 / mes
20 tutoriales completos / mes
```

## Plus

Hipótesis:

```text
$8.99 / mes
50 tutoriales completos / mes
```

Estos precios son experimentales.

---

# 21. Por qué créditos y no tiempo de uso

La acción costosa es:

```text
crear una transcripción
```

Una vez creado el tutorial, reproducirlo cuesta muy poco.

Por eso los límites deben expresarse en:

```text
créditos de tutorial/transcripción
```

y no en:

```text
minutos usando la plataforma
uso diario
uso semanal
```

Reproducir un tutorial existente no debe consumir créditos adicionales.

---

# 22. Reglas de créditos

## Packs de compra única

```text
no vencen
```

## Créditos de suscripción

Inicialmente:

```text
se reinician cada ciclo
no se acumulan
```

Esto simplifica la implementación.

Puede cambiarse después según el comportamiento real de los usuarios.

---

# 23. Límite de duración por canción

También deben existir límites razonables.

Propuesta:

```text
Free:
primeros 60 segundos

Pago:
máximo 10 minutos por canción
```

Esto evita que un único crédito sea utilizado para un archivo extremadamente largo.

---

# 24. Modelo de billing

Más adelante el sistema debería manejar un ledger de créditos.

Conceptualmente:

```text
users
plans
subscriptions
credit_transactions
```

Tipos de transacción:

```text
purchase
subscription grant
transcription consumption
refund
admin adjustment
```

A largo plazo es mejor un ledger append-only que simplemente modificar un número de créditos.

---

# 25. Proveedor de pagos

La elección del proveedor debe hacerse después de:

```text
validar Modal
definir arquitectura final de producción
```

Se puede considerar un:

```text
Merchant of Record
```

para simplificar impuestos y ventas internacionales.

No implementar pagos durante la fase de benchmark de GPU.

---

# 26. Fase F — Mejora UI/UX para producción

La aplicación ya es funcional.

El siguiente pase de UI debe enfocarse en conversión y claridad, no en rediseñar todo.

Pantallas prioritarias:

```text
landing page
signup/login
dashboard
crear tutorial
estado de procesamiento
visor del tutorial
créditos / billing
```

Estados importantes:

```text
uploading
queued
processing
completed
failed
sin créditos
```

El usuario siempre debe entender qué está ocurriendo.

---

# 27. Fase de branding

Después de validar la viabilidad cloud:

Crear:

```text
nombre del producto
logo
sistema de color
tipografía
dominio
usuarios/redes sociales
```

Reservar nombres cuando sea posible en:

```text
Instagram
TikTok
YouTube
X
Facebook
```

La marca debe comunicar:

```text
piano
aprendizaje
visualización musical
simplicidad
IA como asistencia
```

sin parecer una aplicación genérica de IA.

---

# 28. Estrategia de marketing

La adquisición inicial debe enfocarse en contenido orgánico.

Canales principales:

```text
TikTok
Instagram Reels
YouTube Shorts
```

Ejemplo de contenido:

```text
"¿Puede una IA convertir esta canción de piano en un tutorial?"
```

Secuencia:

```text
subir audio
↓
procesamiento
↓
falling notes
↓
audio sincronizado
↓
CTA
```

CTA:

```text
Prueba 60 segundos gratis
```

---

# 29. Generación automática de contenido promocional

Funcionalidad futura interesante:

Exportar videos verticales directamente desde un tutorial.

Ejemplo:

```text
9:16
título de canción
falling notes
teclado virtual
branding
10–30 segundos
```

Esto puede convertir la propia aplicación en una herramienta de marketing.

Sólo se debe publicar audio que se tenga derecho a utilizar.

---

# 30. Fase G — Beta cerrada

No lanzar masivamente al inicio.

Objetivo inicial:

```text
10–20 usuarios externos
```

Medir:

```text
signup → preview
preview → compra
tutoriales creados
éxito de procesamiento
canciones por usuario
latencia
fallos
uso repetido
soporte
reembolsos
```

La beta determinará si existe interés comercial real.

---

# 31. Métricas principales de producto

## Activación

```text
% de usuarios que suben una canción
```

## Preview

```text
% que generan la preview gratuita
```

## Conversión

```text
% de usuarios free que compran
```

## Uso

```text
tutoriales por cliente
```

## Confiabilidad

```text
jobs exitosos / jobs totales
```

## Rendimiento

```text
tiempo mediano
p95 de procesamiento
```

---

# 32. Métricas de infraestructura

Registrar:

```text
GPU seconds/song
costo/song
storage/song
R2 operations
queue length
job failures
cold starts
```

No optimizar sin estas mediciones.

---

# 33. Fase H — Lanzamiento público

El lanzamiento público debe realizarse únicamente después de tener:

```text
GPU cloud validada
storage estable
rate limiting activo
retries funcionando
pricing activo
billing validado
privacy/terms publicados
manejo de errores aceptable
monitorización básica
```

El lanzamiento será inicialmente:

```text
web app / PWA
```

Las apps nativas quedan para más adelante.

---

# 34. Apps nativas

No priorizar:

```text
iOS App Store
Google Play
```

hasta comprobar que:

- los usuarios las quieren,
- la retención lo justifica,
- la distribución nativa aporta valor medible.

La web es suficiente para validar el mercado.

---

# 35. Estrategia de escalamiento

## Etapa 1

```text
10 usuarios
1 worker serverless GPU
```

## Etapa 2

```text
100 usuarios
autoscaling serverless
más containers si es necesario
```

## Etapa 3

```text
1,000+ usuarios
medir uso
optimizar runtime
evaluar economía de GPU dedicada
```

No alquilar GPU permanente sólo porque el producto sea comercial.

Mientras la carga sea intermitente, serverless tiene sentido.

---

# 36. Cuándo evaluar GPU dedicada

Sólo cuando:

```text
la utilización GPU sea sostenida
```

o:

```text
serverless cueste más que una GPU dedicada
```

La decisión debe basarse en carga mensual real.

Opciones futuras:

```text
RunPod Dedicated
GPU VM
Vast
Lambda
AWS/GCP/Azure
servidor GPU propio
```

No decidir proveedor definitivo antes de comparar números reales.

---

# 37. Optimización del modelo — fase futura

El modelo actual ya funciona suficientemente bien.

No implementar de inmediato:

```text
FP16
quantization
TensorRT
ONNX
batch inference
checkpoint conversion
```

Primero lanzar y medir.

Optimizar sólo si mejora:

```text
latencia
costo
concurrencia
cold start
```

sin empeorar la calidad de transcripción.

---

# 38. Protección de calidad

Cualquier optimización futura o cambio de modelo debe compararse contra canciones conocidas.

Mantener un conjunto de regresión con:

```text
piano lento
piano rápido
acordes densos
pedal sustain
grabación digital limpia
piano acústico
```

La calidad de transcripción es el valor central.

No reducirla para ahorrar fracciones de centavo.

---

# 39. Seguridad antes del lanzamiento

Como mínimo validar:

```text
storage privado
signed URLs
RLS
validación de uploads
límites de tamaño
límites de duración
rate limiting
CAPTCHA
autorización por job
manejo de secrets
CORS
limpieza de temporales
```

Actualmente ya existen buckets privados y signed URLs; deben mantenerse.

---

# 40. Confiabilidad antes del lanzamiento

Debe existir:

```text
job retries
timeouts
recuperación de worker
protección contra jobs duplicados
estado de error claro
monitorización básica
```

La cola actual con reclamo atómico es una buena base para varios workers.

---

# 41. Aspectos legales y de producto

Antes de cobrar:

```text
Términos de Servicio
Política de Privacidad
Política de Reembolsos
Política de Copyright / uploads
```

Debe dejarse claro que los usuarios deben subir contenido que tengan permiso de procesar.

No añadir redistribución pública de música ni descargadores externos durante la primera versión.

---

# 42. Secuencia recomendada de implementación

Orden recomendado desde el MVP actual:

```text
FASE 1
Benchmark Modal T4/L4

FASE 2
Prueba del worker GPU cloud

FASE 3
Migración del worker desde la PC personal

FASE 4
Cloudflare R2

FASE 5
Decisión/migración frontend a Cloudflare

FASE 6
Retries + confiabilidad

FASE 7
Rate limiting + preview gratuita

FASE 8
Sistema de créditos

FASE 9
UI/UX de producción

FASE 10
Branding

FASE 11
Pagos

FASE 12
Beta cerrada

FASE 13
Marketing orgánico

FASE 14
Lanzamiento público

FASE 15
Medición y optimización
```

Las fases pueden ajustarse si existen dependencias.

---

# 43. Próximo paso inmediato

La siguiente tarea técnica debe ser pequeña:

> Ejecutar el worker actual en Modal usando la misma canción representativa en una T4 y una L4.

Todavía no se migra toda la aplicación.

Medir:

```text
tipo GPU
duración audio
cold start
model load
inference
total
cost
resultado
```

Comparar:

```text
T4 cost/song
vs
L4 cost/song
```

La mejor combinación de precio y latencia se convierte en candidata inicial.

---

# 44. Punto de decisión después del benchmark

Responder:

```text
¿Funciona correctamente el modelo en Modal?
¿Produce el mismo resultado que local?
¿Qué GPU tiene menor costo por canción?
¿Qué GPU tiene mejor latencia?
¿El cold start es aceptable?
```

Si todo es favorable:

```text
continuar con la migración del worker
```

Si no:

```text
probar RunPod Serverless
```

El producto no debe quedar acoplado a Modal.

---

# 45. Hipótesis comercial actual

```text
FREE
→ preview de 60 segundos

MINI PACK
→ $2.99
→ 5 canciones completas

PRACTICE
→ $5.99/mes
→ 20 canciones

PLUS
→ $8.99/mes
→ 50 canciones
```

Esto representa un experimento de mercado.

No es pricing definitivo.

---

# 46. Principio estratégico principal

El proyecto ya demostró:

```text
la tecnología funciona
```

La siguiente etapa debe demostrar:

```text
personas externas quieren usarla
y
algunas están dispuestas a pagar
```

Por eso las siguientes decisiones deben priorizar:

```text
confiabilidad
bajo costo operativo
experimentación rápida
compra sencilla
buen onboarding
medición real de usuarios
```

y no construir infraestructura masiva antes de tener demanda.

---

# 47. Ruta general del producto

```text
MVP ACTUAL
    ↓
Benchmark cloud
    ↓
Worker cloud
    ↓
Storage de producción
    ↓
Confiabilidad + protección contra abuso
    ↓
Créditos + pagos
    ↓
Mejora UI
    ↓
Branding
    ↓
Beta cerrada
    ↓
Marketing orgánico
    ↓
Lanzamiento público web
    ↓
Medir demanda
    ↓
Escalar sólo cuando los datos lo justifiquen
```

Este documento es un roadmap vivo.

Arquitectura, proveedores, precios, límites y prioridades pueden cambiar según los benchmarks y el comportamiento real de los usuarios.
