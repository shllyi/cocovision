"""
backend/services/analytics_export.py

Turns the dict returned by routers.analytics.get_admin_stats into downloadable files.
Formats: pdf, xlsx, docx, csv.   pip install openpyxl reportlab python-docx

Every builder returns (bytes, mime_type, extension).
All builders read the same list of sections from build_sections(), so a new
metric only needs to be added there.
"""
import csv
import io
from datetime import datetime, timedelta

MANILA = timedelta(hours=8)

SUMMARY_LABELS = [
    ("total_users", "Total users"),
    ("total_posts", "Total posts"),
    ("total_scans", "Total scans"),
    ("total_coconuts", "Coconuts detected"),
    ("total_likes", "Total likes"),
    ("total_comments", "Total comments"),
    ("user_growth", "User growth this week (%)"),
    ("post_growth", "Post growth this week (%)"),
    ("scan_growth", "Scan growth this week (%)"),
    ("new_signups_7d", "New signups (7 days)"),
    ("dau", "Active users (last 24 h)"),
    ("retention_rate", "7-day retention (%)"),
    ("engagement_rate", "Engagement rate (%)"),
    ("flagged_posts", "Flagged posts"),
    ("scan_success_rate", "Scan success rate (%)"),
    ("no_detection_rate", "No-detection rate (%)"),
    ("avg_confidence", "Average confidence (%)"),
    ("avg_inference_time", "Average inference time (s)"),
]


def _generated_label() -> str:
    return (datetime.utcnow() + MANILA).strftime("%Y-%m-%d %H:%M") + " (Manila time)"


def build_sections(data: dict) -> list:
    """Return [{'title', 'headers', 'rows'}]. Rows are lists of plain values."""
    sm = data.get("summary", {}) or {}
    ch = data.get("charts", {}) or {}
    lb = data.get("leaderboards", {}) or {}
    mc = data.get("model_comparison", {}) or {}
    sections = []

    sections.append({
        "title": "Summary",
        "headers": ["Metric", "Value"],
        "rows": [[label, sm.get(key, 0)] for key, label in SUMMARY_LABELS],
    })

    sections.append({
        "title": "Model comparison",
        "headers": ["Model", "Avg confidence (%)", "Success rate (%)", "Avg time (s)", "Detections"],
        "rows": [
            [name, m.get("avg_confidence", 0), m.get("success_rate", 0),
             m.get("avg_inference_time", 0), m.get("total_scans", 0)]
            for name, m in (("Original", mc.get("original", {}) or {}), ("Custom", mc.get("custom", {}) or {}))
        ],
    })

    for key, title in (("original_model_distribution", "Stage distribution - original model"),
                       ("custom_model_distribution", "Stage distribution - custom model")):
        sections.append({
            "title": title,
            "headers": ["Stage", "Count", "Avg confidence (%)"],
            "rows": [[r.get("stage"), r.get("count", 0), r.get("confidence", 0)] for r in ch.get(key, [])],
        })

    # daily series merged by date
    days = {}
    for series, label in (("scans_per_day", "Scans"), ("users_per_day", "New users"), ("posts_per_day", "Posts")):
        for r in ch.get(series, []):
            days.setdefault(r["date"], {})[label] = r["count"]
    sections.append({
        "title": "Daily activity (last 30 days)",
        "headers": ["Date", "Scans", "New users", "Posts"],
        "rows": [[d, v.get("Scans", 0), v.get("New users", 0), v.get("Posts", 0)] for d, v in sorted(days.items())],
    })

    # backend hours are UTC, shift to Manila
    by_hour = {r["hour"]: r["count"] for r in ch.get("scans_by_hour", [])}
    sections.append({
        "title": "Scans by hour (Manila time)",
        "headers": ["Hour", "Scans"],
        "rows": [[f"{h:02d}:00", by_hour.get((h - 8) % 24, 0)] for h in range(24)],
    })

    sections.append({
        "title": "Top posters",
        "headers": ["Rank", "Name", "Posts"],
        "rows": [[i + 1, p.get("name") or "Unknown", p.get("post_count", 0)] for i, p in enumerate(lb.get("top_posters", []))],
    })
    sections.append({
        "title": "Top scanners",
        "headers": ["Rank", "Name", "Scans", "Coconuts detected"],
        "rows": [[i + 1, p.get("name") or "Unknown", p.get("scan_count", 0), p.get("total_detected", 0)]
                 for i, p in enumerate(lb.get("top_scanners", []))],
    })
    sections.append({
        "title": "Recent activity",
        "headers": ["Type", "Title", "User", "Time"],
        "rows": [[a.get("type"), a.get("title"), a.get("author"), a.get("timestamp") or ""]
                 for a in data.get("recent_activity", [])],
    })
    return sections


# ───────────────────────────── CSV ─────────────────────────────
def build_csv(data: dict):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["CocoVision analytics", _generated_label()])
    for sec in build_sections(data):
        w.writerow([])
        w.writerow([sec["title"]])
        w.writerow(sec["headers"])
        w.writerows(sec["rows"])
    # utf-8 with BOM so Excel opens it correctly
    return out.getvalue().encode("utf-8-sig"), "text/csv", "csv"


# ───────────────────────────── XLSX ─────────────────────────────
def build_xlsx(data: dict):
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="166534")
    head_font = Font(bold=True, color="FFFFFF")

    for sec in build_sections(data):
        ws = wb.create_sheet(title=sec["title"][:31].replace("/", "-"))
        ws.append([sec["title"]])
        ws["A1"].font = Font(bold=True, size=14, color="166534")
        ws.append(["Generated: " + _generated_label()])
        ws.append([])
        ws.append(sec["headers"])
        hr = 4
        for c in ws[hr]:
            c.fill = head_fill
            c.font = head_font
            c.alignment = Alignment(horizontal="center")
        for row in sec["rows"]:
            ws.append(row)
        for i, h in enumerate(sec["headers"], start=1):
            width = max([len(str(h))] + [len(str(r[i - 1])) for r in sec["rows"] if i - 1 < len(r)])
            ws.column_dimensions[get_column_letter(i)].width = min(max(width + 3, 12), 60)
        ws.freeze_panes = ws.cell(row=hr + 1, column=1)

        n = len(sec["rows"])
        if n >= 2 and sec["title"].startswith(("Daily activity", "Scans by hour")):
            chart = BarChart()
            chart.title = sec["title"]
            chart.height, chart.width = 8, 18
            ncols = len(sec["headers"])
            chart.add_data(Reference(ws, min_col=2, max_col=ncols, min_row=hr, max_row=hr + n), titles_from_data=True)
            chart.set_categories(Reference(ws, min_col=1, min_row=hr + 1, max_row=hr + n))
            ws.add_chart(chart, f"{get_column_letter(ncols + 2)}4")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"


# ───────────────────────────── DOCX ─────────────────────────────
def build_docx(data: dict):
    from docx import Document
    from docx.shared import Pt, RGBColor

    doc = Document()
    title = doc.add_heading("CocoVision Analytics Report", level=0)
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x16, 0x65, 0x34)
    p = doc.add_paragraph("Generated: " + _generated_label())
    p.runs[0].font.size = Pt(9)

    for sec in build_sections(data):
        doc.add_heading(sec["title"], level=1)
        if not sec["rows"]:
            doc.add_paragraph("No data yet.")
            continue
        table = doc.add_table(rows=1, cols=len(sec["headers"]))
        table.style = "Light Grid Accent 1"
        for i, h in enumerate(sec["headers"]):
            cell = table.rows[0].cells[i]
            cell.text = str(h)
            for r in cell.paragraphs[0].runs:
                r.font.bold = True
        for row in sec["rows"]:
            cells = table.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = "" if v is None else str(v)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"


# ───────────────────────────── PDF ─────────────────────────────
def build_pdf(data: dict):
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    green = colors.HexColor("#166534")
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm, title="CocoVision Analytics Report")
    story = [
        Paragraph("CocoVision Analytics Report", styles["Title"]),
        Paragraph("Generated: " + _generated_label(), styles["Normal"]),
        Spacer(1, 6 * mm),
    ]

    def cell(v):
        return Paragraph("" if v is None else str(v).replace("&", "&amp;").replace("<", "&lt;"), styles["BodyText"])

    for sec in build_sections(data):
        story.append(Paragraph(sec["title"], styles["Heading2"]))
        if not sec["rows"]:
            story.append(Paragraph("No data yet.", styles["Normal"]))
            story.append(Spacer(1, 4 * mm))
            continue

        # simple bar chart for daily scans
        if sec["title"].startswith("Daily activity") and len(sec["rows"]) >= 2:
            rows = sec["rows"][-14:]
            d = Drawing(170 * mm, 50 * mm)
            bc = VerticalBarChart()
            bc.x, bc.y, bc.width, bc.height = 10, 12, 155 * mm, 40 * mm
            bc.data = [[r[1] for r in rows]]
            bc.categoryAxis.categoryNames = [str(r[0])[5:] for r in rows]
            bc.categoryAxis.labels.fontSize = 6
            bc.categoryAxis.labels.angle = 45
            bc.categoryAxis.labels.dy = -8
            bc.valueAxis.valueMin = 0
            bc.bars[0].fillColor = green
            d.add(bc)
            story.append(Paragraph("Scans per day (last 14 days with data)", styles["Normal"]))
            story.append(d)
            story.append(Spacer(1, 2 * mm))

        table_data = [[cell(h) for h in sec["headers"]]] + [[cell(v) for v in r] for r in sec["rows"]]
        t = Table(table_data, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), green),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0fdf4")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        # header cells are Paragraphs, so force white text
        for c in table_data[0]:
            c.style = styles["BodyText"].clone("hdr", textColor=colors.white, fontName="Helvetica-Bold")
        story.append(t)
        story.append(Spacer(1, 5 * mm))

    doc.build(story)
    return buf.getvalue(), "application/pdf", "pdf"


BUILDERS = {"pdf": build_pdf, "xlsx": build_xlsx, "docx": build_docx, "csv": build_csv}