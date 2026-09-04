#!/usr/bin/env python3
"""从报价数据生成 PDF。数据从 stdin 传入，PDF 输出到 stdout。"""
import io
import json
import os
import sys
from datetime import datetime

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def esc(value):
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def to_number(value):
    try:
        return float(str(value).replace(",", "").strip() or 0)
    except (TypeError, ValueError):
        return 0.0


def money(value):
    return format(to_number(value), ",.2f")


def total_of(data):
    total = 0.0
    for item in data.get("items", []) or []:
        amount = item.get("amount", "")
        if amount == "" or amount is None:
            amount = to_number(item.get("qty")) * to_number(item.get("price"))
        total += to_number(amount)
    return total


def cn_money(value):
    n = round(to_number(value) * 100) / 100
    if not n:
        return ""
    negative = n < 0
    n = abs(n)
    integer = int(n)
    cents = int(round((n - integer) * 100))
    digits = "零壹贰叁肆伍陆柒捌玖"
    small_units = ["", "拾", "佰", "仟"]
    big_units = ["", "万", "亿", "兆"]

    def four(num):
        out = ""
        need_zero = False
        for i in range(3, -1, -1):
            unit = 10 ** i
            digit = (num // unit) % 10
            if digit == 0:
                if out:
                    need_zero = True
            else:
                if need_zero:
                    out += "零"
                out += digits[digit] + small_units[i]
                need_zero = False
        return out

    groups = []
    tmp = integer
    if tmp == 0:
        groups = [0]
    while tmp > 0:
        groups.append(tmp % 10000)
        tmp //= 10000
    result = ""
    zero_gap = False
    for i in range(len(groups) - 1, -1, -1):
        group = groups[i]
        if group:
            if zero_gap and result:
                result += "零"
            result += four(group) + big_units[i]
            zero_gap = False
        elif result:
            zero_gap = True
    result += "元"
    if cents == 0:
        result += "整"
    else:
        if cents >= 10:
            result += digits[cents // 10] + "角"
        if cents % 10:
            if cents >= 10:
                result += digits[cents % 10] + "分"
            else:
                result += "零" + digits[cents % 10] + "分"
    return ("负" if negative else "") + result


def try_font_paths():
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
    ]
    for item in candidates:
        if os.path.exists(item):
            return item
    return None


def resolve_asset_path(root, asset_url):
    if not asset_url:
        return ""
    clean = asset_url.split("?")[0].lstrip("/")
    candidate = os.path.join(root, clean)
    if os.path.isfile(candidate):
        return candidate
    return ""


def image_flow(path, max_width, max_height):
    if not path or not os.path.exists(path):
        return None
    try:
        with PILImage.open(path) as im:
            width, height = im.size
    except Exception:
        return None
    ratio = min(max_width / width, max_height / height, 1.0)
    return Image(path, width=width * ratio, height=height * ratio)


def group_label(group_key):
    labels = {
        "companyGate": "厂门 / 厂区",
        "products": "产品实拍",
        "workshop": "车间与制造能力",
        "certs": "资质证书与检测报告",
    }
    return labels.get(group_key, "公司资料")


def build_pdf(data, assets, root):
    font_path = try_font_paths()
    if not font_path:
        raise RuntimeError("未找到可用于 PDF 的中文字体")
    font_name = "ZhaoArialUnicode"
    pdfmetrics.registerFont(TTFont(font_name, font_path))
    pdfmetrics.registerFontFamily(font_name, normal=font_name, bold=font_name, italic=font_name, boldItalic=font_name)

    theme = data.get("theme") or "blue"
    palettes = {
        "blue": {"accent": "#0b5e8c", "dark": "#073e5c", "soft": "#e5f1f7", "gold": "#a9762b"},
        "teal": {"accent": "#0e7468", "dark": "#084f47", "soft": "#e3f3f0", "gold": "#a58a28"},
        "graphite": {"accent": "#3f5a70", "dark": "#263b4c", "soft": "#e8eef2", "gold": "#8a6b3b"},
    }
    palette = palettes.get(theme, palettes["blue"])
    accent = colors.HexColor(palette["accent"])
    dark = colors.HexColor(palette["dark"])
    soft = colors.HexColor(palette["soft"])
    gold = colors.HexColor(palette["gold"])
    grid_line = colors.HexColor("#d6e0e8")

    left_margin = 16 * mm
    content_width = A4[0] - left_margin * 2

    st_brand = ParagraphStyle("brand", fontName=font_name, fontSize=22, leading=27, textColor=dark)
    st_slogan = ParagraphStyle("slogan", fontName=font_name, fontSize=9, leading=13, textColor=accent)
    st_contact = ParagraphStyle("contact", fontName=font_name, fontSize=8, leading=13, textColor=colors.HexColor("#4b5a6d"), alignment=TA_RIGHT)
    st_h1 = ParagraphStyle("h1", fontName=font_name, fontSize=26, leading=33, alignment=TA_CENTER, textColor=dark, spaceBefore=8, spaceAfter=2)
    st_kicker = ParagraphStyle("kicker", fontName=font_name, fontSize=8, leading=11, alignment=TA_CENTER, textColor=gold)
    st_subject = ParagraphStyle("subject", fontName=font_name, fontSize=11, leading=16, alignment=TA_CENTER, textColor=accent)
    st_meta = ParagraphStyle("meta", fontName=font_name, fontSize=8.5, leading=13, alignment=TA_CENTER, textColor=colors.HexColor("#5f6e81"))
    st_section = ParagraphStyle("section", fontName=font_name, fontSize=13, leading=18, textColor=dark, spaceBefore=12, spaceAfter=4)
    st_body = ParagraphStyle("body", fontName=font_name, fontSize=9.5, leading=15, textColor=colors.HexColor("#243143"))
    st_small = ParagraphStyle("small", fontName=font_name, fontSize=8.5, leading=12.5, textColor=colors.HexColor("#43536a"))
    st_center = ParagraphStyle("center", parent=st_small, alignment=TA_CENTER)
    st_right = ParagraphStyle("right", parent=st_small, alignment=TA_RIGHT)
    st_cell = ParagraphStyle("cell", fontName=font_name, fontSize=8.2, leading=11.5, textColor=colors.HexColor("#243143"))
    st_cell_center = ParagraphStyle("cellcenter", parent=st_cell, alignment=TA_CENTER)
    st_cell_right = ParagraphStyle("cellright", parent=st_cell, alignment=TA_RIGHT)
    st_total = ParagraphStyle("total", fontName=font_name, fontSize=10.5, leading=15, textColor=colors.HexColor("#7a5a22"), alignment=TA_RIGHT)
    st_sign = ParagraphStyle("sign", fontName=font_name, fontSize=8, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#5d6d81"))
    st_photo_title = ParagraphStyle("phototitle", fontName=font_name, fontSize=15, leading=20, textColor=dark)
    st_cover_title = ParagraphStyle("covertitle", fontName=font_name, fontSize=27, leading=34, alignment=TA_CENTER, textColor=dark)
    st_cover_company = ParagraphStyle("covercompany", fontName=font_name, fontSize=14, leading=20, alignment=TA_CENTER, textColor=dark, spaceBefore=6)

    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        title=data.get("title") or "产品报价单",
        author=data.get("companyName") or "江苏兆辉防腐科技有限公司",
        leftMargin=left_margin,
        rightMargin=left_margin,
        topMargin=14 * mm,
        bottomMargin=15 * mm,
    )

    def page_background(canvas, doc_obj):
        canvas.saveState()
        canvas.setFillColor(accent)
        canvas.rect(0, A4[1] - 7, A4[0], 7, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#7b8794"))
        canvas.setFont(font_name, 8)
        canvas.drawCentredString(A4[0] / 2, 8 * mm, "江苏兆辉防腐科技有限公司")
        canvas.drawRightString(A4[0] - left_margin, 8 * mm, "第 %d 页" % doc_obj.page)
        canvas.restoreState()

    story = []
    selected_ids = set(data.get("selectedAssetIds") or [])
    company = data.get("companyName") or ""
    logo_asset = next((a for a in assets if a.get("group") == "logo" and a.get("id") in selected_ids), None)
    profile = data.get("profile") or {}
    cover_asset = next((a for a in assets if a.get("id") == profile.get("coverAssetId")), None)
    if profile.get("coverEnabled") and cover_asset:
        story.append(Paragraph("江苏兆辉防腐科技有限公司", st_kicker))
        story.append(Paragraph(
            esc((data.get("recipientUnit") or "贵公司") + "报价及技术说明"),
            st_cover_title,
        ))
        story.append(Spacer(1, 4 * mm))
        cover_img = image_flow(resolve_asset_path(root, cover_asset.get("url")), content_width, 185 * mm)
        if cover_img:
            cover_img.hAlign = "CENTER"
            story.append(cover_img)
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(esc(company or "江苏兆辉防腐科技有限公司"), st_cover_company))
        if data.get("date"):
            story.append(Paragraph("报价日期：" + esc(data["date"]), st_meta))
        story.append(PageBreak())
    left_cell = []
    if logo_asset:
        logo_path = resolve_asset_path(root, logo_asset.get("url"))
        logo_image = image_flow(logo_path, 18 * mm, 18 * mm)
        if logo_image:
            left_cell.append(logo_image)
    if not left_cell:
        left_cell.append(Paragraph(esc(company or "江苏兆辉防腐科技有限公司"), st_brand))
    if data.get("companySlogan"):
        left_cell.append(Paragraph(esc(data["companySlogan"]), st_slogan))
    contact_lines = []
    if data.get("companyPhone"):
        contact_lines.append("电话：" + esc(data["companyPhone"]))
    if data.get("companyEmail"):
        contact_lines.append("邮箱：" + esc(data["companyEmail"]))
    if data.get("companyAddress"):
        contact_lines.append("地址：" + esc(data["companyAddress"]))
    if data.get("companyWebsite"):
        contact_lines.append("网址：" + esc(data["companyWebsite"]))
    contact_html = "<br/>".join(contact_lines)
    header_data = [
        [left_cell, Paragraph(contact_html or "&nbsp;", st_contact)],
    ]
    header = Table(header_data, colWidths=[content_width * 0.62, content_width * 0.38])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("BACKGROUND", (0, 0), (-1, -1), soft),
        ("BOX", (0, 0), (-1, -1), 0.9, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(header)
    story.append(Spacer(1, 7 * mm))

    story.append(Paragraph("PRODUCT QUOTATION", st_kicker))
    story.append(Paragraph(esc(data.get("title") or "产品报价单"), st_h1))
    if data.get("subject"):
        story.append(Paragraph(esc(data["subject"]), st_subject))
    meta = "&nbsp;&nbsp;".join(filter(None, [
        data.get("quoteNo") and "报价单号：" + esc(data["quoteNo"]),
        data.get("date") and "报价日期：" + esc(data["date"]),
        data.get("validUntil") and "有效期至：" + esc(data["validUntil"]),
    ]))
    if meta:
        story.append(Paragraph(meta, st_meta))
    story.append(HRFlowable(width="68%", thickness=1, color=accent, spaceBefore=6, spaceAfter=9))

    party_left = []
    party_right = []
    if data.get("recipientUnit"):
        party_left.append("<b>收件单位：</b>" + esc(data["recipientUnit"]))
    if data.get("projectName"):
        party_left.append("<b>项目名称：</b>" + esc(data["projectName"]))
    if data.get("recipientAddress"):
        party_left.append("<b>单位地址：</b>" + esc(data["recipientAddress"]))
    if data.get("recipientContact"):
        party_right.append("<b>联系人：</b>" + esc(data["recipientContact"]))
    if data.get("recipientPhone"):
        party_right.append("<b>电话 / 微信：</b>" + esc(data["recipientPhone"]))
    if data.get("recipientEmail"):
        party_right.append("<b>电子邮箱：</b>" + esc(data["recipientEmail"]))
    if party_left or party_right:
        party = Table(
            [
                [
                    Paragraph("<br/>".join(party_left or ["&nbsp;"]), st_body),
                    Paragraph("<br/>".join(party_right or ["&nbsp;"]), st_body),
                ]
            ],
            colWidths=[content_width / 2, content_width / 2],
        )
        party.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, accent),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbfcfd")),
            ("LINEBEFORE", (1, 0), (1, 0), 0.5, grid_line),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(party)
        story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("产品报价明细", st_section))
    headers = ["序号", "名称 / 型号", "材质", "规格 / 尺寸", "数量", "单位", "单价（元）", "总价（元）", "备注"]
    col_widths = [10, 36, 16, 28, 12, 10, 21, 23, 22]
    table_rows = [[Paragraph(h, st_cell_center) for h in headers]]
    for index, item in enumerate(data.get("items", []) or []):
        qty = item.get("qty") or ""
        price = item.get("price") or ""
        amount = item.get("amount", "")
        if amount == "" or amount is None:
            amount = to_number(qty) * to_number(price)
        cells = [
            esc(item.get("no") or str(index + 1)),
            esc(item.get("name")),
            esc(item.get("material")),
            esc(item.get("spec")),
            str(to_number(qty)) if qty else "",
            esc(item.get("unit")),
            money(price) if price else "",
            money(amount) if amount else "",
            esc(item.get("note")),
        ]
        table_rows.append([
            Paragraph(cells[0], st_cell_center),
            Paragraph(cells[1], st_cell),
            Paragraph(cells[2], st_cell_center),
            Paragraph(cells[3], st_cell),
            Paragraph(cells[4], st_cell_center),
            Paragraph(cells[5], st_cell_center),
            Paragraph(cells[6], st_cell_right),
            Paragraph(cells[7], st_cell_right),
            Paragraph(cells[8], st_cell),
        ])
    items_table = Table(table_rows, colWidths=[w * mm for w in col_widths], repeatRows=1)
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, grid_line),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(palette.get("pale", "#f4f9fc"))]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(items_table)

    total = total_of(data)
    if total:
        total_box = Table(
            [[Paragraph(
                "报价合计（人民币）：<b>¥ %s</b>&nbsp;&nbsp;<font size=7>大写：%s</font>" % (money(total), esc(cn_money(total))),
                st_total,
            )]],
            colWidths=[content_width],
        )
        total_box.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("LINEABOVE", (0, 0), (-1, -1), 0.6, grid_line),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(total_box)

    notes = data.get("notes") or []
    terms = [
        ("付款方式", data.get("paymentTerms")),
        ("交货周期", data.get("deliveryDays")),
        ("质保期限", data.get("qualityPeriod")),
        ("报价有效期", "至 " + data.get("validUntil") if data.get("validUntil") else ""),
    ]
    if notes:
        story.append(Paragraph("报价说明与备注", st_section))
        for line in notes:
            story.append(Paragraph("◆ " + esc(line), st_body))
    term_items = [(k, v) for k, v in terms if v]
    if term_items:
        story.append(Paragraph("商务条款", st_section))
        term_grid = []
        for i in range(0, len(term_items), 2):
            row = []
            for j in range(2):
                if i + j < len(term_items):
                    key, value = term_items[i + j]
                    row.append(Paragraph("<b>%s：</b>%s" % (esc(key), esc(value)), st_body))
                else:
                    row.append(Paragraph("&nbsp;", st_body))
            term_grid.append(row)
        term_table = Table(term_grid, colWidths=[content_width / 2, content_width / 2])
        term_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, grid_line),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, grid_line),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbfcfd")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(term_table)

    certs = [c for c in (data.get("certs") or []) if c and (c.get("category") or c.get("name") or c.get("no"))]
    if data.get("showCerts", True) and certs:
        story.append(Paragraph("资质与认证", st_section))
        cert_rows = [[Paragraph(h, st_cell_center) for h in ["类别", "证书 / 认证名称", "证书编号 / 报告编号", "有效期 / 说明"]]]
        cert_widths = [36, 53, 53, 36]
        for cert in certs:
            cert_rows.append([
                Paragraph(esc(cert.get("category")), st_cell_center),
                Paragraph(esc(cert.get("name")), st_cell),
                Paragraph(esc(cert.get("no")), st_cell),
                Paragraph(esc(cert.get("validity")), st_cell),
            ])
        cert_table = Table(cert_rows, colWidths=[w * mm for w in cert_widths], repeatRows=1)
        cert_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), gold),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#ead9bc")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fdf6e9")]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(cert_table)

    story.append(Spacer(1, 6 * mm))
    sign_table = Table(
        [[Paragraph("报价单位（盖章）", st_sign), Paragraph("客户确认（盖章）", st_sign)]],
        colWidths=[content_width / 2, content_width / 2],
    )
    sign_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, -1), 0.6, colors.HexColor("#b9c3ce")),
        ("TOPPADDING", (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(sign_table)
    story.append(Spacer(1, 4 * mm))

    selected_ids = set(data.get("selectedAssetIds") or [])
    photo_assets = [
        a
        for group_key in ["products", "workshop", "certs"]
        for a in assets
        if a.get("id") in selected_ids
        and a.get("group") == group_key
        and a.get("group") != "logo"
        and a.get("group") != "companyGate"
    ]
    if data.get("showPhotos", True) and photo_assets:
        for photo_index, asset in enumerate(photo_assets):
            story.append(PageBreak())
            story.append(Paragraph("产品实拍与制造能力", st_photo_title))
            story.append(Paragraph(group_label(asset.get("group")), st_section))
            story.append(Spacer(1, 3 * mm))
            img_path = resolve_asset_path(root, asset.get("url"))
            img = image_flow(img_path, content_width, 205 * mm)
            if img:
                img.hAlign = "CENTER"
                story.append(img)
                caption = asset.get("caption") or asset.get("name") or ""
                story.append(Spacer(1, 4 * mm))
                story.append(Paragraph(
                    esc(caption) + ("　（%02d）" % (photo_index + 1)),
                    st_cell_center,
                ))

    def add_profile_page(title, subtitle):
        story.append(PageBreak())
        story.append(Paragraph("江苏兆辉防腐科技有限公司", st_kicker))
        story.append(Paragraph(esc(title), st_photo_title))
        story.append(Paragraph(esc(subtitle or ""), st_small))
        story.append(Spacer(1, 4 * mm))

    basic = profile.get("basic") or {}
    basic_rows = [
        ("公司名称", company),
        ("统一社会信用代码", data.get("companyUnifiedCode") or ""),
        ("成立时间", basic.get("established") or ""),
        ("注册资本", basic.get("registeredCapital") or ""),
        ("法定代表人", data.get("companyLegal") or basic.get("legal") or ""),
        ("员工人数", basic.get("employees") or ""),
        ("厂房面积", basic.get("plantArea") or ""),
        ("公司地址", data.get("companyAddress") or ""),
        ("联系电话", data.get("companyPhone") or ""),
        ("经营范围 / 主营业务", basic.get("businessScope") or ""),
    ]
    basic_rows = [(k, v) for k, v in basic_rows if v]

    if profile.get("overviewEnabled") and str(profile.get("overview") or "").strip():
        add_profile_page("企业概况", "公司简介与核心业务")
        story.append(Paragraph(
            "<br/>".join(esc(line) for line in str(profile.get("overview")).splitlines() if line.strip()),
            st_body,
        ))

    if profile.get("basicEnabled") and basic_rows:
        add_profile_page("公司基本情况表", "工商登记与生产经营概况")
        grid = []
        for i in range(0, len(basic_rows), 2):
            row = []
            for j in range(2):
                if i + j < len(basic_rows):
                    key, value = basic_rows[i + j]
                    row.append(Paragraph("<b>%s：</b>%s" % (esc(key), esc(value)), st_body))
                else:
                    row.append(Paragraph("&nbsp;", st_body))
            grid.append(row)
        basic_table = Table(grid, colWidths=[content_width / 2, content_width / 2])
        basic_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, grid_line),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, grid_line),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbfcfd")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(basic_table)

    equipment = [row for row in (profile.get("equipment") or []) if row and (row.get("name") or row.get("spec") or row.get("purpose"))]
    if profile.get("equipmentEnabled") and equipment:
        add_profile_page("公司主要设备情况表", "生产制造与检测能力")
        headers = ["序号", "设备名称", "型号 / 规格", "数量", "主要用途 / 能力"]
        eq_rows = [[Paragraph(h, st_cell_center) for h in headers]]
        for idx, row in enumerate(equipment, start=1):
            eq_rows.append([
                Paragraph(esc(str(idx)), st_cell_center),
                Paragraph(esc(row.get("name")), st_cell),
                Paragraph(esc(row.get("spec")), st_cell),
                Paragraph(esc(row.get("qty")), st_cell_center),
                Paragraph(esc(row.get("purpose")), st_cell),
            ])
        eq_table = Table(eq_rows, colWidths=[15 * mm, 47 * mm, 34 * mm, 16 * mm, 66 * mm], repeatRows=1)
        eq_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), accent),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, grid_line),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(eq_table)

    profile_certs = [a for a in assets if a.get("group") == "certs" and a.get("id") in (profile.get("certAssetIds") or [])]
    if profile.get("certEnabled") and profile_certs:
        add_profile_page("公司资质与证书", "资质证书与检测认证资料")
        cert_cell_width = (content_width - 4 * mm) / 2
        for i in range(0, len(profile_certs), 2):
            pair = profile_certs[i : i + 2]
            row_cells = []
            for asset_item in pair:
                cert_path = resolve_asset_path(root, asset_item.get("url"))
                cert_img = image_flow(cert_path, cert_cell_width, 120 * mm)
                if cert_img:
                    cert_img.hAlign = "CENTER"
                    row_cells.append([cert_img, Paragraph(esc(asset_item.get("caption") or asset_item.get("name") or ""), st_cell_center)])
                else:
                    row_cells.append([Paragraph("图片缺失", st_cell_center)])
            if len(row_cells) == 1:
                row_cells.append([Paragraph("&nbsp;", st_cell_center)])
            cert_table = Table([row_cells], colWidths=[cert_cell_width, cert_cell_width])
            cert_table.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, grid_line),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, grid_line),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(cert_table)
            if i + 2 < len(profile_certs):
                story.append(PageBreak())

    projects = [row for row in (profile.get("projects") or []) if row and (row.get("client") or row.get("project") or row.get("products"))]
    if profile.get("projectsEnabled") and projects:
        add_profile_page("工程业绩展示", "近年防腐设备供货与工程业绩")
        proj_headers = ["年份", "客户单位", "项目名称", "供货产品", "备注"]
        proj_rows = [[Paragraph(h, st_cell_center) for h in proj_headers]]
        for idx, row in enumerate(projects, start=1):
            proj_rows.append([
                Paragraph(esc(row.get("year") or str(idx)), st_cell_center),
                Paragraph(esc(row.get("client")), st_cell),
                Paragraph(esc(row.get("project")), st_cell),
                Paragraph(esc(row.get("products")), st_cell),
                Paragraph(esc(row.get("note")), st_cell),
            ])
        proj_table = Table(proj_rows, colWidths=[18 * mm, 46 * mm, 46 * mm, 40 * mm, 28 * mm], repeatRows=1)
        proj_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), accent),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, grid_line),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(proj_table)

    doc.build(story, onFirstPage=page_background, onLaterPages=page_background)
    return output.getvalue()


def main():
    raw = sys.stdin.read()
    if not raw:
        raise SystemExit("missing input")
    payload = json.loads(raw)
    root = os.environ.get("ZHAOHUI_ROOT", os.getcwd())
    pdf = build_pdf(payload.get("data") or {}, payload.get("assets") or [], root)
    sys.stdout.buffer.write(pdf)


if __name__ == "__main__":
    main()
