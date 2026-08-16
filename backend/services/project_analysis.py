"""Project quality analysis — the "AI Tahlil" button.

Runs a battery of read-only checks against a project's KM pool, SSCC pool,
open boxes and closed boxes, then returns a structured report the UI shows
as an assistant-style panel. No mutations, no ASL calls.

Checks are graded:
    ok       — everything's fine, informational only
    warn     — non-blocking issue the operator should know about
    blocker  — will cause ASL rejection at submit time; fix first
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..models import Box, BoxPool, KmPool, OpenBox, Project
from .codes import KM_IDENTIFIER_LEN, canonical_km
from .sscc_generator import SSCCGenerator

STALE_OPEN_BOX_HOURS = 2


def _check(level: str, title: str, detail: str = "", **extra) -> dict:
    return {"level": level, "title": title, "detail": detail, **extra}


def analyze_project(sess: Session, project_id: int) -> dict:
    project = sess.get(Project, project_id)
    if project is None:
        raise LookupError("project not found")

    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(hours=STALE_OPEN_BOX_HOURS)

    # ── pool counts ─────────────────────────────────────
    km_total       = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id)).scalar_one())
    km_aggregated  = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id, KmPool.status == "aggregated")).scalar_one())
    km_claimed     = int(sess.execute(select(func.count(KmPool.id)).where(KmPool.project_id == project_id, KmPool.status == "claimed")).scalar_one())
    km_pending     = km_total - km_aggregated - km_claimed

    box_total = int(sess.execute(select(func.count(BoxPool.id)).where(BoxPool.project_id == project_id)).scalar_one())
    box_used  = int(sess.execute(select(func.count(BoxPool.id)).where(BoxPool.project_id == project_id, BoxPool.status == "used")).scalar_one())

    closed_full = int(sess.execute(select(func.count(Box.id)).where(Box.project_id == project_id, Box.is_loose == False)).scalar_one())  # noqa: E712
    closed_loose_n = int(sess.execute(select(func.count(Box.id)).where(Box.project_id == project_id, Box.is_loose == True)).scalar_one())   # noqa: E712

    full_planned = project.total_boxes - (1 if project.has_loose else 0)
    planned_km   = full_planned * project.per_box + (project.loose_qty if project.has_loose else 0)

    checks: list[dict] = []

    # ── KM structure ────────────────────────────────────
    # Sample-scan KM codes for non-canonical format. Use a bounded SELECT so
    # this stays fast even for 40k pools.
    non_canonical: list[str] = []
    for (km,) in sess.execute(select(KmPool.km_code).where(KmPool.project_id == project_id).limit(50_000)):
        if len(km) != KM_IDENTIFIER_LEN or not km.startswith("01"):
            non_canonical.append(km)
            if len(non_canonical) >= 10:
                break
    if non_canonical:
        checks.append(_check(
            "warn",
            f"{len(non_canonical)} ta KM standart shaklga mos emas",
            "Kutilgan: 31 belgi, '01' bilan boshlanadi. Namunalar: "
            + ", ".join(f"'{k}'" for k in non_canonical[:3]),
            sample=non_canonical[:10],
        ))
    else:
        checks.append(_check("ok",
            "Barcha KM lar to'g'ri shaklda (31 belgi, sSGTIN)",
        ))

    # ── KM duplicates in the current pool (would violate UNIQUE anyway,
    # but confirming for the report) ────────────────────
    dup_km_row = sess.execute(select(
        KmPool.km_code, func.count(KmPool.id)
    ).where(KmPool.project_id == project_id).group_by(KmPool.km_code).having(func.count(KmPool.id) > 1).limit(5)).all()
    if dup_km_row:
        checks.append(_check(
            "blocker",
            f"KM ro'yxatida {len(dup_km_row)}+ takroriy kod bor",
            "Bu ASL ni buzadi. Fond DB dagi UNIQUE cheklovi buni tuta oldi degani — bu holat kutilmagan.",
        ))

    # ── SSCC structural check ───────────────────────────
    bad_sscc: list[str] = []
    for (s,) in sess.execute(select(BoxPool.sscc).where(BoxPool.project_id == project_id).limit(50_000)):
        try:
            SSCCGenerator.extract_sscc(s)   # normalizes + basic shape
            ok, _err = SSCCGenerator.validate_sscc(s)
            if not ok:
                bad_sscc.append(s)
        except Exception:
            bad_sscc.append(s)
        if len(bad_sscc) >= 10:
            break
    if bad_sscc:
        checks.append(_check(
            "blocker",
            f"{len(bad_sscc)} ta SSCC noto'g'ri check-digit yoki shakl bilan",
            "ASL bu qutilarni qabul qilmaydi.",
            sample=bad_sscc[:10],
        ))
    else:
        checks.append(_check("ok", "Barcha SSCC GS1 check-digit tekshiruvidan o'tdi"))

    # ── stale open boxes ────────────────────────────────
    stale_rows = sess.execute(
        select(OpenBox.id, OpenBox.user_id, OpenBox.created_at, func.count(KmPool.id))
        .join(KmPool, KmPool.open_box_id == OpenBox.id, isouter=True)
        .where(OpenBox.project_id == project_id, OpenBox.created_at < stale_before)
        .group_by(OpenBox.id, OpenBox.user_id, OpenBox.created_at)
    ).all()
    if stale_rows:
        detail_lines = [f"user#{u} — {c} ta KM, {(now - dt).total_seconds() // 3600:.0f} soat oldin ochilgan"
                        for _, u, dt, c in stale_rows[:5]]
        checks.append(_check(
            "warn",
            f"{len(stale_rows)} ta ochiq quti {STALE_OPEN_BOX_HOURS} soatdan ortiq bo'sh turibdi",
            " · ".join(detail_lines),
        ))

    # ── coverage & plan alignment ───────────────────────
    if km_pending > 0 or km_claimed > 0:
        checks.append(_check(
            "warn",
            f"{km_pending + km_claimed} ta KM hali qutiga tushmagan",
            f"pending={km_pending}, ochiq qutida={km_claimed}. Yakunlashdan oldin nolga tushirilishi kerak.",
        ))
    if km_total < planned_km:
        checks.append(_check(
            "blocker",
            f"Pool KM soni rejadan kam: {km_total} < {planned_km}",
            "Yetishmayotgan KM larni yuklamasangiz, yakunlash blok qilingan.",
        ))

    if closed_full > full_planned:
        checks.append(_check(
            "warn",
            f"Rejadan ko'p to'liq quti yopilgan: {closed_full} > {full_planned}",
        ))
    elif closed_full < full_planned:
        checks.append(_check(
            "ok" if km_pending + km_claimed > 0 else "warn",
            f"To'liq qutilar {closed_full}/{full_planned}",
        ))
    else:
        checks.append(_check("ok", f"To'liq qutilar rejaga mos: {closed_full}/{full_planned}"))

    if project.has_loose:
        if closed_loose_n > 1:
            checks.append(_check("blocker", "Bir nechta loose quti yopilgan — reja bo'yicha faqat 1 tasi."))
        elif closed_loose_n == 0:
            checks.append(_check("warn", "Loose quti hali yopilmagan."))
        else:
            checks.append(_check("ok", "Loose quti yopilgan."))

    # ── SSCC usage vs need ─────────────────────────────
    boxes_needed = project.total_boxes
    if box_total < boxes_needed:
        checks.append(_check(
            "blocker",
            f"SSCC ro'yxati kam: {box_total} < {boxes_needed}",
            "Yakunlashdan oldin yetishmayotgan SSCC lar yuklanishi kerak.",
        ))
    unused_sscc = box_total - box_used
    if unused_sscc > 0 and closed_full >= full_planned and (not project.has_loose or closed_loose_n >= 1):
        checks.append(_check(
            "ok",
            f"{unused_sscc} ta SSCC ortiqcha (ishlatilmadi) — bu odatiy holat",
        ))

    # ── box capacity anomalies (short boxes among full ones) ──
    anomalies = sess.execute(
        select(Box.id, Box.sscc, Box.capacity, func.count(KmPool.id))
        .join(KmPool, KmPool.box_id == Box.id, isouter=True)
        .where(Box.project_id == project_id, Box.is_loose == False)     # noqa: E712
        .group_by(Box.id, Box.sscc, Box.capacity)
        .having(func.count(KmPool.id) != Box.capacity)
        .limit(10)
    ).all()
    if anomalies:
        detail = " · ".join(f"{s} ({c}/{cap})" for _, s, cap, c in anomalies[:3])
        checks.append(_check(
            "warn",
            f"{len(anomalies)} ta to'liq qutida rejalashtirilgan kapasitetdan farq bor",
            detail,
        ))

    # ── overall health ─────────────────────────────────
    if any(c["level"] == "blocker" for c in checks):
        health = "blockers"
    elif any(c["level"] == "warn" for c in checks):
        health = "warnings"
    else:
        health = "healthy"

    recommendations: list[str] = []
    if health == "blockers":
        recommendations.append("Blokerlarni birinchi navbatda hal qiling — ular bo'lmasa Yakunlash ishlamaydi.")
    if km_claimed:
        recommendations.append(f"{km_claimed} ta KM ochiq qutida — ularni yoping yoki 'Joriy qutini tozalash' bilan pool ga qaytaring.")
    if km_pending:
        recommendations.append(f"{km_pending} ta KM hali skanerlanmagan — operator davom etsin.")
    if health == "healthy":
        recommendations.append("Barcha tekshiruvlar o'tdi. Yakunlashga tayyor.")

    return {
        "health": health,
        "summary": {
            "km_total":       km_total,
            "km_aggregated":  km_aggregated,
            "km_claimed":     km_claimed,
            "km_pending":     km_pending,
            "sscc_total":     box_total,
            "sscc_used":      box_used,
            "closed_full":    closed_full,
            "closed_loose":   closed_loose_n,
            "full_planned":   full_planned,
            "planned_km":     planned_km,
        },
        "checks":          checks,
        "recommendations": recommendations,
        "generated_at":    now.isoformat(timespec="seconds"),
    }
