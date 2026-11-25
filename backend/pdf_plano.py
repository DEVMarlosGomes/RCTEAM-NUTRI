"""PDF do plano alimentar no padrão da marca (item 8 dos ajustes do Rogério).

Azul #0081FD e preto; títulos Montserrat (no lugar da Pirulen) e textos DM Sans (no lugar da DIN); topo preto com
logo, PLANO ALIMENTAR e data; resumo preto com kcal e macros; cartões de hidratação e orientações; uma refeição
por cartão com selo do horário e alternativas em pílulas "OU"; faixa preta "Total do dia"; página de orientações
com etiquetas PODE / EVITE / ATÉ 100 G; rodapé preto com @rogeriocostatreinador e nº da página (sem endereço).
Nomes limpos (sem fonte da tabela, sem marca, sem nome científico). Fundo branco para economizar tinta.
"""
import base64
import html
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

AZUL = "#0081FD"
INSTAGRAM = "@rogeriocostatreinador"
_PASTA = Path(__file__).parent / "pdf_marca"


def _img64(nome: str) -> str:
    try:
        return "data:image/png;base64," + base64.b64encode((_PASTA / nome).read_bytes()).decode()
    except OSError:
        return ""


LOGO_BRANCO = _img64("logo_branco.png")
SIMBOLO = _img64("simbolo_azul.png")

# ── nomes limpos para o cliente ────────────────────────────────────────────
_MARCAS = ["Integralmedica", "Integral Medica", "Pullman", "Gallo", "Panco", "Seven Boys", "Wickbold", "Toddy", "Batavo",
           "Parmalat", "Kellogg's", "Kelloggs", "La Sereníssima", "Max Titanium", "Ninho", "Nestlé", "Nestle", "Sadia",
           "Perdigão", "Seara", "Piracanjuba", "Italac", "Vigor", "Danone", "Yoki", "Quaker", "Bauducco", "Growth",
           "Dux", "Probiótica", "Black Skull", "Optimum Nutrition"]
_FONTES = r"\(?\b(TACO|TBCA|IBGE|Tucunduva|USDA)\b\)?"


def nome_limpo(nome: str) -> str:
    n = str(nome or "").replace("®", "").replace("™", "")
    n = re.sub(_FONTES, "", n, flags=re.I)
    for m in _MARCAS:
        n = re.sub(rf"\s*-?\s*\b{re.escape(m)}\b", "", n, flags=re.I)
    # nome científico (gênero + espécie) e "s/ sal, drenado" de tabela
    n = re.sub(r",\s*[A-Z][a-z]+ [a-z]+(?: [A-Z]\.?)?(?:,|$)", ",", n)
    n = re.sub(r"/\s*\d+\s*minutos?", "", n, flags=re.I)
    n = re.sub(r"\s*-\s*$", "", n)
    n = re.sub(r"\s*,\s*,", ",", n)
    n = re.sub(r"[\s,]+$", "", n).strip()
    return n or str(nome or "")


def _esc(v) -> str:
    return html.escape(str(v if v is not None else ""))


def _num(v, casas=1) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "0"
    if abs(f - round(f)) < 0.05:
        return str(int(round(f)))
    return f"{f:.{casas}f}".replace(".", ",")


def _plural(medida: str, qtd: float) -> str:
    m = medida.strip()
    if qtd <= 1:
        return m.lower()
    trocas = [(r"^colher", "colheres"), (r"^unidade", "unidades"), (r"^fatia", "fatias"), (r"^concha", "conchas"),
              (r"^xícara", "xícaras"), (r"^copo", "copos"), (r"^pedaço", "pedaços"), (r"^escumadeira", "escumadeiras"),
              (r"^porção", "porções"), (r"^filé", "filés"), (r"^bife", "bifes"), (r"^pote", "potes")]
    ml = m.lower()
    for rx, sub in trocas:
        if re.match(rx, ml):
            return re.sub(rx, sub, ml, count=1)
    return ml


def quantidade(item: dict) -> str:
    medida = str(item.get("medida_nome") or "")
    g = item.get("quantidade_g")
    try:
        g = float(g or 0)
    except (TypeError, ValueError):
        g = 0
    unidade = "ml" if "ml" in medida.lower() else "g"
    gramas = f"{_num(g)} {unidade}" if g else ""
    if not medida or medida.lower() == "gramas":
        return gramas
    try:
        q = float(item.get("quantidade") or 0)
    except (TypeError, ValueError):
        q = 0
    caseira = f"{_num(q)} {_plural(medida, q)}".strip()
    return f"{caseira} · {gramas}" if gramas else caseira


# ── orientações: tema e etiqueta ───────────────────────────────────────────
TEMAS = [
    ("Bebidas", "B", r"\b(água|agua|bebida|suco|refrigerante|café|cafe|chá|cha|álcool|alcool|cerveja|vinho|isotônico|hidrata)"),
    ("Calorias livres", "C", r"\b(livre|à vontade|a vontade|tempero|adoçante|adocante|zero|diet|light)"),
    ("Preparo", "P", r"\b(prepar|assad|grelhad|cozid|frit|azeite|óleo|oleo|air ?fryer|forno|refogad|sal\b)"),
    ("Frutas", "F", r"\b(fruta|banana|maçã|maca|mamão|mamao|morango|laranja|uva)"),
    ("Carnes e peixes", "M", r"\b(carne|frango|peixe|patinho|alcatra|ovo|atum|tilápia|tilapia|coxão|coxao|músculo|musculo|lombo|filé|file)"),
    ("Vegetais", "V", r"\b(vegeta|verdura|legume|salada|folha|grupo a|grupo b|brócolis|brocolis|alface)"),
]


def etiqueta(frase: str) -> Optional[str]:
    f = frase.lower()
    if re.search(r"até\s*100\s*g|ate\s*100\s*g", f):
        return "ATÉ 100 G"
    if re.search(r"\b(evit|não |nao |nunca|proib|reduz|limit)", f):
        return "EVITE"
    if re.search(r"\b(pode|liberad|à vontade|a vontade|prefira|use|inclua|consuma|beba)", f):
        return "PODE"
    return None


def tema(titulo: str, texto: str) -> tuple:
    # o título da orientação manda; sem título que bata, vale a frase
    for base in (str(titulo or "").lower(), f"{titulo} {texto}".lower()):
        for nome, letra, rx in TEMAS:
            if re.search(rx, base):
                return nome, letra
    return (titulo.strip() or "Orientações"), (titulo.strip()[:1].upper() or "O")


def _frases(texto: str) -> list:
    partes = re.split(r"\n+|(?<=[.!;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ•\-])", str(texto or ""))
    return [p.strip(" •-\t") for p in partes if p and p.strip(" •-\t")]


def _pilulas(frase: str) -> Optional[list]:
    """Listas ("Cortes: patinho, alcatra, músculo") viram pílulas."""
    m = re.match(r"^([^:]{3,60}):\s*(.+)$", frase)
    if not m:
        return None
    itens = [i.strip(" .") for i in re.split(r",|;|\s+e\s+", m.group(2)) if i.strip(" .")]
    return [m.group(1).strip(), itens] if len(itens) >= 3 else None


# ── HTML ───────────────────────────────────────────────────────────────────
CSS = f"""
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800;900&family=DM+Sans:wght@400;500;700&display=swap');
@page {{ size: A4; margin: 12mm 12mm 20mm 12mm;
  @top-left {{ content: string(cab); font-family: 'Montserrat', Arial, sans-serif; font-size: 7.5pt; font-weight: 800;
    letter-spacing: 1.5pt; color: #000; border-bottom: 1.5pt solid {AZUL}; vertical-align: bottom; padding-bottom: 2mm; }}
  @bottom-left {{ content: "{INSTAGRAM}"; background: #000; color: #fff; font-family: 'DM Sans', Arial, sans-serif; font-size: 8.5pt;
    padding-left: 6mm; margin-bottom: 6mm; }}
  @bottom-center {{ content: ""; background: #000; margin-bottom: 6mm; }}
  @bottom-right {{ content: "Página " counter(page) " de " counter(pages); background: #000; color: #fff; font-family: 'DM Sans', Arial, sans-serif;
    font-size: 8.5pt; padding-right: 6mm; margin-bottom: 6mm; }} }}
@page :first {{ @top-left {{ content: none; border: none; }} }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'DM Sans', Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; margin: 0; }}
h1, h2, h3, .tit {{ font-family: 'Montserrat', Arial, sans-serif; }}
.cab-str {{ string-set: cab content(); height: 0; overflow: hidden; color: transparent; font-size: 1pt; }}
.topo {{ background: #000 url('{SIMBOLO}') no-repeat right 6mm center; background-size: auto 62%; color: #fff; border-radius: 4mm;
  padding: 6mm 36mm 6mm 7mm; position: relative; }}
.topo table {{ width: 100%; border-collapse: collapse; }}
.topo .logo {{ height: 11mm; }}
.topo .pa {{ text-align: right; font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 15pt; letter-spacing: 1pt; }}
.topo .data {{ color: {AZUL}; font-weight: 700; font-size: 9pt; letter-spacing: 1pt; margin-top: 1mm; }}
.para {{ margin: 6mm 1mm 4mm; }}
.para .rot {{ font-size: 8pt; color: #666; letter-spacing: 1.5pt; text-transform: uppercase; }}
.para .nome {{ font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 18pt; text-transform: uppercase; line-height: 1.1; }}
.para .obj {{ color: {AZUL}; font-weight: 700; margin-top: 1mm; }}
.resumo {{ background: #000; color: #fff; border-radius: 4mm; padding: 5mm 6mm; }}
.resumo table {{ width: 100%; border-collapse: collapse; }}
.resumo .kcal {{ font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 26pt; line-height: 1; }}
.resumo .kcal small {{ font-size: 9pt; font-weight: 600; color: #aaa; }}
.resumo .m {{ text-align: center; }} .resumo .m b {{ display: block; font-size: 13pt; }} .resumo .m span {{ font-size: 7.5pt; color: #aaa; letter-spacing: 1pt; text-transform: uppercase; }}
.barra {{ height: 2.2mm; border-radius: 2mm; overflow: hidden; margin-top: 4mm; background: #222; }}
.barra div {{ height: 100%; float: left; }}
.cards {{ width: 100%; border-collapse: separate; border-spacing: 3mm 0; margin: 4mm -3mm 2mm; }}
.card {{ border: 0.8pt solid #ddd; border-radius: 3mm; padding: 3.5mm 4mm; vertical-align: top; }}
.card .t {{ font-family: 'Montserrat', Arial, sans-serif; font-weight: 800; font-size: 8pt; letter-spacing: 1.2pt; color: {AZUL}; text-transform: uppercase; }}
.card p {{ margin: 1.5mm 0 0; font-size: 9.5pt; }}
.ref {{ border: 0.8pt solid #ddd; border-radius: 3.5mm; margin-top: 4mm; page-break-inside: avoid; }}
.ref .h {{ padding: 3mm 4mm; border-bottom: 0.8pt solid #eee; }}
.ref .h table {{ width: 100%; border-collapse: collapse; }}
.selo {{ display: inline-block; background: {AZUL}; color: #fff; font-weight: 700; font-size: 9pt; border-radius: 2mm; padding: 0.8mm 2.5mm; margin-right: 2.5mm; }}
.ref .nome {{ font-family: 'Montserrat', Arial, sans-serif; font-weight: 800; font-size: 11pt; text-transform: uppercase; }}
.ref .mac {{ text-align: right; font-size: 8pt; color: #555; white-space: nowrap; }} .ref .mac b {{ color: #000; font-size: 9.5pt; }}
.al {{ width: 100%; border-collapse: collapse; }}
.al td {{ padding: 2mm 4mm; border-bottom: 0.5pt solid #f0f0f0; vertical-align: top; }}
.al .q {{ text-align: right; white-space: nowrap; font-weight: 700; width: 38%; }}
.ou {{ margin-top: 1.2mm; }}
.pil {{ display: inline-block; border: 0.8pt solid {AZUL}; border-radius: 10mm; padding: 0.6mm 2.4mm; margin: 0.8mm 1.2mm 0 0; font-size: 8.5pt; color: #333; }}
.pil b {{ color: {AZUL}; font-size: 7.5pt; margin-right: 1mm; }} .pil strong {{ color: #000; }}
.obsal {{ font-size: 8.5pt; color: #666; font-style: italic; margin-top: 0.8mm; }}
.opc {{ padding: 2mm 4mm 0; font-size: 8pt; font-weight: 800; color: {AZUL}; letter-spacing: 1pt; }}
.robs {{ background: #f2f2f2; padding: 2.5mm 4mm; font-size: 9pt; color: #333; border-radius: 0 0 3.5mm 3.5mm; }}
.total {{ background: #000; color: #fff; border-radius: 3.5mm; padding: 4mm 5mm; margin-top: 5mm; page-break-inside: avoid; }}
.total table {{ width: 100%; border-collapse: collapse; }}
.total .tit {{ font-weight: 900; font-size: 11pt; letter-spacing: 1pt; }}
.orient {{ page-break-before: always; }}
.orient h2 {{ font-weight: 900; font-size: 16pt; text-transform: uppercase; margin: 0 0 4mm; }}
.oc {{ border: 0.8pt solid #ddd; border-radius: 3.5mm; padding: 3.5mm 4mm; margin-bottom: 3.5mm; page-break-inside: avoid; }}
.oc .ic {{ display: inline-block; width: 7mm; height: 7mm; line-height: 7mm; text-align: center; border-radius: 50%; background: {AZUL}; color: #fff;
  font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 9pt; margin-right: 2.5mm; }}
.oc .tt {{ font-family: 'Montserrat', Arial, sans-serif; font-weight: 800; font-size: 10.5pt; text-transform: uppercase; }}
.oc ul {{ list-style: none; margin: 2.5mm 0 0; padding: 0; }}
.oc li {{ margin: 1.6mm 0; font-size: 9.5pt; }}
.tag {{ display: inline-block; font-size: 7pt; font-weight: 800; letter-spacing: 0.8pt; border-radius: 1.5mm; padding: 0.4mm 1.8mm; margin-right: 2mm; color: #fff; }}
.tag.pode {{ background: {AZUL}; }} .tag.evite {{ background: #000; }} .tag.ate {{ background: #fff; color: #000; border: 0.8pt solid #000; }}
"""


def _macros(t: dict, compacto=False) -> str:
    k = _num(t.get("energia_kcal"), 0)
    if compacto:
        return f'<b>{k} kcal</b><br/>P {_num(t.get("proteinas_g"))} g · C {_num(t.get("carboidratos_g"))} g · G {_num(t.get("lipidios_g"))} g'
    return k


def _alimentos(itens: list, com_ou: bool) -> str:
    linhas = ""
    for it in itens or []:
        nome = nome_limpo(it.get("nome") or it.get("alimento_nome") or "")
        if not nome:
            continue
        extra = ""
        subs = [s for s in (it.get("substitutos") or []) if (s.get("nome") or s.get("alimento_nome"))]
        if com_ou and subs:
            extra += '<div class="ou">' + "".join(
                f'<span class="pil"><b>OU</b><strong>{_esc(nome_limpo(s.get("nome") or s.get("alimento_nome")))}</strong> · {_esc(quantidade(s))}</span>'
                for s in subs) + "</div>"
        if (it.get("observacao") or "").strip():
            extra += f'<div class="obsal">{_esc(it["observacao"])}</div>'
        linhas += f'<tr><td>{_esc(nome)}{extra}</td><td class="q">{_esc(quantidade(it))}</td></tr>'
    return f'<table class="al">{linhas}</table>' if linhas else ""


def html_plano(paciente: dict, plano: dict, opcoes: Optional[dict] = None, hoje: Optional[datetime] = None) -> str:
    o = {"ou": True, "macros": True, "orientacoes": True, "total": True, **(opcoes or {})}
    hoje = hoje or datetime.now()
    t = plano.get("totais_dia") or {}
    kcal = float(t.get("energia_kcal") or 0)
    p, c, g, fib = (float(t.get(k) or 0) for k in ("proteinas_g", "carboidratos_g", "lipidios_g", "fibras_g"))
    pct = lambda grama, f: round(grama * f / kcal * 100) if kcal else 0
    nome_pac = paciente.get("nome") or ""
    corpo = f'<div class="cab-str">PLANO ALIMENTAR · {_esc(nome_pac.upper())}</div>'
    corpo += (f'<div class="topo"><table><tr><td>{f"<img class=logo src={LOGO_BRANCO} />" if LOGO_BRANCO else "<b>ROGÉRIO COSTA</b>"}</td>'
              f'<td class="pa">PLANO ALIMENTAR<div class="data">{hoje.strftime("%d/%m/%Y")}</div></td></tr></table></div>')
    corpo += (f'<div class="para"><div class="rot">Dieta para</div><div class="nome">{_esc(nome_pac)}</div>'
              + (f'<div class="obj">{_esc(plano.get("objetivo"))}{" · " + _esc(plano.get("titulo")) if plano.get("titulo") else ""}</div>' if plano.get("objetivo") or plano.get("titulo") else "")
              + "</div>")
    corpo += (f'<div class="resumo"><table><tr><td><div class="kcal">{_num(kcal, 0)} <small>kcal/dia</small></div></td>'
              f'<td class="m"><b>{_num(p, 0)} g</b><span>Proteínas · {pct(p, 4)}%</span></td>'
              f'<td class="m"><b>{_num(c, 0)} g</b><span>Carboidratos · {pct(c, 4)}%</span></td>'
              f'<td class="m"><b>{_num(g, 0)} g</b><span>Gorduras · {pct(g, 9)}%</span></td>'
              f'<td class="m"><b>{_num(fib, 0)} g</b><span>Fibras</span></td></tr></table>'
              f'<div class="barra"><div style="width:{pct(p, 4)}%;background:#4DA6FF"></div><div style="width:{pct(c, 4)}%;background:#C3F53C"></div>'
              f'<div style="width:{max(0, 100 - pct(p, 4) - pct(c, 4))}%;background:#FFB547"></div></div></div>')

    # cartões curtos: hidratação + orientações principais
    pd = plano.get("prescricao_dietetica") or {}
    agua = ""
    if pd.get("agua_min_ml") or pd.get("agua_max_ml"):
        lmin = _num((float(pd.get("agua_min_ml") or 0)) / 1000)
        lmax = _num((float(pd.get("agua_max_ml") or 0)) / 1000)
        agua = f"Beba de {lmin} a {lmax} litros de água por dia, distribuídos ao longo do dia." if pd.get("agua_max_ml") else f"Beba pelo menos {lmin} litros de água por dia."
    blocos_or = [(r.get("titulo") or "", r.get("texto") or "") for r in (plano.get("recomendacoes") or []) if (r.get("titulo") or r.get("texto") or "").strip()]
    blocos_or += [(x.get("titulo") or "", x.get("conteudo") or "") for x in (plano.get("orientacoes") or [])]
    if (plano.get("observacoes") or "").strip():
        blocos_or.append(("Orientações", plano["observacoes"]))
    curtas = [f for _, tx in blocos_or for f in _frases(tx)][:2]
    tem_pagina = o["orientacoes"] and blocos_or
    cards = []
    if agua:
        cards.append(f'<td class="card"><div class="t">Hidratação</div><p>{_esc(agua)}</p></td>')
    if curtas:
        cards.append('<td class="card"><div class="t">Orientações</div>' + "".join(f"<p>{_esc(f)}</p>" for f in curtas)
                     + ('<p style="color:#0081FD;font-weight:700">Leia todas na página de orientações, no fim do plano.</p>' if tem_pagina else "") + "</td>")
    if cards:
        corpo += f'<table class="cards"><tr>{"".join(cards)}</tr></table>'

    # refeições
    for ref in plano.get("refeicoes") or []:
        tabela = _alimentos(ref.get("alimentos") or [], o["ou"])
        if not tabela and not (ref.get("nome") or "").strip():
            continue
        horario = (ref.get("horario") or "").strip()
        mac = f'<td class="mac">{_macros(ref.get("totais") or {}, True)}</td>' if o["macros"] else ""
        corpo += (f'<div class="ref"><div class="h"><table><tr><td>{f"<span class=selo>{_esc(horario)}</span>" if horario else ""}'
                  f'<span class="nome">{_esc(ref.get("nome") or "Refeição")}</span></td>{mac}</tr></table></div>{tabela}')
        if o["ou"]:
            for i, op in enumerate(ref.get("opcoes") or [], 2):
                tab_op = _alimentos(op.get("alimentos") or [], True)
                if tab_op:
                    corpo += f'<div class="opc">OU · OPÇÃO {i}</div>{tab_op}'
        if (ref.get("observacao") or "").strip():
            corpo += f'<div class="robs">{_esc(ref["observacao"])}</div>'
        corpo += "</div>"

    if o["total"]:
        corpo += (f'<div class="total"><table><tr><td class="tit">TOTAL DO DIA</td>'
                  f'<td style="text-align:right"><b style="font-size:13pt">{_num(kcal, 0)} kcal</b> &nbsp; P {_num(p, 0)} g · C {_num(c, 0)} g · G {_num(g, 0)} g · Fibras {_num(fib, 0)} g</td></tr></table></div>')

    listas = [ls for ls in (plano.get("listas_substituicao") or []) if ls.get("alimentos")]
    for ls in listas:
        corpo += f'<div class="ref"><div class="h"><span class="nome">Lista de substituição · {_esc(ls.get("nome") or "")}</span></div>{_alimentos(ls["alimentos"], False)}</div>'

    # página de orientações por tema, com etiquetas
    if tem_pagina:
        por_tema = {}
        for titulo, texto in blocos_or:
            for f in _frases(texto):
                nome_t, letra = tema(titulo, f)
                por_tema.setdefault((nome_t, letra), []).append(f)
        corpo += '<div class="orient"><h2>Orientações do plano</h2>'
        for (nome_t, letra), frases in por_tema.items():
            itens = ""
            for f in frases:
                pil = _pilulas(f)
                tag = etiqueta(f)
                classe = {"PODE": "pode", "EVITE": "evite", "ATÉ 100 G": "ate"}.get(tag or "")
                tag_html = f'<span class="tag {classe}">{tag}</span>' if tag else ""
                if pil:
                    itens += f'<li>{tag_html}<b>{_esc(pil[0])}:</b> ' + "".join(f'<span class="pil">{_esc(x)}</span>' for x in pil[1]) + "</li>"
                else:
                    itens += f"<li>{tag_html}{_esc(f)}</li>"
            corpo += f'<div class="oc"><span class="ic">{_esc(letra)}</span><span class="tt">{_esc(nome_t)}</span><ul>{itens}</ul></div>'
        corpo += "</div>"
    return f'<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>{CSS}</style></head><body>{corpo}</body></html>'
