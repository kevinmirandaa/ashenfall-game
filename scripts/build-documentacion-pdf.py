#!/usr/bin/env python3
"""
Genera la documentación de entrega en PDF (entrega/Documentacion_ASHENFALL.pdf).

Formato: carta, Arial, portada con el logo del TEC, secciones numeradas, tablas, figuras con pie
«Figura N.» y número de página al centro, como el resto de documentos del curso.

Las cifras salen de los documentos de docs/ y de las mediciones del 5 al 7 de noviembre de 2026; no se calcula
nada aquí. Si cambia una cifra, se corrige en el texto de este archivo.

Uso: python3 scripts/build-documentacion-pdf.py     (requiere reportlab; usa Arial del sistema si existe)
"""
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'entrega' / 'Documentacion_ASHENFALL.pdf'
IMG = ROOT / 'docs' / 'img'
LOGO = ROOT / 'scripts' / 'assets' / 'tec-logo.png'

REPO = 'https://github.com/kevinmirandaa/ashenfall-game'
URL = 'https://ashenfall-server-prod.icytree-9cfd11e3.canadacentral.azurecontainerapps.io'
JIRA = 'https://kevinmirandaa04.atlassian.net/jira/software/projects/SCRUM'

# ---------- fuentes ----------
SYS = Path('/System/Library/Fonts/Supplemental')
if (SYS / 'Arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Arial', str(SYS / 'Arial.ttf')))
    pdfmetrics.registerFont(TTFont('Arial-Bold', str(SYS / 'Arial Bold.ttf')))
    pdfmetrics.registerFont(TTFont('Arial-Italic', str(SYS / 'Arial Italic.ttf')))
    pdfmetrics.registerFont(TTFont('Arial-BoldItalic', str(SYS / 'Arial Bold Italic.ttf')))
    pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-BoldItalic')
    BODY, BOLD, ITALIC = 'Arial', 'Arial-Bold', 'Arial-Italic'
else:  # respaldo con las fuentes incluidas en reportlab
    BODY, BOLD, ITALIC = 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'
MONO = 'Courier'

NAVY = colors.HexColor('#16163F')
RED = colors.HexColor('#B3262F')
GRAY = colors.HexColor('#BDBDBD')
LIGHT = colors.HexColor('#F1F1F5')

st_body = ParagraphStyle('body', fontName=BODY, fontSize=10.5, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=7)
st_left = ParagraphStyle('left', parent=st_body, alignment=TA_LEFT)
st_h1 = ParagraphStyle('h1', fontName=BOLD, fontSize=15, leading=19, spaceBefore=14, spaceAfter=8, textColor=colors.black, keepWithNext=1)
st_h2 = ParagraphStyle('h2', fontName=BOLD, fontSize=12, leading=16, spaceBefore=9, spaceAfter=5, keepWithNext=1)
st_cell = ParagraphStyle('cell', fontName=BODY, fontSize=8.8, leading=11.2, alignment=TA_LEFT)
st_cellb = ParagraphStyle('cellb', parent=st_cell, fontName=BOLD)
st_cap = ParagraphStyle('cap', fontName=ITALIC, fontSize=9, leading=12, alignment=TA_CENTER, spaceBefore=3, spaceAfter=10, textColor=colors.HexColor('#333333'))
st_code = ParagraphStyle('code', fontName=MONO, fontSize=8.4, leading=10.8, backColor=LIGHT, borderPadding=(4, 5, 4, 5), spaceBefore=3, spaceAfter=9, leftIndent=6, rightIndent=6)
st_bullet = ParagraphStyle('bullet', parent=st_body, leftIndent=16, bulletIndent=4, spaceAfter=3, alignment=TA_LEFT)
cover_c = ParagraphStyle('cc', fontName=BODY, fontSize=14, leading=20, alignment=TA_CENTER)
cover_b = ParagraphStyle('cb', parent=cover_c, fontName=BOLD)
cover_s = ParagraphStyle('cs', parent=cover_c, fontSize=11.5, leading=17)

story = []
fig_n = [0]


def P(text, style=st_body):
    story.append(Paragraph(text, style))


def H1(text):
    story.append(CondPageBreak(1.7 * inch))
    P(text, st_h1)


def H2(text):
    story.append(CondPageBreak(1.7 * inch))
    P(text, st_h2)


def bullets(items):
    for it in items:
        story.append(Paragraph(it, st_bullet, bulletText='•'))
    story.append(Spacer(1, 4))


def code(text):
    story.append(Paragraph(text.replace('&', '&amp;').replace('<', '&lt;').replace('\n', '<br/>'), st_code))


def table(rows, widths, header=True, zebra=False):
    data = []
    for r, row in enumerate(rows):
        data.append([Paragraph(str(c), st_cellb if (header and r == 0) else st_cell) for c in row])
    t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1 if header else 0)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.5, GRAY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
    ]
    if header:
        style.append(('BACKGROUND', (0, 0), (-1, 0), LIGHT))
    if zebra:
        for i in range(2, len(rows), 2):
            style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#FAFAFC')))
    t.setStyle(TableStyle(style))
    story.append(KeepTogether([t]) if len(rows) <= 6 else t)
    story.append(Spacer(1, 9))


def figure(path, caption, width=5.6):
    fig_n[0] += 1
    img = Image(str(path))
    ratio = img.imageHeight / img.imageWidth
    img.drawWidth, img.drawHeight = width * inch, width * inch * ratio
    story.append(KeepTogether([img, Paragraph(f'Figura {fig_n[0]}. {caption}', st_cap)]))


def drawing_figure(drawing, caption):
    fig_n[0] += 1
    story.append(KeepTogether([drawing, Paragraph(f'Figura {fig_n[0]}. {caption}', st_cap)]))


# ---------- dibujos ----------
def box(d, x, y, w, h, text, fill='#FFFFFF', stroke='#16163F', size=8.2, bold=False, lines=None):
    d.add(Rect(x, y, w, h, fillColor=colors.HexColor(fill), strokeColor=colors.HexColor(stroke), strokeWidth=0.9, rx=4, ry=4))
    parts = lines or [text]
    top = y + h / 2 + (len(parts) - 1) * (size + 1.5) / 2 - size * 0.35
    for i, part in enumerate(parts):
        d.add(String(x + w / 2, top - i * (size + 1.5), part, fontName=BOLD if (bold and i == 0) else BODY, fontSize=size,
                     textAnchor='middle', fillColor=colors.black))


def arrow(d, x1, y1, x2, y2, label=None, both=False, dash=False):
    ln = Line(x1, y1, x2, y2, strokeColor=NAVY, strokeWidth=1)
    if dash:
        ln.strokeDashArray = [3, 2]
    d.add(ln)

    def head(xa, ya, xb, yb):
        import math
        a = math.atan2(yb - ya, xb - xa)
        s = 5
        d.add(Polygon([xb, yb, xb - s * math.cos(a - 0.45), yb - s * math.sin(a - 0.45), xb - s * math.cos(a + 0.45), yb - s * math.sin(a + 0.45)],
                      fillColor=NAVY, strokeColor=NAVY))
    head(x1, y1, x2, y2)
    if both:
        head(x2, y2, x1, y1)
    if label:
        d.add(String((x1 + x2) / 2, (y1 + y2) / 2 + 3, label, fontName=ITALIC, fontSize=7, textAnchor='middle', fillColor=RED))


def topology():
    d = Drawing(468, 262)
    box(d, 4, 100, 78, 60, '', '#EEF3FF', lines=['Jugadores', '(navegador)', 'HTTPS y WSS'], bold=True)
    d.add(Rect(120, 28, 160, 206, fillColor=colors.HexColor('#F7F7FB'), strokeColor=colors.HexColor('#7777AA'), strokeWidth=0.9, rx=6, ry=6, strokeDashArray=[4, 3]))
    d.add(String(200, 221, 'Azure Container Apps', fontName=BOLD, fontSize=8.4, textAnchor='middle'))
    box(d, 134, 168, 132, 38, '', lines=['Servidor, réplica 1', 'Fastify + WebSocket'], bold=True)
    box(d, 134, 112, 132, 38, '', lines=['Servidor, réplica 2', 'mínimo 2, máximo 3'], bold=True)
    box(d, 134, 40, 132, 50, '', '#FFF6E8', lines=['Redis (ingress interno)', 'difusión entre réplicas,', 'presencia y límites de tasa'])
    box(d, 340, 188, 124, 44, '', '#EAF7EE', lines=['PostgreSQL Flexible', 'eventos, usuarios, salas', '(red privada, sin acceso público)'], size=7.4)
    box(d, 340, 138, 124, 38, '', lines=['Key Vault', 'jwt-secret y cadena de AI'], size=7.6)
    box(d, 340, 88, 124, 38, '', lines=['Application Insights', 'métricas, trazas, 3 alertas'], size=7.6)
    box(d, 340, 38, 124, 38, '', lines=['Container Registry', 'imagen del servidor'], size=7.6)
    box(d, 134, 4, 132, 22, 'Identidad administrada (sin claves)', '#FFFFFF', size=7.6)
    arrow(d, 82, 140, 134, 187)
    arrow(d, 82, 120, 134, 131)
    arrow(d, 266, 187, 340, 208, both=False)
    arrow(d, 266, 130, 340, 200)
    arrow(d, 200, 112, 200, 90, both=True)
    arrow(d, 266, 180, 340, 157, dash=True)
    arrow(d, 266, 130, 340, 108, dash=True)
    arrow(d, 280, 57, 340, 57, dash=True)
    return d


def layers():
    d = Drawing(468, 236)
    box(d, 20, 190, 250, 36, '', '#EEF3FF', lines=['Cliente de prueba (Phaser 3 + Vite)', 'solo envía intenciones'], bold=True)
    box(d, 20, 138, 250, 36, '', lines=['Transporte: REST (OpenAPI) y WebSocket (AsyncAPI)', 'validación de esquema, autenticación, límites'], bold=True)
    box(d, 20, 86, 250, 36, '', lines=['Servicios: salas, cola, tienda, historial, admin', 'MatchEngine: orden por partida, plazos'], bold=True)
    box(d, 20, 22, 250, 48, '', '#EAF7EE', lines=['Dominio puro (packages/domain)', 'reglas, física, arenas, vista por jugador, bot', 'sin red, base de datos ni framework'], bold=True)
    for y in (190, 138, 86):
        arrow(d, 145, y, 145, y - 16)
    box(d, 320, 130, 128, 46, '', '#FFF6E8', lines=['Redis', 'bus de eventos entre', 'réplicas y presencia'])
    box(d, 320, 70, 128, 46, '', '#EAF7EE', lines=['PostgreSQL', 'log de eventos con', 'clave (match_id, seq)'])
    arrow(d, 270, 104, 320, 150, dash=True)
    arrow(d, 270, 100, 320, 94, dash=True)
    d.add(String(384, 190, 'El dominio no conoce a nadie:', fontName=ITALIC, fontSize=7.8, textAnchor='middle'))
    d.add(String(384, 179, 'las flechas solo bajan.', fontName=ITALIC, fontSize=7.8, textAnchor='middle'))
    return d


def lifecycle():
    d = Drawing(468, 168)
    box(d, 4, 104, 76, 34, 'Sala o cola', '#EEF3FF', bold=True)
    box(d, 124, 104, 96, 34, '', '#EAF7EE', lines=['En juego', 'turnos de 30 s'], bold=True)
    box(d, 350, 104, 112, 34, '', lines=['Terminada', 'resultado inmutable'], bold=True)
    box(d, 124, 22, 96, 34, '', '#FFF6E8', lines=['Desconexión', 'gracia de 60 s'], bold=True)
    arrow(d, 80, 121, 124, 121)
    d.add(String(102, 127, '2 listos', fontName=ITALIC, fontSize=7, textAnchor='middle', fillColor=RED))
    arrow(d, 220, 121, 350, 121)
    d.add(String(285, 127, 'sin vida, 12 rondas o abandono', fontName=ITALIC, fontSize=7, textAnchor='middle', fillColor=RED))
    arrow(d, 150, 104, 150, 56)
    d.add(String(140, 80, 'cae', fontName=ITALIC, fontSize=7, textAnchor='end', fillColor=RED))
    arrow(d, 196, 56, 196, 104)
    d.add(String(206, 80, 'vuelve', fontName=ITALIC, fontSize=7, textAnchor='start', fillColor=RED))
    arrow(d, 220, 39, 406, 104)
    d.add(String(318, 48, 'vence la gracia: abandono', fontName=ITALIC, fontSize=7, textAnchor='middle', fillColor=RED))
    d.add(String(172, 154, 'tiempo agotado: pierde el turno y la partida sigue', fontName=ITALIC, fontSize=7.4, textAnchor='middle'))
    return d


# ---------- numeración de páginas ----------
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(BODY, 9)
    canvas.drawCentredString(letter[0] / 2, 0.5 * inch, str(doc.page))
    canvas.restoreState()


# =====================================================================
# Portada
# =====================================================================
story.append(Spacer(1, 0.2 * inch))
logo = Image(str(LOGO))
logo.drawWidth, logo.drawHeight = 3.6 * inch, 3.6 * inch * logo.imageHeight / logo.imageWidth
logo.hAlign = 'CENTER'
story.append(logo)
story.append(Spacer(1, 0.45 * inch))
for text in ('Instituto Tecnológico de Costa Rica', 'Escuela de Ingeniería en Computación', 'Diseño de Software'):
    story.append(Paragraph(text, cover_b))
story.append(Spacer(1, 0.55 * inch))
story.append(Paragraph('Tercer Proyecto: Servidor nivel producción en Azure para un juego por turnos', cover_b))
story.append(Spacer(1, 0.18 * inch))
story.append(Paragraph('ASHENFALL, servidor autoritativo para un duelo 1v1 por turnos de proyectiles', cover_c))
story.append(Spacer(1, 0.5 * inch))
story.append(Paragraph('<b>Estudiante:</b> Kevin Miranda Méndez', cover_c))
story.append(Paragraph('<b>Carné</b> 2024120764', cover_c))
story.append(Spacer(1, 0.2 * inch))
story.append(Paragraph('<b>Profesor:</b> Jonathan Solis Parajeles', cover_c))
story.append(Spacer(1, 0.45 * inch))
story.append(Paragraph('<b>Juego en línea:</b> ' + f'<link href="{URL}" color="#16163F">{URL}</link>', cover_s))
story.append(Paragraph('<b>Repositorio:</b> ' + f'<link href="{REPO}" color="#16163F">{REPO}</link>', cover_s))
story.append(Paragraph('<b>Versión evaluada:</b> etiqueta v1.0.0', cover_s))
story.append(Spacer(1, 0.4 * inch))
story.append(Paragraph('II Semestre 2026', cover_c))
story.append(PageBreak())

# =====================================================================
# 1. Introducción
# =====================================================================
H1('1. Introducción')
P('Este documento presenta el diseño, la construcción y el despliegue del tercer proyecto del curso Diseño de Software: un servidor de nivel producción en Azure para un juego multijugador por turnos. El enunciado pide que cada equipo invente su propio juego y que lo que se evalúe sea el servidor: qué tan bien está construido, qué tan seguro y eficiente es y cuánto sigue los estándares de la industria. El juego es el pretexto, no el producto.')
P('Construí <b>ASHENFALL</b>, un duelo 1v1 por turnos de proyectiles, de fantasía oscura y pixel art, que se juega en el navegador. El servidor es autoritativo: valida cada jugada, simula el tiro, decide el daño y es la única fuente de verdad. Cada partida es un registro de eventos en PostgreSQL con número de secuencia, se puede reproducir jugada por jugada y sobrevive a reinicios y a publicaciones de versiones nuevas. El servidor corre en Azure Container Apps con dos réplicas, Redis, PostgreSQL, Key Vault e identidad administrada, y se despliega con Bicep y GitHub Actions.')
P('El documento explica el juego y cómo cumple las restricciones del enunciado, los requisitos funcionales y técnicos del servidor, la arquitectura y los patrones usados, la seguridad, el rendimiento medido, la infraestructura en Azure, las pruebas, cómo se juega y cómo se instala, y al final una revisión del cumplimiento del enunciado con sus limitaciones. Todas las cifras salen de ejecuciones reales entre el 5 y el 7 de noviembre de 2026; donde algo no se pudo medir, se dice.')
H2('1.1 Enlaces')
table([
    ['Qué', 'Dónde'],
    ['Juego en línea (Azure, disponible durante la revisión)', f'<link href="{URL}" color="#16163F">{URL}</link>'],
    ['Documentación de la API REST (OpenAPI 3.1)', f'<link href="{URL}/docs" color="#16163F">{URL}/docs</link>'],
    ['Repositorio en GitHub (público)', f'<link href="{REPO}" color="#16163F">{REPO}</link>'],
    ['Versión evaluada', 'Etiqueta <b>v1.0.0</b> del repositorio'],
    ['Tablero de trabajo (Jira, proyecto SCRUM)', f'<link href="{JIRA}" color="#16163F">kevinmirandaa04.atlassian.net, proyecto SCRUM</link>'],
    ['Documentación detallada en el repositorio', 'Carpeta <font name="Courier">docs/</font>, con índice en <font name="Courier">docs/README.md</font>'],
], [2.6, 3.9])

# =====================================================================
# 2. Juego
# =====================================================================
H1('2. Juego escogido y objetivo')
P('<b>Historia.</b> Hace siglos, el mundo quedó dividido por un acontecimiento conocido como La Caída de las Cenizas. Las antiguas tierras dejaron de ser seguras y criaturas de las profundidades empezaron a aparecer en bosques, montañas y pueblos abandonados. En medio de ese mundo existe Ashenfall, un pequeño asentamiento comercial donde todavía se reúnen guerreros de todas las regiones, se reparan armas, se intercambian reliquias y se aceptan desafíos.')
P('<b>El duelo.</b> Dos mercenarios se enfrentan en una arena y se turnan para disparar proyectiles con un gesto de tirachinas: arrastran hacia atrás para dar potencia y ángulo, y sueltan. Cada uno empieza con 100 puntos de vida, el turno dura 30 segundos y la partida tiene como máximo 12 rondas. Gana quien deja al rival sin vida; si se acaban las rondas gana quien conserve más vida, y con la misma vida hay empate. Nadie se mueve por su cuenta: solo se desplaza al ser impactado, retrocediendo según el daño recibido. No hay viento.')
P('<b>Modos.</b> Buscar partida (cola rápida contra otra persona), partida privada con código de invitación y modo historia contra diez monstruos que mueve el servidor. Ganar un duelo da 100 Marcas de Ceniza; con ellas y con el nivel se compran nueve personajes más en el Arsenal, pues se empieza con Edrik. Hay siete arenas (aldea en ruinas, cementerio, desierto, pinar con niebla, puente helado, fortaleza carmesí y ruinas brumosas) y en cada partida el servidor sortea el terreno (llano, plataformas con gradas o colina) y los obstáculos.')
P('<b>Objetivo de diseño.</b> Que el juego sirva para ejercitar los problemas reales de un servidor multijugador: muchas partidas simultáneas e independientes, orden de las jugadas, mensajes duplicados, desconexiones, varias réplicas atendiendo la misma partida, información que no debe filtrarse al rival y publicaciones sin cortar partidas.')

H2('2.1 Cumplimiento de las restricciones del juego')
table([
    ['Restricción del enunciado', 'Cómo la cumple ASHENFALL'],
    ['Por turnos: la partida sabe a quién le toca', 'El estado guarda el jugador en turno y su plazo; solo ese jugador puede disparar y el temporizador de 30 s lo controla el servidor.'],
    ['Multijugador: mínimo 2 jugadores humanos', 'Cada partida enfrenta a 2 humanos (cola rápida o sala privada). El modo historia es un extra contra un bot del servidor.'],
    ['Original, no una recreación 1 a 1', 'Reglas propias: duelo de proyectiles con física determinista, retroceso por impacto, terreno y obstáculos sorteados, personajes comprables con nivel y dinero.'],
    ['Reglas verificables', 'El dominio decide sin ambigüedad si una jugada es válida y cuándo termina la partida (vida, rondas, abandono); está cubierto por pruebas unitarias.'],
    ['Información oculta (recomendada)', 'La posición del rival y la trayectoria son públicas por decisión de diseño (la cámara las muestra a ambos). Aun así hay vista por jugador: el rival nunca recibe el ángulo, la potencia ni el identificador de la jugada, y una prueba lo verifica en mensajes, REST y logs.'],
], [2.4, 4.1])

# =====================================================================
# 3. Requisitos funcionales
# =====================================================================
H1('3. Requisitos funcionales del servidor')
P('La API REST tiene 30 rutas y 33 operaciones documentadas en OpenAPI 3.1; el tiempo real usa un solo canal WebSocket documentado en AsyncAPI 3.0. La siguiente tabla relaciona cada capacidad pedida con su implementación.')
table([
    ['Capacidad', 'Qué hace', 'Implementación'],
    ['Usuarios', 'Registro, inicio y cierre de sesión, renovación del token y perfil.', 'POST /v1/auth/register, login, refresh y logout; GET /v1/me. JWT de 15 minutos con refresh token rotativo; contraseñas con Argon2id.'],
    ['Salas', 'Crear partida pública o privada con código, listar, unirse, salir y marcar «listo».', 'POST y GET /v1/rooms, join, join-by-code, leave y ready. Inicia solo con 2 jugadores listos y la capacidad se respeta aunque varios se unan a la vez (prueba de concurrencia).'],
    ['Emparejamiento', 'Cola rápida que agrupa jugadores en partidas nuevas.', 'POST, GET y DELETE /v1/matchmaking. Un jugador nunca queda en dos partidas; espera máxima de 60 s, configurable con MATCHMAKING_MAX_WAIT_MS.'],
    ['Turnos', 'Enviar jugada, recibir el nuevo estado y saber a quién le toca.', 'Mensaje shoot por WebSocket. Solo juega quien tiene el turno; la jugada inválida recibe un error tipado (NOT_YOUR_TURN, STALE_VERSION…); el temporizador de 30 s tiene como acción por defecto perder el turno.'],
    ['Conexión', 'Detectar caídas, reconectar y recuperar el estado.', 'Heartbeat ping/pong, ticket de un solo uso, snapshot al reconectar y periodo de gracia de 60 s configurable (RECONNECT_GRACE_MS); al vencer, abandono.'],
    ['Fin de partida', 'Declarar ganador o empate y registrar el resultado.', 'El resultado se guarda una vez y no cambia (tabla match_results); GET /v1/matches/{id}/replay reproduce la partida jugada por jugada.'],
    ['Historial', 'Partidas jugadas y resultados por usuario.', 'GET /v1/me/matches, paginado; el replay y el detalle solo los ve un participante (404 idéntico al de un recurso inexistente).'],
    ['Administración', 'Ver partidas activas y conexiones, terminar una partida, suspender un usuario.', 'GET /v1/admin/matches, POST terminate, suspend y unsuspend, GET /v1/admin/audit. Solo el rol administrador; cada acción queda auditada con autor, motivo y fecha.'],
], [1.1, 2.0, 3.4])

H2('3.1 Reglas del servidor')
table([
    ['Regla del enunciado', 'Cómo se cumple'],
    ['Servidor autoritativo', 'El cliente envía ángulo y potencia, nunca resultados. El dominio simula el tiro y decide el daño.'],
    ['Orden por partida y número de secuencia', 'Las jugadas de una partida se procesan una a una (fila por partida en cada réplica) y cada evento lleva un seq. Entre réplicas, la clave primaria (match_id, seq) deja confirmar a una sola; la otra relee el log y decide de nuevo. Una jugada sobre una versión vieja se rechaza (STALE_VERSION).'],
    ['Idempotencia', 'Cada jugada lleva un actionId generado por el cliente. Si se reenvía, el servidor responde con un ack marcado duplicate y no la aplica dos veces.'],
    ['Vista por jugador', 'Cada evento se proyecta a la vista de su destinatario. Ningún mensaje, endpoint ni log filtra el ángulo, la potencia ni el actionId del rival.'],
    ['Durabilidad', 'El estado se reconstruye siempre desde PostgreSQL; ninguna jugada confirmada vive solo en memoria. Si una réplica se reinicia o se publica una versión nueva, las partidas continúan.'],
    ['Aislamiento', 'Un fallo en una partida no bloquea la fila de otra ni tumba el proceso: errores contenidos por mensaje y por partida.'],
    ['Limpieza', 'Los plazos de cada partida están en PostgreSQL y todas las réplicas barren los vencidos; las partidas inactivas terminan, las salas sin iniciar se cierran a la hora y la cola filtra por expiración.'],
    ['Reloj y azar del servidor', 'Temporizadores y sorteos (terreno, obstáculos) se resuelven en el servidor con un generador criptográficamente seguro que se inyecta al dominio.'],
], [1.9, 4.6])

# =====================================================================
# 4. Arquitectura
# =====================================================================
H1('4. Arquitectura y patrones de diseño')
H2('4.1 Tecnologías')
table([
    ['Elemento', 'Tecnología'],
    ['Lenguaje', 'TypeScript en modo estricto (strict, sin any) sobre Node.js 22'],
    ['Servidor', 'Fastify 5, WebSocket con la librería ws, validación con esquemas TypeBox'],
    ['Datos', 'PostgreSQL 16 (eventos y datos duraderos) y Redis 7 (difusión, presencia y límites de tasa)'],
    ['Seguridad', 'Argon2id, JWT firmados, refresh token rotativo, ticket de un solo uso para el WebSocket'],
    ['Contratos', 'OpenAPI 3.1 (en /docs), AsyncAPI 3.0, errores RFC 9457 Problem Details'],
    ['Cliente de prueba', 'Phaser 3 con Vite, servido por el propio servidor'],
    ['Pruebas y calidad', 'Vitest, ESLint con typescript-eslint estricto, tsc, CodeQL, gitleaks, Trivy y Dependabot'],
    ['Infraestructura', 'Azure Container Apps, PostgreSQL Flexible Server, Key Vault, Container Registry, Application Insights; Bicep y GitHub Actions'],
], [1.7, 4.8])

H2('4.2 Capas')
P('El motor de reglas vive en un módulo de dominio puro (packages/domain) sin dependencias de red, base de datos ni framework. El servidor conoce al dominio y el dominio no conoce a nadie; ESLint hace cumplir esa regla y no deja importar red, base de datos, reloj ni azar globales dentro del dominio. Por eso las reglas, la física y la vista por jugador se prueban sin ninguna dependencia externa.')
drawing_figure(layers(), 'Capas del código: las dependencias solo bajan hacia el dominio puro.')

H2('4.3 Topología en Azure')
P('Los jugadores se conectan por HTTPS y WSS a cualquier réplica del servidor. El estado caliente y la difusión de eventos entre réplicas pasan por Redis, las jugadas confirmadas se guardan en PostgreSQL y los secretos se leen de Key Vault con identidad administrada. PostgreSQL no tiene acceso público: vive en una subred delegada de una red virtual; Redis solo tiene ingress interno.')
drawing_figure(topology(), 'Topología de producción en Azure (región canadacentral).')

H2('4.4 Patrones usados')
table([
    ['Patrón', 'Dónde y para qué'],
    ['Event sourcing', 'Cada partida es un log de eventos ordenados por seq; el estado es el resultado de reproducirlo (decide, evolve y replay en el dominio). Da durabilidad, reproducción jugada por jugada y recuperación tras reinicios.'],
    ['Comando y decisión pura', 'Un comando (disparar, agotar tiempo, desconectar) entra al dominio, que devuelve una decisión: aplicada con sus eventos, duplicada o rechazada con un código tipado.'],
    ['Cola por partida y control optimista', 'Fila por partida en cada réplica y clave (match_id, seq) entre réplicas, con hasta 5 reintentos al perder un conflicto.'],
    ['Publicación y suscripción', 'Bus de eventos sobre Redis: cada réplica entrega a sus conexiones locales los eventos ya confirmados. Si se pierde un mensaje, el cliente detecta el hueco en seq y pide el estado con sync.'],
    ['Vista por jugador (proyección)', 'toPlayerView y toPlayerEvent proyectan estado y eventos a lo que cada jugador puede ver.'],
    ['Inyección de dependencias', 'El azar (RandomSource), el reloj y la base de datos entran al dominio y a los servicios desde afuera, lo que permite probarlos con simulaciones.'],
    ['Barrido de plazos sin líder', 'Todas las réplicas barren los plazos vencidos; si dos coinciden, el dominio rechaza el comando repetido y la clave de secuencia deja confirmar uno solo.'],
], [1.9, 4.6])

H2('4.5 Flujo de una jugada')
bullets([
    'El cliente envía <font name="Courier">shoot</font> con actionId, expectedVersion, arma, ángulo y potencia.',
    'La pasarela valida el esquema, el tamaño y la tasa de mensajes antes de que lleguen al dominio; un mensaje inválido se rechaza sin cerrar la partida.',
    'El motor encola la jugada en la fila de la partida, carga el log desde PostgreSQL y reproduce el estado.',
    'El dominio decide: ¿es su turno?, ¿la versión es vigente?, ¿el actionId ya se aplicó?',
    'Si se aplica, se insertan los eventos con clave (match_id, seq); si otra réplica ganó ese seq, se relee y se decide de nuevo.',
    'Los eventos confirmados se publican por Redis; cada réplica los entrega con la vista de cada jugador y el tirador recibe su ack.',
])

H2('4.6 Ciclo de vida de una partida')
drawing_figure(lifecycle(), 'Ciclo de vida de una partida.')
P('Los plazos de cada partida están en PostgreSQL (matches.next_deadline_ms) y todas las réplicas barren los vencidos, así que un reinicio no pierde temporizadores. Si un turno se agota, el jugador pierde el turno sin daño; dos turnos agotados seguidos cuentan como abandono. Al desconectarse, el jugador tiene 60 segundos para volver y recibe el estado actual; si no vuelve, pierde por abandono.')

# =====================================================================
# 5. Contratos
# =====================================================================
H1('5. Contratos y protocolo')
P('<b>REST.</b> Usuarios, salas, emparejamiento, historial, tienda y administración están en OpenAPI 3.1, publicada en /docs. Los errores siguen RFC 9457 (Problem Details) con un código propio, por ejemplo VALIDATION_FAILED. Los límites de tasa responden 429 con la cabecera Retry-After.')
P('<b>WebSocket.</b> Un solo canal con mensajes versionados (campo v) documentados en AsyncAPI 3.0: del cliente, shoot y sync; del servidor, welcome, snapshot, event, ack y error. Cada mensaje tiene esquema, ejemplos y errores posibles. La conexión se autentica en el handshake con un ticket de un solo uso de 30 segundos; sin ticket válido se cierra.')
table([
    ['Código de cierre', 'Significado'],
    ['1001', 'Cierre ordenado del servidor (publicación o reinicio): el cliente reconecta.'],
    ['4003', 'Usuario suspendido por un administrador.'],
    ['4008', 'Demasiadas conexiones para ese usuario.'],
    ['4009', 'Se perdió el heartbeat.'],
    ['4029', 'Demasiados mensajes por segundo: límite de tasa por conexión.'],
], [1.4, 5.1])
P('Los contratos se generan desde el código y una prueba falla si dejan de coincidir con él: contracts/openapi.json y contracts/asyncapi.json están sincronizados con las rutas y los mensajes reales.')

# =====================================================================
# 6. Seguridad
# =====================================================================
H1('6. Seguridad')
P('El modelo de amenazas completo (activos, fronteras de confianza, amenazas con su defensa y su prueba, y riesgos aceptados) está en docs/threat-model.md. Resumen de las defensas principales:')
table([
    ['Amenaza', 'Defensa', 'Prueba'],
    ['Fuerza bruta de contraseñas', 'Límite por IP y por cuenta; Argon2id; verificación señuelo si el correo no existe', 'rate-limit.test.ts, auth.test.ts'],
    ['Robo de refresh token', 'Rotación; reutilizar uno revoca la familia; solo se guarda el hash', 'auth.test.ts'],
    ['JWT falsificado', 'Algoritmo fijo; emisor y audiencia verificados', 'auth.test.ts'],
    ['Secuestro del WebSocket desde otra web', 'Ticket de un solo uso de 30 s y orígenes restringidos', 'gateway.test.ts'],
    ['Enviar daño o resultados', 'El esquema rechaza campos extra; el servidor calcula todo', 'gateway.test.ts'],
    ['Jugar fuera de turno o sobre estado viejo', 'El dominio valida turno y versión', 'match.test.ts, gateway.test.ts'],
    ['Reenviar una jugada', 'actionId idempotente y clave (match_id, seq)', 'gateway.test.ts, resilience.test.ts'],
    ['Ver datos del rival o partidas ajenas', 'Vista por jugador; 404 idéntico al de un recurso inexistente', 'view.test.ts, history.test.ts'],
    ['Duplicar monedas o fijar un precio', 'Precio del servidor, billetera bloqueada y claves únicas', 'shop.test.ts, event-store.test.ts'],
    ['Inundar la API o el WebSocket', 'Límites por usuario e IP (429 con Retry-After), tamaño máximo de mensaje, tasa por conexión y conexiones por usuario', 'rate-limit.test.ts, gateway.test.ts'],
    ['Pico de logins que agota CPU o memoria', 'Argon2id acotado con fila y respuesta 503', 'password-hasher.test.ts'],
    ['Usar funciones de administrador', 'Rol leído de la base en cada petición; ninguna ruta lo concede; auditoría', 'admin.test.ts'],
    ['Secreto en el repositorio o en logs', 'gitleaks en CI; sin valores por defecto; logs sin cabeceras ni cuerpos', 'CI, hardening.test.ts'],
    ['Imagen o dependencias comprometidas', 'Usuario no root; Trivy, CodeQL y Dependabot en CI', 'CI'],
], [1.9, 3.1, 1.5])
H2('6.1 Secretos, identidad y transporte')
bullets([
    'El secreto de los JWT vive en Key Vault y la aplicación lo lee con su identidad administrada; no hay ningún secreto en el repositorio ni en texto plano en la configuración.',
    'PostgreSQL se accede con identidad de Microsoft Entra (contraseña desactivada); la cadena de conexión no trae clave.',
    'El despliegue desde GitHub usa OIDC federado, sin secretos guardados en el repositorio.',
    'Solo HTTPS y WSS: <font name="Courier">http://</font> redirige con 301, hay HSTS, CSP y nosniff; CORS y los orígenes del WebSocket están restringidos (un origen ajeno recibe 403).',
])
H2('6.2 Riesgos aceptados')
bullets([
    'La posición del rival es pública por decisión de diseño; un cliente modificado solo obtiene lo que el jugador ya ve, aunque podría calcular el tiro perfecto.',
    'Agotar el límite de login por cuenta bloquea a su dueño un minuto; se prefiere a permitir fuerza bruta distribuida.',
    'Con Redis caído, los límites de tasa por plugin dejan de aplicarse para no tumbar el servicio y no se pueden emitir tickets nuevos.',
    'Una réplica que cae de golpe no registra desconexiones; sus partidas terminan por los plazos de turno.',
])

# =====================================================================
# 7. Rendimiento
# =====================================================================
H1('7. Rendimiento y optimización')
P('La prueba de carga es reproducible: el bot de apps/bot juega partidas reales por HTTP y WebSocket y mide el tiempo desde que se envía una jugada hasta que ambos jugadores reciben el resultado. Las metas del enunciado son p95 menor a 200 ms, ninguna jugada perdida o duplicada y error menor a 1 %. Las pruebas locales se hicieron con una réplica limitada a 1 CPU y 1 GB, con PostgreSQL y Redis sin límite y el bot en la misma máquina (5 de noviembre de 2026).')
H2('7.1 Ritmo normal: un disparo por segundo y partida')
P('Sin jugadas perdidas ni duplicadas y sin errores en ningún escalón.')
table([
    ['Partidas', 'Conexiones', 'Jugadas', 'Jugadas/s', 'p50', 'p95', 'p99', 'CPU réplica', 'Memoria máx.'],
    ['25', '50', '300', '23', '9 ms', '15 ms', '16 ms', '11 %', '53 MB'],
    ['50', '100', '600', '46', '7 ms', '13 ms', '17 ms', '13 %', '55 MB'],
    ['100', '200', '1 200', '92', '4 ms', '14 ms', '17 ms', '13 %', '56 MB'],
    ['200', '400', '2 400', '184', '3 ms', '9 ms', '24 ms', '15 %', '61 MB'],
    ['400', '800', '4 800', '369', '2 ms', '5 ms', '7 ms', '21 %', '66 MB'],
    ['800', '1 600', '9 600', '737', '2 ms', '7 ms', '17 ms', '33 %', '75 MB'],
], [0.72, 0.95, 0.62, 0.75, 0.48, 0.48, 0.48, 0.85, 0.95])
P('Entre 400 y 800 partidas, el consumo es de unos 0,03 puntos de CPU y 0,02 MB por partida activa (la memoria incluye lo que el proceso ya tenía reservado, así que es una aproximación).')
H2('7.2 Punto de quiebre')
P('Con diez disparos por segundo y partida, para saturar sin crear miles de cuentas. Ninguna jugada se perdió ni duplicó, tampoco al degradarse.')
table([
    ['Partidas', 'Jugadas/s', 'p50', 'p95', 'p99', 'CPU réplica', 'CPU PostgreSQL', 'Meta p95'],
    ['200', '1 692', '7 ms', '43 ms', '52 ms', '51 %', '46 %', 'Cumple'],
    ['400', '1 781', '119 ms', '198 ms', '225 ms', '66 %', '95 %', 'En el límite'],
    ['800', '1 845', '327 ms', '428 ms', '453 ms', '98 %', '80 %', 'No cumple'],
], [0.75, 0.8, 0.65, 0.65, 0.65, 0.95, 1.2, 0.85])
P('Una réplica deja de cumplir la meta alrededor de <b>1 800 jugadas por segundo</b>. A un disparo por segundo y partida se midió sin degradación hasta 800 partidas; extrapolando, el tope rondaría 1 700 partidas, pero esa cifra no se midió.')
H2('7.3 Optimizaciones medidas')
table([
    ['Medida', 'Antes', 'Después'],
    ['p95 de las jugadas con 100 clientes enviando logins fallidos sin parar (Argon2id acotado a una contraseña a la vez)', '202 ms', '109 ms'],
    ['Preparar 100 partidas con sus 200 cuentas (Argon2id con parámetros mínimos de OWASP)', '57 s', '5 s'],
    ['Idas y vueltas a PostgreSQL por jugada', '7', '5'],
    ['Jugadas por segundo en saturación (400 y 800 partidas, dos ejecuciones)', '1 593 a 1 647', '1 754 a 1 839'],
    ['Listado de salas públicas (50 salas)', '101 consultas, p95 7,5 ms', '2 consultas, p95 1,1 ms'],
    ['Descarga de un jugador nuevo hasta empezar una partida', '105 peticiones, 3,84 MB', '47 peticiones, 1,29 MB'],
    ['Imagen Docker (disco)', '565 MB', '387 MB'],
    ['Consultas a PostgreSQL en reposo', '4,42 transacciones/s', '2,76 transacciones/s'],
], [3.9, 1.3, 1.3])
P('Coste aceptado de la primera optimización: una sola réplica procesa unos 20 logins por segundo en un pico, así que en un ataque algunos usuarios reciben 503 y deben reintentar; se prefiere a poner en riesgo las partidas en curso. El detalle de cada cambio está en docs/optimizacion.md.')
H2('7.4 Mensajes compactos')
P('El WebSocket usa JSON con los campos mínimos y trayectorias en enteros muestreados: unos 302 bytes por mensaje de media; el estado completo solo viaja al conectar o al pedir sync, y el resto del tiempo se envían solo los eventos nuevos.')
H2('7.5 Mediciones en Azure (7 de noviembre de 2026)')
P('Contra la URL pública de producción, con el bot en un portátil en Costa Rica, por lo que las latencias de extremo a extremo incluyen el viaje por internet hasta Canadá.')
table([
    ['Prueba', 'Partidas en paralelo', 'Duración', 'Jugadas confirmadas', 'Partidas contrastadas', 'Perdidas / duplicadas / errores'],
    ['Control, 1 réplica', '6', '11,2 min', '473', '18', '0 / 0 / 0'],
    ['Durante la publicación de la revisión con 2 réplicas', '6', '6,9 min', '288', '12', '0 / 0 / 0'],
    ['Sobre las 2 réplicas nuevas', '8', '7,1 min', '518', '16', '0 / 0 / 0'],
], [2.2, 0.85, 0.75, 0.85, 0.9, 0.95])
bullets([
    'Cada partida se contrastó con su replay del servidor: toda jugada confirmada figura una sola vez.',
    'Las jugadas se repartieron entre las réplicas: 261 y 257 en las dos nuevas y 240 en la anterior, con partidas cuyos jugadores quedaban en réplicas distintas.',
    'La métrica del servidor ashenfall.shot.latency (desde que llega la jugada hasta repartirla), leída en Application Insights, dio media de 15,6 ms en una primera carga corta (91 jugadas, máximo de 61 ms) y de 17,7 y 17,9 ms en las dos réplicas nuevas; el máximo en estas últimas fue de 203 ms en una jugada.',
    'De extremo a extremo con internet de por medio, una carga corta dio p50 de 141 ms y p95 de 216 ms: el p95 supera 200 ms por el viaje desde Costa Rica, no por el servidor.',
    'No se midió el punto de quiebre dentro de Azure; el de una réplica está medido en local.',
])

# =====================================================================
# 8. Azure
# =====================================================================
H1('8. Azure, infraestructura como código y CI/CD')
H2('8.1 Recursos')
table([
    ['Recurso', 'Configuración'],
    ['Container Apps (servidor)', 'Revisiones múltiples con división de tráfico; prod con 2 a 3 réplicas de 0,5 vCPU y 1 GiB; sondas /health/live y /health/ready'],
    ['Container Apps (Redis)', '0,25 vCPU y 0,5 GiB, ingress solo interno'],
    ['PostgreSQL Flexible Server', 'Burstable B1ms, 32 GB, sin alta disponibilidad, subred delegada, acceso público desactivado, autenticación con Entra'],
    ['Key Vault', 'jwt-secret y cadena de Application Insights, leídos con identidad administrada'],
    ['Container Registry', 'SKU Basic, imagen del servidor etiquetada con el sha del commit'],
    ['Application Insights y Log Analytics', 'OpenTelemetry; retención de 30 días; 3 alertas (reinicios, CPU de PostgreSQL y latencia)'],
    ['Identidad administrada', 'Una identidad de usuario para ACR, Key Vault y PostgreSQL; ninguna clave en la configuración'],
], [2.1, 4.4])
P('Todos los recursos están en Bicep (infra/main.bicep) y un ambiente nuevo se levanta con una sola ejecución del pipeline. Los requisitos previos (identidad de GitHub con credenciales federadas, roles en la suscripción y registro de proveedores) se hacen una vez desde el portal y están en docs/azure-setup.md.')
H2('8.2 Pipeline')
bullets([
    '<b>CI</b> (GitHub Actions) en cada pull request: build, linter, pruebas, validación de contratos, CodeQL, gitleaks, escaneo de la imagen con Trivy; Dependabot para dependencias.',
    '<b>Despliegue</b> con inicio de sesión OIDC sin secretos: crea el grupo de recursos, la infraestructura base, construye y publica la imagen en ACR, crea jwt-secret en Key Vault si no existe y despliega la aplicación.',
    '<b>Publicaciones sin cortar partidas:</b> la revisión nueva nace al 0 % del tráfico, se prueba por su propia URL (smoke test) y solo entonces recibe el 100 %; la revisión anterior queda activa para el rollback y las más viejas se desactivan, con 120 s de gracia para cerrar conexiones de forma ordenada.',
    '<b>Prod con aprobación manual:</b> el environment prod exige un revisor; el trabajo espera su aprobación antes de empezar.',
    '<b>Rollback:</b> scripts/rollback.sh pasa el 100 % del tráfico a la revisión anterior. Se probó en producción el 7 de noviembre de 2026 y tardó <b>22 segundos</b>, con /health/ready en 200 durante el cambio (meta: menos de 5 minutos).',
])
H2('8.3 Límite de la suscripción y decisión')
P('Azure for Students permite un solo entorno de Container Apps por suscripción (el despliegue falla con el error MaxNumberOfGlobalEnvironmentsInSubExceeded; se comprobó incluso con dev en otra región). Por eso dev y prod no pueden existir a la vez. Dev se desplegó desde cero con el pipeline, se probó y se borró para dejar sitio a prod; el despliegue automático a dev (AUTO_DEPLOY) queda apagado. El Bicep y el pipeline de dev siguen en el repositorio y funcionan en una suscripción sin ese límite, con dev automático tras cada CI verde y prod con aprobación manual. Con dev borrado, el pipeline admite lanzar solo prod.', st_left)

# =====================================================================
# 9. Observabilidad
# =====================================================================
H1('9. Observabilidad')
table([
    ['Elemento', 'Detalle'],
    ['Métricas propias (OpenTelemetry → Application Insights)', 'ashenfall.matches.active (partidas activas, en todas las réplicas), ashenfall.connections, ashenfall.shots (jugadas; la tasa por segundo se calcula al consultar) y ashenfall.shot.latency (latencia por jugada).'],
    ['Trazas', 'Un span por comando (match.shoot, match.turn_timeout, match.player_disconnected…) con ashenfall.match_id y ashenfall.player_id; se comprobó en Application Insights.'],
    ['Logs estructurados', 'Con el id de la partida y del jugador y el id de traza para cruzarlos; sin cuerpos ni cabeceras de autorización.'],
    ['Sondas', '/health/live (el proceso responde) y /health/ready (PostgreSQL y Redis disponibles).'],
    ['Alertas', 'Tres alertas activas en Azure: reinicios del contenedor, CPU de PostgreSQL y latencia.'],
], [2.1, 4.4])

# =====================================================================
# 10. Pruebas
# =====================================================================
H1('10. Pruebas y calidad')
P('Hay 294 pruebas en 24 archivos (resultado del 7 de noviembre de 2026), que CI ejecuta en cada pull request junto con el linter y la revisión de tipos. Las pruebas de integración usan PostgreSQL y Redis reales.')
table([
    ['Tipo de prueba', 'Qué cubre', 'Archivos'],
    ['Dominio y física', 'Reglas, turnos, daño, terreno y obstáculos sorteados con su solución, vista por jugador, progresión y bot', 'match, physics, view, progression, bot'],
    ['API', 'Usuarios, salas, historial, tienda, administración y contratos sincronizados con el código', 'auth, rooms, history, shop, admin, contracts'],
    ['WebSocket y concurrencia', 'Orden, idempotencia, jugadas simultáneas, varias instancias, reconexión, abandono y sync', 'gateway, event-store, matchmaking'],
    ['Resiliencia', 'Reinicio de una réplica, log dañado en una partida sin afectar a las demás, limpieza', 'resilience, pool, health'],
    ['Seguridad', 'Autorización por partida y por rol, límites de tasa, cabeceras, logs sin secretos, no filtración al rival', 'hardening, rate-limit, password-hasher'],
    ['Compras y recompensas', 'Compras concurrentes y recompensa duplicada', 'shop, event-store'],
    ['Observabilidad y estáticos', 'Métricas, trazas y servicio de ficheros precomprimidos', 'telemetry, static, config'],
], [1.5, 3.5, 1.5])
P('Además de las pruebas automáticas hay dos bots reproducibles: <font name="Courier">apps/bot/src/load.ts</font> (carga y punto de quiebre) y <font name="Courier">apps/bot/src/redeploy.ts</font> (partidas abiertas con clientes que se reconectan y reenvían con el mismo actionId, contrastadas con el replay). Probé este último reiniciando un servidor local a media partida: 6 reconexiones y 98 de 98 jugadas confirmadas y coincidentes con el replay.')

# =====================================================================
# 11. Cómo jugar
# =====================================================================
H1('11. Cómo jugar')
P('Se necesita solo un navegador; en el móvil se juega en horizontal y, si se sostiene en vertical, el juego pide girar el dispositivo. Para crear una cuenta basta un correo y una contraseña de al menos 10 caracteres.')
figure(IMG / '01-acceso.jpg', 'Pantalla de acceso: crear cuenta o entrar.', 5.2)
figure(IMG / '02-pueblo.jpg', 'El pueblo de Ashenfall: barra inferior con Personajes, Jugar y Perfil, el Arsenal, el Historial y los ajustes.', 5.2)
P('<b>Elegir cómo pelear.</b> El botón Jugar ofrece buscar partida (cola rápida contra otra persona, con espera máxima de un minuto), modo historia (un monstruo del servidor) y partida privada (crear sala y compartir el código, o unirse con el código de un amigo).')
figure(IMG / '03-jugar.jpg', 'Menú Jugar.', 5.0)
figure(IMG / '04-modo-historia.jpg', 'Modo historia: diez monstruos que se desbloquean en orden.', 5.0)
P('<b>El duelo.</b> Arriba se ven la vida de cada uno, de quién es el turno, los segundos restantes y la ronda; abajo, el arma y la potencia. Para disparar se mantiene pulsado el botón del ratón (o el dedo) y se arrastra hacia atrás, lejos del rival: cuanto más lejos, más fuerza, y subir o bajar el cursor cambia la altura. Una guía de puntos muestra la trayectoria con la potencia y el ángulo en porcentaje. Al soltar se dispara; Esc o el clic derecho cancelan el apuntado.')
figure(IMG / '09-arena-apuntar.jpg', 'Arena con la guía de puntería, el turno, la vida y la potencia.', 5.4)
bullets([
    'Nadie se mueve a voluntad: solo se retrocede al recibir un impacto, según el daño. No hay viento y los obstáculos frenan los proyectiles.',
    'Si se agota el tiempo se pierde el turno; dos turnos agotados seguidos cuentan como abandono.',
    'Si alguien se desconecta tiene un minuto para volver y recibe el estado actual de la partida.',
    'Ganar da 100 Marcas de Ceniza; perder o empatar no da nada. Cada partida suma 10 de experiencia y 30 más si se gana; cada nivel pide 80, hasta el nivel 20.',
])
figure(IMG / '06-perfil.jpg', 'Perfil: personaje, nivel, experiencia, victorias, derrotas y empates.', 4.9)
figure(IMG / '05-arsenal.jpg', 'Arsenal: los nueve personajes que se compran con nivel y Marcas de Ceniza.', 5.0)
P('Se empieza con Edrik, el Errante. El Arsenal vende a Sylwen (nivel 2, 500), Borgrim (3, 600), Aldric (4, 700), Mirelle (5, 700), Rurik (6, 800), Vaela (7, 900), Anselmo (8, 900), Corvus (9, 1 000) y Morveth (10, 1 200); cada uno usa siempre su propia arma. En Ajustes se controla el volumen de la música y de los efectos y está el correo para reportar problemas.')
figure(IMG / '08-ajustes.jpg', 'Ajustes: volumen, correo de contacto y cierre de sesión.', 4.9)

# =====================================================================
# 12. Instalación
# =====================================================================
H1('12. Instalación y uso')
H2('12.1 Jugar en línea')
P(f'Abrir <link href="{URL}" color="#16163F">{URL}</link> en un navegador y crear una cuenta. La documentación de la API está en <link href="{URL}/docs" color="#16163F">{URL}/docs</link>. Para probar un duelo entre humanos con una sola persona, abrir el juego en dos navegadores (o en una ventana normal y otra privada) con una cuenta distinta en cada uno.', st_left)
H2('12.2 Correr en local (menos de 10 minutos)')
P('Solo se necesita Docker Desktop abierto; no hace falta Node ni configurar secretos.')
code('git clone ' + REPO + '.git\ncd ashenfall-game\ndocker compose up --build')
P('Levanta PostgreSQL, Redis y el servidor; las migraciones se aplican al arrancar. El juego queda en http://localhost:8080, la API en http://localhost:8080/docs y las sondas en /health/live y /health/ready. La imagen del servidor se construye sin caché en alrededor de un minuto en un Mac con Docker Desktop (medido el 7 de noviembre; depende de la red).')
H2('12.3 Correr las pruebas')
code('npm ci\ndocker compose up -d --wait postgres redis\nnpm test')
P('Otros comandos: <font name="Courier">npm run lint</font>, <font name="Courier">npm run typecheck</font>, <font name="Courier">npm run build</font> y <font name="Courier">npm run test:coverage</font>. La prueba de carga con el bot está explicada en docs/load-report.md.')
H2('12.4 Administración')
P('Ninguna ruta de la API concede el rol de administrador. Para dárselo a una cuenta ya registrada:')
code('docker compose exec server node apps/server/dist/db/grant-admin-cli.js correo@ejemplo.com')

# =====================================================================
# 13. Costo
# =====================================================================
H1('13. Costo estimado en Azure')
P('Es una estimación con precios de lista consultados el 5 de noviembre de 2026 (región northeurope, USD), no una factura; los precios cambian por región. Supuestos: mes de 30 días, sin descontar cuotas gratuitas y sin tráfico de salida. Detalle y supuestos en docs/azure-cost.md.')
table([
    ['Recurso', 'Configuración', 'USD por mes'],
    ['PostgreSQL B1ms (cómputo)', 'Burstable, sin alta disponibilidad', '13,14'],
    ['Container Registry Basic', 'SKU mínimo', '5,00'],
    ['Redis (Container App)', '0,25 vCPU y 0,5 GiB, 1 réplica fija', '5,8 a 19,4'],
    ['Servidor de prod', '0,5 vCPU y 1 GiB, 2 réplicas mínimas', '23,4 a 77,8 (11,7 a 38,9 por réplica)'],
    ['Log Analytics, Key Vault y alertas', 'Retención de 30 días, tope de 1 GB al día', 'desde 0; peor caso 69 en logs'],
    ['<b>Total aproximado de prod</b>', 'Sin almacenamiento de PostgreSQL ni logs', '<b>~47 a ~115</b>'],
], [2.0, 2.6, 1.9])
P('Azure for Students suele dar 100 USD de crédito (confirmarlo en el portal), así que el costo es ajustado: se redujo con contenedores de tamaño mínimo, sin copiar métricas de plataforma a Log Analytics y sin registrar las sondas. Dev no se mantiene encendido: se borra tras probar. Pasado el periodo de revisión se recomienda borrar el grupo de recursos de producción para no gastar crédito.')

# =====================================================================
# 14. Planeación
# =====================================================================
H1('14. Planeación y proceso')
P('El trabajo se organizó con el flujo que pide el curso: un ticket de Jira por tarea (proyecto SCRUM), una rama por ticket, commits con la clave del ticket, un pull request por ticket y los estados de Jira movidos a medida que avanzaba cada uno. Hay diez épicas (SCRUM-5 a SCRUM-14) y más de 50 pull requests fusionados.')
table([
    ['Épica', 'Contenido'],
    ['SCRUM-5 Fundación del repo y flujo de trabajo', 'Repositorio, ramas, convenciones, CI inicial'],
    ['SCRUM-6 Dominio puro del duelo', 'Reglas, turnos, física, pruebas del dominio'],
    ['SCRUM-7 API REST y usuarios', 'Registro, sesiones, salas, historial, administración'],
    ['SCRUM-8 Tiempo real por WebSocket', 'Protocolo, ticket, heartbeat, validación de mensajes'],
    ['SCRUM-9 Persistencia y multi-réplica', 'Log de eventos, Redis, orden e idempotencia entre réplicas'],
    ['SCRUM-10 Seguridad', 'Argon2id, JWT, límites de tasa, modelo de amenazas'],
    ['SCRUM-11 Cliente del juego', 'Cliente de prueba con Phaser, pueblo, arena, tienda'],
    ['SCRUM-12 Azure, IaC y CI/CD', 'Bicep, GitHub Actions, identidad, publicaciones y rollback'],
    ['SCRUM-13 Observabilidad', 'OpenTelemetry, métricas propias, sondas, alertas'],
    ['SCRUM-14 Rendimiento y entrega', 'Prueba de carga, optimizaciones, documentación y etiqueta v1.0.0'],
], [2.7, 3.8])
P('En la etapa final se hicieron, cada una con su ticket y su pull request: personajes comprables con nivel y dinero (SCRUM-62 a 66), terreno y obstáculos aleatorios por partida (67), correcciones de las pruebas del usuario (68), QA y limpieza (69), optimización medida (70), auditoría contra el enunciado (72), despliegue de producción (73), README con la historia y cómo jugar (74), publicación solo a prod y rollback probado (75 y 76), verificación en Azure y soporte móvil (77 a 79), guía de juego y arquitectura (80) y esta documentación (81). Las decisiones de arquitectura y de juego están en docs/DECISIONS.md.')

# =====================================================================
# 15. Cumplimiento
# =====================================================================
H1('15. Cumplimiento del enunciado')
P('La matriz completa, con 94 requisitos, su evidencia (código, prueba, documento, workflow o Bicep) y su estado, está en docs/cumplimiento-enunciado.md. Resultado: <b>92 requisitos cumplidos, 2 cumplidos parcialmente y ninguno incumplido</b>. Resumen por criterio de la rúbrica:')
table([
    ['Criterio (peso)', 'Evidencia principal', 'Estado'],
    ['Arquitectura y calidad de construcción (20 %)', 'Dominio puro aislado y verificado por ESLint; capas; TypeScript estricto sin any; arquitectura documentada con diagramas', 'Cumple'],
    ['Sesiones y concurrencia (20 %)', 'Orden por partida, idempotencia, reconexión, abandono, plazos en PostgreSQL, varias réplicas probadas en Azure, publicación con partidas abiertas sin pérdidas', 'Cumple'],
    ['Seguridad (20 %)', 'Autenticación y autorización por partida en HTTP y WebSocket, validación de cada mensaje, límites de tasa, sin filtración al rival, secretos en Key Vault, modelo de amenazas, sin secretos en el repositorio', 'Cumple'],
    ['Rendimiento y optimización (15 %)', 'Prueba de carga reproducible; p95 de 15 ms o menos hasta 800 partidas en local; punto de quiebre medido (~1 800 jugadas/s por réplica); dos optimizaciones con cifras; mediciones en Azure', 'Cumple'],
    ['Despliegue en Azure, IaC y CI/CD (10 %)', 'Bicep, pipeline con OIDC, identidad administrada, prod con aprobación, publicaciones sin cortes, rollback de 22 s, ambiente levantado desde cero por el pipeline', 'Cumple (dev automático parcial por el límite de la suscripción)'],
    ['Estándares, contratos y pruebas (10 %)', 'OpenAPI 3.1 y AsyncAPI 3.0 sincronizados con el código, Problem Details, 294 pruebas unitarias, de integración, concurrencia, seguridad y resiliencia en verde en CI', 'Cumple'],
    ['Documentación y observabilidad (5 %)', 'Este documento y la carpeta docs/; logs y trazas con id de partida y jugador; cuatro métricas propias; sondas; tres alertas', 'Cumple'],
], [1.9, 3.5, 1.1])

# =====================================================================
# 16. Limitaciones
# =====================================================================
H1('16. Limitaciones y trabajo futuro')
bullets([
    '<b>Dev automático:</b> Azure for Students permite un solo entorno de Container Apps por suscripción, así que dev y prod no pueden coexistir y el despliegue automático a dev quedó apagado. Es el único requisito que cumple parcialmente por una restricción externa.',
    '<b>Información oculta:</b> es opcional en el enunciado; la posición del rival y la trayectoria son públicas por diseño. Sí hay vista por jugador y prueba de no filtración.',
    '<b>Latencia en Azure:</b> la carga se hizo desde internet y en escalones pequeños (hasta 8 partidas). La latencia medida en el servidor es baja (media de unos 17 ms), pero el punto de quiebre solo está medido en local y habría que repetirlo dentro de Azure con carga alta.',
    '<b>Navegadores:</b> el cliente se probó en Chromium, en un navegador de escritorio y en emulación móvil horizontal. Safari y Firefox no se pudieron probar con navegadores reales; el código se compila para Safari 14 o superior, Firefox 78 y Chrome 87.',
    '<b>Cliente:</b> el cliente es de prueba; no tiene nota. El móvil solo se juega en horizontal.',
    '<b>Mejoras posibles:</b> alertas por correo (el parámetro existe y falta pasarlo en el pipeline), un rastreo de dependencias con las actualizaciones mayores de Dependabot (TypeScript 7, ESLint 10 y Vitest 5 están pendientes de revisar) y medir el punto de quiebre dentro de Azure.',
])

# =====================================================================
# 17. Conclusión
# =====================================================================
H1('17. Conclusión')
P('ASHENFALL cumple lo que pide el proyecto: un servidor autoritativo, seguro y observable, con muchas partidas simultáneas e independientes, orden e idempotencia de las jugadas, reconexión y abandono, varias réplicas coordinadas por PostgreSQL y Redis, y publicaciones sin cortar partidas, desplegado en Azure con infraestructura como código, identidad administrada y un pipeline con aprobación manual a producción. Las cifras de rendimiento y de resiliencia salen de ejecuciones reales y reproducibles con los bots incluidos en el repositorio, y donde algo no se pudo comprobar o la suscripción lo impide se dice en este documento.')
P(f'El juego está disponible en <link href="{URL}" color="#16163F">{URL}</link> durante el periodo de revisión, y el código, la infraestructura, los pipelines, los contratos, las pruebas, los bots y la documentación están en <link href="{REPO}" color="#16163F">{REPO}</link>, en la versión etiquetada v1.0.0.', st_left)


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=0.9 * inch,
                            title='Documentación de ASHENFALL', author='Kevin Miranda Méndez',
                            subject='Tercer Proyecto: Servidor nivel producción en Azure para un juego por turnos')
    doc.build(story, onFirstPage=lambda c, d: None, onLaterPages=footer)
    print('PDF escrito en', OUT)


if __name__ == '__main__':
    build()
