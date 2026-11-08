#!/usr/bin/env python3
"""
Genera la documentación del servidor en PDF (entrega/Documentacion_ASHENFALL.pdf).

Formato: carta, Arial. Todo el texto en Arial 12 normal; títulos y subtítulos más grandes y en negrita; la portada,
copiada de la referencia del curso, en Arial 12 negrita y centrada. Número de página al centro.

Las cifras salen de los documentos de docs/ y de las mediciones del 5 al 7 de noviembre de 2026; no se calcula nada
aquí. Si cambia una cifra, se corrige en el texto de este archivo.

Uso: python3 scripts/build-documentacion-pdf.py     (requiere reportlab; usa Arial del sistema si existe)
"""
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'entrega' / 'Documentacion_ASHENFALL.pdf'
LOGO = ROOT / 'scripts' / 'assets' / 'tec-logo.png'

REPO = 'https://github.com/kevinmirandaa/ashenfall-game'
URL = 'https://ashenfall-server-prod.icytree-9cfd11e3.canadacentral.azurecontainerapps.io'
JIRA = 'https://kevinmirandaa04.atlassian.net/jira/software/projects/SCRUM'

# ---------- fuentes ----------
SYS = Path('/System/Library/Fonts/Supplemental')
if (SYS / 'Arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Arial', str(SYS / 'Arial.ttf')))
    pdfmetrics.registerFont(TTFont('Arial-Bold', str(SYS / 'Arial Bold.ttf')))
    BODY, BOLD = 'Arial', 'Arial-Bold'
else:  # respaldo con las fuentes incluidas en reportlab
    BODY, BOLD = 'Helvetica', 'Helvetica-Bold'

NAVY = colors.HexColor('#16163F')
GRAY = colors.HexColor('#9A9A9A')
SHADE = colors.HexColor('#ECEDF5')

st_body = ParagraphStyle('body', fontName=BODY, fontSize=12, leading=16, alignment=TA_LEFT, spaceAfter=6)
st_h1 = ParagraphStyle('h1', fontName=BOLD, fontSize=17, leading=21, spaceBefore=12, spaceAfter=7, keepWithNext=1)
st_h2 = ParagraphStyle('h2', fontName=BOLD, fontSize=14, leading=18, spaceBefore=8, spaceAfter=5, keepWithNext=1)
st_cell = ParagraphStyle('cell', fontName=BODY, fontSize=12, leading=14.5, alignment=TA_LEFT)
st_bullet = ParagraphStyle('bullet', parent=st_body, leftIndent=16, bulletIndent=3, spaceAfter=2, bulletFontName=BODY, bulletFontSize=12)
st_cap = ParagraphStyle('cap', fontName=BODY, fontSize=12, leading=15, alignment=TA_LEFT, spaceBefore=2, spaceAfter=8)

story = []
fig_n = [0]


def P(text, style=st_body):
    story.append(Paragraph(text, style))


def H1(text, need=2.2):
    story.append(CondPageBreak(need * inch))
    story.append(Paragraph(text, st_h1))


def H2(text, need=1.8):
    if not (story and isinstance(story[-1], Paragraph) and story[-1].style is st_h1):
        story.append(CondPageBreak(need * inch))
    story.append(Paragraph(text, st_h2))


def bullets(items):
    for it in items:
        story.append(Paragraph(it, st_bullet, bulletText='•'))
    story.append(Spacer(1, 5))


def table(rows, widths, groups=(), keep=True):
    """Tabla con texto normal; el encabezado y los grupos se distinguen por el fondo, no por la negrita."""
    data = []
    spans = []
    for r, row in enumerate(rows):
        if r in groups:
            data.append([Paragraph(row[0], st_cell)] + [''] * (len(widths) - 1))
            spans.append(('SPAN', (0, r), (-1, r)))
        else:
            data.append([Paragraph(str(c), st_cell) for c in row])
    t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.5, GRAY), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('BACKGROUND', (0, 0), (-1, 0), SHADE),
    ] + spans + [('BACKGROUND', (0, g), (-1, g), colors.HexColor('#DDE0F0')) for g in groups]
    t.setStyle(TableStyle(style))
    story.append(KeepTogether([t]) if (keep and len(rows) <= 7) else t)
    story.append(Spacer(1, 8))


def drawing_figure(drawing, caption, scale=0.86):
    fig_n[0] += 1
    drawing.scale(scale, scale)
    drawing.width *= scale
    drawing.height *= scale
    story.append(KeepTogether([drawing, Paragraph(f'Figura {fig_n[0]}. {caption}', st_cap)]))


# ---------- dibujo ----------
def box(d, x, y, w, h, lines, fill='#FFFFFF', size=10.2):
    d.add(Rect(x, y, w, h, fillColor=colors.HexColor(fill), strokeColor=NAVY, strokeWidth=0.9, rx=4, ry=4))
    top = y + h / 2 + (len(lines) - 1) * (size + 1.5) / 2 - size * 0.35
    for i, part in enumerate(lines):
        d.add(String(x + w / 2, top - i * (size + 1.5), part, fontName=BODY, fontSize=size, textAnchor='middle', fillColor=colors.black))


def arrow(d, x1, y1, x2, y2, dash=False, both=False):
    import math
    ln = Line(x1, y1, x2, y2, strokeColor=NAVY, strokeWidth=1)
    if dash:
        ln.strokeDashArray = [3, 2]
    d.add(ln)

    def head(xa, ya, xb, yb):
        a = math.atan2(yb - ya, xb - xa)
        s = 5
        d.add(Polygon([xb, yb, xb - s * math.cos(a - 0.45), yb - s * math.sin(a - 0.45), xb - s * math.cos(a + 0.45), yb - s * math.sin(a + 0.45)],
                      fillColor=NAVY, strokeColor=NAVY))
    head(x1, y1, x2, y2)
    if both:
        head(x2, y2, x1, y1)


def topology():
    d = Drawing(468, 250)
    box(d, 2, 98, 84, 56, ['Jugadores', '(navegador)', 'HTTPS y WSS'], '#EEF3FF', 9.6)
    d.add(Rect(116, 24, 172, 214, fillColor=colors.HexColor('#F7F7FB'), strokeColor=colors.HexColor('#7777AA'), strokeWidth=0.9, rx=6, ry=6, strokeDashArray=[4, 3]))
    d.add(String(202, 224, 'Azure Container Apps', fontName=BODY, fontSize=10.5, textAnchor='middle'))
    box(d, 130, 168, 144, 38, ['Servidor, réplica 1', 'Fastify y WebSocket'])
    box(d, 130, 112, 144, 38, ['Servidor, réplica 2', 'mínimo 2, máximo 3'])
    box(d, 130, 36, 144, 56, ['Redis (ingress interno)', 'difusión entre réplicas,', 'presencia y límites'], '#FFF6E8', 10)
    box(d, 336, 186, 130, 46, ['PostgreSQL Flexible', 'eventos, usuarios, salas', '(red privada)'], '#EAF7EE', 9.4)
    box(d, 336, 136, 130, 38, ['Key Vault', 'secretos'], size=10)
    box(d, 336, 86, 130, 38, ['Application Insights', 'métricas, trazas, alertas'], size=9.4)
    box(d, 336, 36, 130, 38, ['Container Registry', 'imagen del servidor'], size=9.8)
    box(d, 130, 2, 144, 20, ['Identidad administrada (sin claves)'], size=9.2)
    arrow(d, 86, 138, 130, 187)
    arrow(d, 86, 114, 130, 131)
    arrow(d, 274, 187, 336, 208)
    arrow(d, 274, 131, 336, 200)
    arrow(d, 202, 112, 202, 92, both=True)
    arrow(d, 274, 180, 336, 157, dash=True)
    arrow(d, 274, 128, 336, 106, dash=True)
    arrow(d, 288, 55, 336, 55, dash=True)
    return d


# ---------- portada y numeración ----------
def cover(canvas, doc):
    """Misma disposición que la portada de referencia: logo arriba y Arial negrita 12 centrada."""
    canvas.saveState()
    w = letter[0]
    lw = 3.0 * inch
    lh = lw * 315 / 600
    canvas.drawImage(str(LOGO), (w - lw) / 2, 792 - 70 - lh, width=lw, height=lh, mask='auto')
    canvas.setFont(BOLD, 12)
    lines = [
        (232, 'Instituto Tecnológico de Costa Rica'), (274, 'Escuela de Ingeniería en Computación'), (300, 'Diseño de Software'),
        (386, 'Tercer Proyecto: Servidor nivel producción en Azure para un juego por turnos'),
        (410, 'ASHENFALL, servidor autoritativo de un duelo 1v1 por turnos'),
        (456, 'Estudiante:'), (480, 'Kevin Miranda Méndez'), (500, 'Carné 2024120764'),
        (528, 'Repositorio:'), (542, REPO), (562, 'Servidor en Azure:'), (576, URL),
        (606, 'Profesor:'), (630, 'Jonathan Solis Parajeles'), (674, 'II Semestre 2026'),
    ]
    for top, text in lines:
        base = 792 - (top + 10)
        canvas.drawCentredString(w / 2, base, text)
        if text in (REPO, URL):
            tw = pdfmetrics.stringWidth(text, BOLD, 12)
            canvas.linkURL(text, (w / 2 - tw / 2, base - 3, w / 2 + tw / 2, base + 10), relative=0)
    canvas.restoreState()


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(BODY, 12)
    canvas.drawCentredString(letter[0] / 2, 0.5 * inch, str(doc.page))
    canvas.restoreState()


def link(url, text=None):
    return f'<link href="{url}" color="#16163F">{text or url}</link>'


# =====================================================================
story.append(Spacer(1, 1))
story.append(PageBreak())

# =====================================================================
H1('1. Introducción')
P('Este documento describe el servidor que construí para el tercer proyecto del curso: un servidor de nivel producción, desplegado en Azure, para un juego multijugador por turnos. Como indica el enunciado, se evalúa el servidor y no el juego, por lo que aquí se explica qué servidor se hizo, dónde corre, con qué tecnologías, cómo está configurado, cómo se protege, cómo se despliega y cómo se midió. La sección 10 es la lista de todo lo que pide el enunciado, con su estado.')
P('El servidor se llama ASHENFALL y atiende duelos 1v1 por turnos de proyectiles. Es autoritativo: el cliente solo envía intenciones, y el servidor valida cada jugada y es la única fuente de verdad. Cada partida es un registro de eventos en PostgreSQL que se puede reproducir jugada por jugada y que sobrevive a reinicios y publicaciones.')
table([
    ['Qué', 'Dónde'],
    ['Servidor en Azure', link(URL)],
    ['API REST (OpenAPI 3.1)', link(URL + '/docs')],
    ['Repositorio en GitHub', link(REPO)],
    ['Versión evaluada', 'Etiqueta v1.0.0'],
    ['Tablero de trabajo (Jira)', link(JIRA, 'Proyecto SCRUM')],
    ['Documentación en el repositorio', 'Carpeta docs/ (índice en docs/README.md)'],
], [2.3, 4.2])

H1('2. El servidor y el juego')
table([
    ['Aspecto', 'Detalle'],
    ['Lenguaje', 'TypeScript estricto (sin any) sobre Node.js 22'],
    ['Servidor', 'Fastify 5; WebSocket con la librería ws'],
    ['Datos', 'PostgreSQL 16 (eventos y datos) y Redis 7 (difusión, presencia y límites)'],
    ['Dominio', 'Módulo puro en packages/domain, sin red, base de datos ni framework'],
    ['Contratos', 'OpenAPI 3.1 en /docs y AsyncAPI 3.0'],
    ['Dónde corre', 'Azure Container Apps, región canadacentral, grupo rg-ashenfall-prod'],
    ['Infraestructura', 'Bicep y GitHub Actions con OIDC, sin secretos'],
    ['Cliente de prueba', 'Phaser 3, servido por el propio servidor'],
], [1.7, 4.8])
P('El juego es el pretexto: un duelo 1v1 por turnos de proyectiles. Cada jugador empieza con 100 puntos de vida, el turno dura 30 segundos y la partida tiene como máximo 12 rondas. Se dispara arrastrando hacia atrás y soltando, como una tirachinas. Hay siete arenas, y el servidor sortea el terreno y los obstáculos de cada partida. Las reglas son propias, y el dominio decide sin ambigüedad si una jugada es válida y cuándo termina la partida. La posición del rival es pública por diseño, pero hay vista por jugador: el rival nunca recibe el ángulo, la potencia ni el identificador de la jugada.')

H1('3. Arquitectura')
P('El motor de reglas es un módulo de dominio puro: el servidor conoce al dominio y el dominio no conoce a nadie, y ESLint lo hace cumplir. La topología es la de referencia del enunciado. Redis corre como una Container App interna en vez de Azure Cache for Redis, porque el costo de este no cabe en el crédito de Azure for Students.')
drawing_figure(topology(), 'Topología de producción en Azure.')
H2('3.1 Patrones y decisiones')
bullets([
    'Event sourcing: cada partida es un log de eventos con número de secuencia (seq); el estado es el resultado de reproducirlo, así cualquier réplica puede atenderla.',
    'Orden por partida: fila de comandos por partida en cada réplica y clave primaria (match_id, seq) entre réplicas; el conflicto se resuelve releyendo el log y decidiendo de nuevo.',
    'Bus de eventos sobre Redis: cada réplica entrega a sus conexiones los eventos ya confirmados; si se pierde uno, el cliente detecta el hueco en seq y pide el estado con sync.',
    'Vista por jugador: cada evento se proyecta a lo que ese jugador puede ver.',
    'Plazos en PostgreSQL: todas las réplicas barren los plazos vencidos, sin réplica líder.',
])
H2('3.2 Flujo de una jugada')
P('El cliente envía shoot con un actionId, la versión esperada, el arma, el ángulo y la potencia. La pasarela valida el esquema, el tamaño y la tasa. El motor encola la jugada, reproduce el estado desde PostgreSQL y el dominio decide: turno, versión y actionId. Si se aplica, se guardan los eventos con (match_id, seq) y se publican por Redis; cada réplica los entrega con la vista de cada jugador y el tirador recibe su ack.')

H1('4. Seguridad')
table([
    ['Tema', 'Cómo se resuelve'],
    ['Tokens', 'JWT HS256 de 15 minutos, con emisor y audiencia verificados; refresh token rotativo de 30 días, solo con su hash guardado; reutilizar uno revoca la familia.'],
    ['Contraseñas', 'Argon2id (19 MiB, 2 iteraciones, paralelismo 1), acotado a una a la vez con fila de 32; si se llena, responde 503.'],
    ['WebSocket', 'Ticket de un solo uso de 30 s en el handshake; sin ticket válido, se cierra. Origen restringido (un Origin ajeno recibe 403).'],
    ['Autorización', 'Solo los participantes actúan en su partida (lo ajeno responde 404), solo juega quien tiene el turno y solo el administrador usa /v1/admin, con auditoría.'],
    ['Validación', 'Cada mensaje se valida contra su esquema (tipos, rangos y 4 KiB) antes del dominio; uno inválido no cierra la partida.'],
    ['Límites', '600 peticiones por minuto por usuario o IP, 20 por minuto en autenticación, 10 logins por minuto por cuenta; HTTP 429 con Retry-After; 20 mensajes por segundo por conexión; 3 conexiones por usuario.'],
    ['Transporte', 'Solo HTTPS y WSS (http redirige con 301); HSTS, CSP y nosniff con helmet; CORS vacío en producción (mismo origen).'],
    ['Secretos', 'jwt-secret y la cadena de Application Insights están en Key Vault y se leen con identidad administrada; ninguno está en el repositorio (gitleaks revisa el historial).'],
    ['Identidad y red', 'PostgreSQL con Microsoft Entra, sin contraseña y sin acceso público; Redis con ingress interno; el pipeline entra con OIDC sin secretos.'],
    ['Cadena de suministro', 'Dependabot semanal, CodeQL, gitleaks y Trivy (falla ante vulnerabilidades críticas) en CI; imagen con usuario no root.'],
    ['Información oculta', 'El rival nunca recibe ángulo, potencia ni actionId, ni por WebSocket, ni por REST, ni en logs; hay pruebas en cada canal.'],
], [1.5, 5.0])
P('Verificado en Azure el 7 de noviembre de 2026: http responde 301, hay HSTS y CSP, un Origin ajeno recibe 403, el login devuelve 429 con Retry-After, los secretos son referencias a Key Vault, PostgreSQL no tiene acceso público y el environment prod exige un revisor. El modelo de amenazas completo está en docs/threat-model.md y el detalle de seguridad en docs/seguridad.md.')

H1('5. Sesiones, concurrencia y contratos')
bullets([
    'Jugadas simultáneas: una sola se confirma por (match_id, seq); la otra se relee y se decide contra el estado nuevo.',
    'Duplicados e idempotencia: el reenvío de un actionId devuelve un ack marcado como duplicado y no se aplica dos veces.',
    'Estado viejo: la versión esperada distinta de la actual se rechaza con STALE_VERSION.',
    'Reconexión: heartbeat cada 15 s, snapshot al reconectar y gracia de 60 s configurable; al vencer, abandono. Dos turnos agotados seguidos también cuentan como abandono.',
    'Durabilidad y aislamiento: nada confirmado vive solo en memoria y un fallo en una partida no afecta a las demás ni tumba el proceso.',
    'Limpieza: las partidas inactivas terminan por sus plazos, las salas sin iniciar se cierran a la hora y la cola expira.',
    'Contratos: 30 rutas REST en OpenAPI 3.1 (/docs) con errores RFC 9457, y 7 mensajes WebSocket versionados en AsyncAPI 3.0; ambos se generan desde el código y una prueba falla si dejan de coincidir.',
    'Códigos de cierre: 1001 cierre ordenado, 4003 usuario suspendido, 4008 demasiadas conexiones, 4009 heartbeat perdido y 4029 límite de tasa.',
])

H1('6. Rendimiento y optimización')
P('El bot de apps/bot juega partidas reales por HTTP y WebSocket y mide el tiempo hasta que ambos jugadores reciben el resultado. Las metas del enunciado son p95 menor a 200 ms, ninguna jugada perdida o duplicada y error menor a 1 %. En una réplica de 1 CPU y 1 GB, a un disparo por segundo y partida, se cumplen las tres metas:')
table([
    ['Partidas', 'Jugadas por s', 'p95', 'CPU réplica', 'Memoria'],
    ['100', '92', '14 ms', '13 %', '56 MB'],
    ['400', '369', '5 ms', '21 %', '66 MB'],
    ['800', '737', '7 ms', '33 %', '75 MB'],
], [1.2, 1.4, 1.2, 1.5, 1.2])
P('El consumo es de unos 0,03 puntos de CPU y 0,02 MB por partida activa. El punto de quiebre está cerca de 1 800 jugadas por segundo por réplica (a 400 partidas con diez disparos por segundo, el p95 llega a 198 ms). Los mensajes son compactos: JSON de unos 302 bytes de media.')
table([
    ['Optimización', 'Antes', 'Después'],
    ['p95 con 100 clientes enviando logins fallidos (Argon2id acotado)', '202 ms', '109 ms'],
    ['Preparar 100 partidas con 200 cuentas (parámetros mínimos de OWASP)', '57 s', '5 s'],
    ['Idas y vueltas a PostgreSQL por jugada', '7', '5'],
    ['Jugadas por segundo en saturación', '1 593 a 1 647', '1 754 a 1 839'],
    ['Imagen Docker', '565 MB', '387 MB'],
], [3.9, 1.3, 1.3])
P('En Azure (7 de noviembre de 2026), con partidas reales contra la URL pública, tres corridas dieron 1 279 jugadas confirmadas y 46 partidas contrastadas con su replay del servidor, con 0 jugadas perdidas, 0 duplicadas y 0 errores. Una de ellas cruzó la publicación de una revisión nueva con 6 partidas abiertas, y las jugadas se repartieron entre las réplicas. La latencia medida por el propio servidor tuvo media de unos 17 ms; de extremo a extremo desde Costa Rica, el p95 fue de 216 ms por el viaje por internet. Los comandos para reproducir todo están en docs/load-report.md.')

H1('7. Azure, infraestructura y CI/CD')
table([
    ['Recurso', 'Configuración'],
    ['ashenfall-server-prod (Container App)', '0,5 vCPU y 1 GiB; 2 a 3 réplicas; escala por 50 solicitudes concurrentes; sondas de vida y disponibilidad; 120 s de gracia al apagar; ingress HTTPS externo'],
    ['ashenfall-redis-prod (Container App)', 'Redis 7, 0,25 vCPU y 0,5 GiB, ingress interno'],
    ['psql-ashenfall-prod-3fiowy', 'PostgreSQL 16 Flexible, B1ms, 32 GB, red privada, solo Entra'],
    ['kv-ash-prod-3fiowy', 'Key Vault con RBAC: jwt-secret y cadena de Application Insights'],
    ['acrashenfallprod3fiowy', 'Container Registry Basic; imagen etiquetada con el sha del commit'],
    ['id-ashenfall-prod', 'Identidad administrada con AcrPull, Key Vault Secrets User y administración de Entra en PostgreSQL'],
    ['vnet-ashenfall-prod', 'Red virtual con subredes para Container Apps y PostgreSQL, y DNS privado'],
    ['log-ashenfall-prod y appi-ashenfall-prod', 'Log Analytics (30 días) y Application Insights'],
], [2.4, 4.1])
bullets([
    'Infraestructura como código: todos los recursos están en Bicep (infra/main.bicep) y un ambiente nuevo se levanta con una sola ejecución del pipeline; el 7 de noviembre de 2026 el pipeline creó dev y prod desde cero.',
    'CI: en cada pull request, build, tipos, linter, 294 pruebas con PostgreSQL y Redis reales, validación de contratos, CodeQL, gitleaks y Trivy.',
    'Despliegue: entra a Azure con OIDC; construye y publica la imagen, crea jwt-secret en Key Vault si no existe y despliega. Dev es automático y prod espera la aprobación manual de un revisor.',
    'Publicaciones sin cortar partidas: la revisión nueva nace al 0 % del tráfico, se prueba por su propia URL y recibe el 100 %; la anterior queda como destino de rollback y las viejas se desactivan, cerrando sus conexiones de forma ordenada (código 1001).',
    'Rollback: scripts/rollback.sh pasa el tráfico a la revisión anterior; se probó en producción y tardó 22 segundos.',
    'Observabilidad: OpenTelemetry hacia Application Insights con las métricas ashenfall.matches.active, ashenfall.connections, ashenfall.shots y ashenfall.shot.latency; trazas con el id de partida y de jugador; logs estructurados; sondas /health/live y /health/ready; tres alertas (reinicios, CPU de PostgreSQL y latencia).',
])
P('Límite de la suscripción: Azure for Students permite un solo entorno de Container Apps por suscripción, así que dev y prod no pueden existir a la vez. Dev se desplegó y probó con el pipeline y se borró para dejar sitio a prod; el despliegue automático a dev queda apagado.')

H1('8. Pruebas, costo y cómo correrlo')
P('Hay 294 pruebas en 24 archivos (dominio, API, WebSocket, concurrencia, reinicios, seguridad y resiliencia), en verde en CI. La estimación de costo de prod es de unos 47 a 115 USD al mes (Container Apps, PostgreSQL, Redis, registro y logs), con precios de lista y sin descontar cuotas gratuitas; el detalle está en docs/azure-cost.md. Los recursos de dev se apagan o escalan a cero cuando no se usan.')
P('Para correr el servidor en local, en menos de 10 minutos, solo hace falta Docker Desktop: git clone ' + REPO + '.git, luego cd ashenfall-game y docker compose up --build. Queda en http://localhost:8080, con la API en /docs. Para correr las pruebas: npm ci, docker compose up -d --wait postgres redis y npm test.')

H1('9. Limitaciones')
bullets([
    'Dev automático: por el límite de un entorno de Container Apps por suscripción, dev y prod no pueden coexistir.',
    'Rendimiento en Azure: se midió desde internet y con pocas partidas; el punto de quiebre solo está medido en local.',
    'Alertas: existen y están activas, pero no se ha visto que disparen y no envían correo.',
    'Navegadores: el cliente de prueba se probó en Chromium y en emulación móvil; Safari y Firefox no se probaron con navegadores reales.',
])

H1('10. Cumplimiento del enunciado')
P('Lista de todo lo que pide el enunciado y su estado. Más detalle, con 94 puntos y su evidencia, en docs/cumplimiento-enunciado.md.')
DONE = 'Completado'
rows = [
    ['Requisito del enunciado', 'Cómo se cumple', 'Estado'],
    ['El juego'],
    ['Por turnos', 'El estado guarda quién juega; turno de 30 s', DONE],
    ['Multijugador (2 o más humanos)', 'Cola rápida y salas privadas de 2', DONE],
    ['Original', 'Reglas propias de proyectiles', DONE],
    ['Reglas verificables', 'El dominio valida cada jugada y el fin', DONE],
    ['Información oculta (recomendada)', 'Vista por jugador; posición pública por diseño', DONE],
    ['Requisitos funcionales'],
    ['Usuarios', 'Registro, login, logout, refresh rotativo y perfil', DONE],
    ['Salas', 'Públicas y privadas con código; unirse, salir y listo', DONE],
    ['Emparejamiento', 'Cola rápida con espera máxima configurable', DONE],
    ['Turnos', 'Solo el del turno; error tipado; temporizador', DONE],
    ['Conexión', 'Heartbeat, snapshot y gracia configurable', DONE],
    ['Fin de partida', 'Resultado inmutable y replay jugada por jugada', DONE],
    ['Historial', 'Paginado; solo ve sus partidas', DONE],
    ['Administración', 'Solo administrador y con auditoría', DONE],
    ['Reglas del servidor'],
    ['Servidor autoritativo', 'El cliente envía intenciones', DONE],
    ['Orden por partida', 'Fila por partida y clave (match_id, seq)', DONE],
    ['Idempotencia', 'actionId; ack duplicado', DONE],
    ['Vista por jugador', 'Sin filtración en mensajes, REST ni logs', DONE],
    ['Durabilidad', 'Estado en PostgreSQL; sobrevive a reinicios', DONE],
    ['Aislamiento', 'Un fallo no afecta a otras partidas', DONE],
    ['Limpieza', 'Plazos y expiración automática', DONE],
    ['Reloj y azar del servidor', 'Generador criptográfico del servidor', DONE],
    ['Lenguaje, comunicación y contratos'],
    ['Lenguaje tipado estricto', 'TypeScript strict, sin any', DONE],
    ['Dominio puro', 'packages/domain sin red ni base de datos', DONE],
    ['WSS sin polling del turno', 'ws sobre WSS; eventos empujados', DONE],
    ['Protocolo con AsyncAPI 3.0', '7 mensajes versionados', DONE],
    ['OpenAPI 3.1 en /docs', '30 rutas; Swagger UI', DONE],
    ['Errores RFC 9457', 'Problem Details en toda la API', DONE],
    ['Validación de mensajes', 'Esquema y 4 KiB antes del dominio', DONE],
    ['Heartbeat y códigos de cierre', 'Ping y pong; 1001, 4003, 4008, 4009, 4029', DONE],
    ['Seguridad'],
    ['Autenticación', 'JWT, Argon2id y ticket de WebSocket', DONE],
    ['Autorización', 'Participantes, turno y rol administrador', DONE],
    ['Límites', '429 con Retry-After; mensajes y conexiones', DONE],
    ['Transporte', 'HTTPS y WSS, CORS, cabeceras de seguridad', DONE],
    ['Secretos', 'Key Vault con identidad administrada', DONE],
    ['Cadena de suministro', 'Dependabot, CodeQL, gitleaks, Trivy; no root', DONE],
    ['Rendimiento'],
    ['Prueba de carga y metas', 'p95 de 15 ms o menos; 0 perdidas; 0 errores', DONE],
    ['Capacidad y punto de quiebre', 'CPU y memoria por partida; quiebre medido', DONE],
    ['Mensajes compactos', 'JSON de unos 302 bytes', DONE],
    ['Optimización medida', 'Dos, con cifras antes y después', DONE],
    ['Azure y entrega continua'],
    ['Infraestructura como código', 'Bicep; ambiente desde cero con el pipeline', DONE],
    ['CI/CD con dev automático y prod manual', 'Prod con revisor; dev automático con limitación (nota)', DONE + ' *'],
    ['Publicaciones sin cortar partidas', 'Tráfico al 0 %, drenado, cierre 1001', DONE],
    ['Rollback en menos de 5 minutos', 'Probado en prod: 22 s', DONE],
    ['Identidad administrada', 'Sin cadenas de conexión ni claves', DONE],
    ['Observabilidad', 'OpenTelemetry, métricas, sondas y 3 alertas', DONE],
    ['Costo', 'Estimación mensual; dev a cero', DONE],
    ['Entregables'],
    ['Repositorio con todo lo pedido', 'Código, IaC, pipelines, contratos, pruebas, bots y cliente', DONE],
    ['README', 'Local en menos de 10 minutos, pruebas y URL', DONE],
    ['URL pública en Azure', 'Disponible durante la revisión', DONE],
    ['Versión etiquetada v1.0.0', 'Etiqueta publicada', DONE],
    ['Documentación', 'Este documento y docs/', DONE],
]
groups = [i for i, r in enumerate(rows) if len(r) == 1]
count = len(rows) - 1 - len(groups)
table(rows, [2.55, 2.75, 1.2], groups=groups, keep=False)
P(f'Total: {count} requisitos, todos completados. * Azure for Students permite un solo entorno de Container Apps por suscripción, así que dev y prod no pueden coexistir: dev se desplegó y probó con el pipeline y se borró, y el despliegue automático a dev queda apagado; prod tiene aprobación manual.')

H1('11. Conclusión')
P('El servidor de ASHENFALL cumple lo que pide el proyecto: es autoritativo, seguro y observable, atiende muchas partidas simultáneas con orden e idempotencia, funciona con varias réplicas, se publica sin cortar partidas y se revierte en segundos, y está desplegado en Azure con infraestructura como código, identidad administrada y aprobación manual a producción. Las cifras salen de ejecuciones reales y reproducibles con los bots del repositorio.')


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=0.9 * inch, bottomMargin=0.9 * inch,
                            title='Documentación del servidor ASHENFALL', author='Kevin Miranda Méndez',
                            subject='Tercer Proyecto: Servidor nivel producción en Azure para un juego por turnos')
    doc.build(story, onFirstPage=cover, onLaterPages=footer)
    print('PDF escrito en', OUT)


if __name__ == '__main__':
    build()
