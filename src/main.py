# -*- coding: utf-8 -*-
"""売上実績 比較分析レポート生成スクリプト。

input_data/ 内のCSVファイル2つを読み込み、日商ベースで比較分析した
HTMLダッシュボードを output_data/ に生成する。

タイムスタンプが古い方を「比較基準」、新しい方を「比較対象」として自動割当てする。
分析コメント・カテゴリ分類・ヘッダー情報はすべてCSVデータから動的に生成する。
"""
import os
import json
import glob
import logging
import re

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CSV ヘッダー解析
# ---------------------------------------------------------------------------

def _read_csv_header_lines(file_path, num_lines=5):
    """CSVファイルの先頭数行をリストで返す（エンコーディング自動判定）。"""
    for encoding in ("utf-8-sig", "cp932"):
        try:
            with open(file_path, "r", encoding=encoding) as f:
                return [f.readline() for _ in range(num_lines)]
        except (UnicodeDecodeError, UnicodeError):
            continue
    logger.warning("CSVヘッダーの読み込みに失敗: %s", file_path)
    return []


def extract_period_label(file_path):
    """CSVヘッダーから対象期間ラベルを抽出する。"""
    lines = _read_csv_header_lines(file_path)
    start_date = ""
    end_date = ""
    for line in lines:
        if "対象期間開始日：" in line:
            start_date = line.split("対象期間開始日：")[1].split(",")[0].strip()
        elif "対象期間終了日：" in line:
            end_date = line.split("対象期間終了日：")[1].split(",")[0].strip()

    start_date = start_date.replace("\n", "").replace("\r", "").strip()
    end_date = end_date.replace("\n", "").replace("\r", "").strip()

    if not start_date:
        return "対象期間"
    if start_date == end_date:
        return start_date
    return f"{start_date} ～ {end_date}"


def extract_csv_metadata(file_path):
    """CSVヘッダーの対象条件行から店舗名・部門パスを抽出する。

    例: '対象条件：前年同曜日,全店舗,鮮魚>水産ﾃﾞﾘｶ>うなぎ'
    → {"condition": "前年同曜日", "store": "全店舗", "department": "鮮魚>水産ﾃﾞﾘｶ>うなぎ"}
    """
    lines = _read_csv_header_lines(file_path)
    metadata = {"condition": "", "store": "", "department": ""}
    for line in lines:
        if "対象条件：" in line:
            # ダブルクォートと末尾のカンマ区切り空フィールドを除去
            raw = line.split("対象条件：")[1].strip().strip('"')
            # 末尾の連続カンマ（空フィールド）を除去してから分割
            raw = re.sub(r",+\s*$", "", raw)
            parts = [p.strip().strip('"') for p in raw.split(",") if p.strip()]
            if len(parts) >= 1:
                metadata["condition"] = parts[0]
            if len(parts) >= 2:
                metadata["store"] = parts[1]
            if len(parts) >= 3:
                metadata["department"] = parts[2]
            break
    return metadata


import csv


def extract_total_row(file_path):
    """CSVから合計行を安全かつ正確に抽出する（クォート内のカンマに対応）。"""
    for encoding in ("utf-8-sig", "cp932"):
        try:
            with open(file_path, "r", encoding=encoding) as f:
                reader = csv.reader(f)
                for row in reader:
                    if not row:
                        continue
                    # '合計' が含まれる行を探す
                    row_str = " ".join(row)
                    if "合計" in row_str:
                        # 空文字除去した行を返す
                        return [str(c).strip() for c in row]
        except Exception:
            continue
    return None



# ---------------------------------------------------------------------------
# CSV ファイル探索
# ---------------------------------------------------------------------------

def find_csv_files():
    """input_data/ 内のCSVファイルを自動検出し、データの日付順で割当てる。

    データ内の対象期間が古い方を比較基準(week)、新しい方を比較対象(day)として返す。
    """
    csv_files = glob.glob("input_data/*.csv")
    csv_files = [f for f in csv_files if os.path.isfile(f)]

    if len(csv_files) < 2:
        return None, None

    csv_files.sort(key=extract_period_label)
    file_week = csv_files[0]
    file_day = csv_files[-1]
    return file_week, file_day


# ---------------------------------------------------------------------------
# CSV 読み込み・クリーニング
# ---------------------------------------------------------------------------

def normalize_code(code_val) -> str:
    """商品コードを検索用文字列に正規化する（小数点除去・13桁ゼロ埋め）。"""
    if code_val is None or pd.isna(code_val):
        return ""
    s = str(code_val).strip()
    if "." in s:
        s = s.split(".")[0]
    if s.isdigit():
        return s.zfill(13)
    return s


def load_and_clean_csv(file_path):
    """CSVファイルを読み込み、クリーニング済みDataFrameを返す。"""
    try:
        df = pd.read_csv(file_path, header=6, encoding="utf-8-sig")
    except Exception:
        df = pd.read_csv(file_path, header=6, encoding="cp932")

    columns = [
        "code", "name",
        "sales_daily", "sales_total", "sales_ratio",
        "sales_budget_ratio", "sales_compare_ratio",
        "hits_daily", "hits_total", "hits_compare_ratio",
        "unit_price", "unit_price_compare_ratio",
        "loss_discard_amount", "loss_discount_amount",
        "loss_discard_ratio", "loss_discount_ratio", "loss_total_ratio",
        "margin_ratio", "margin_ratio_compare",
        "profit_total", "profit_ratio", "profit_compare_ratio",
    ]

    if len(df.columns) == len(columns):
        df.columns = columns
    else:
        df.columns = columns[: len(df.columns)]

    df = df.dropna(subset=["name"])
    df = df[df["name"] != "合計"]
    df = df.dropna(subset=["code"])
    df["code"] = df["code"].apply(normalize_code)
    df = df[~df["code"].str.contains("商品コード")]

    numeric_cols = [
        "sales_daily", "sales_total", "sales_ratio",
        "sales_budget_ratio", "sales_compare_ratio",
        "hits_daily", "hits_total", "unit_price",
        "profit_total", "profit_ratio", "margin_ratio", "loss_total_ratio",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = (
                df[col].astype(str)
                .str.replace(",", "", regex=False)
                .str.replace("%", "", regex=False)
                .str.strip()
            )
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    return df


# ---------------------------------------------------------------------------
# カテゴリ分類（設定ファイル連携）
# ---------------------------------------------------------------------------

import sys
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
from category_loader import apply_categories, get_category_mapper


def apply_categorization(df_week, df_day):
    """Excel設定ファイル（config.md.xlsx等）に基づきカテゴリ分類を適用する。"""
    return apply_categories(df_week, df_day)



# ---------------------------------------------------------------------------
# 動的コメント生成
# ---------------------------------------------------------------------------

def generate_overall_commentary(week_avg_val, day_sales_val, comp_ratio,
                                week_budget, day_budget, label_week, label_day):
    """セクション1: 売上実績の全体対比コメントを動的生成する。"""
    change_pct = abs(comp_ratio - 100)
    direction = "増加" if comp_ratio >= 100 else "減少"

    # 変動率の記述
    sales_commentary = (
        f"比較対象データ（{label_day}）の日商は、比較基準データ"
        f"（{label_week}）の日商（¥{week_avg_val:,.0f}）と比較して "
        f"<strong>約{change_pct:.0f}%{direction}</strong> しています。"
    )

    # 予算比の分析
    try:
        week_budget_val = float(str(week_budget).replace("%", "").replace(",", ""))
        day_budget_val = float(str(day_budget).replace("%", "").replace(",", ""))
    except (ValueError, TypeError):
        week_budget_val = 0.0
        day_budget_val = 0.0

    if week_budget_val > 0 and day_budget_val > 0:
        if week_budget_val >= 100 and day_budget_val >= 100:
            budget_commentary = (
                f"予算比は比較基準が <strong>{week_budget}</strong>、"
                f"比較対象が <strong>{day_budget}</strong> と、"
                "いずれも予算を上回っており好調な推移です。"
            )
        elif week_budget_val >= 100 and day_budget_val < 100:
            budget_commentary = (
                f"予算比は比較基準が <strong>{week_budget}</strong> と予算超過だったのに対し、"
                f"比較対象は <strong>{day_budget}</strong> と予算を下回っています。"
                "比較基準期間の好調要因（季節需要・特売等）が"
                "比較対象期間では弱まった可能性があります。"
            )
        elif week_budget_val < 100 and day_budget_val >= 100:
            budget_commentary = (
                f"予算比は比較基準が <strong>{week_budget}</strong> と予算未達だったのに対し、"
                f"比較対象は <strong>{day_budget}</strong> と予算超過に転じています。"
                "需要の回復や販促効果が考えられます。"
            )
        else:
            budget_commentary = (
                f"予算比は比較基準が <strong>{week_budget}</strong>、"
                f"比較対象が <strong>{day_budget}</strong> と、"
                "いずれも予算を下回っています。全体的に需要が軟調な状況です。"
            )
    else:
        budget_commentary = ""

    return sales_commentary, budget_commentary


def generate_category_commentary(cat_compare):
    """セクション2: カテゴリ分析のまとめコメントを動的生成する。"""
    if cat_compare.empty:
        return ""

    cat_compare = cat_compare.copy()
    cat_compare["ratio_diff"] = cat_compare["ratio_day"] - cat_compare["ratio_week"]
    cat_compare["sales_diff"] = cat_compare["sales_daily_avg_day"] - cat_compare["sales_daily_avg_week"]

    # 構成比が上昇したカテゴリ（差分降順）
    rising_ratio = cat_compare[cat_compare["ratio_diff"] > 0.01].sort_values(
        "ratio_diff", ascending=False
    )
    # 構成比が下降したカテゴリ（差分昇順）
    falling_ratio = cat_compare[cat_compare["ratio_diff"] < -0.01].sort_values(
        "ratio_diff", ascending=True
    )
    
    # 日商が上昇したカテゴリ（差分降順）
    rising_sales = cat_compare[cat_compare["sales_diff"] > 0].sort_values(
        "sales_diff", ascending=False
    )
    # 日商が下降したカテゴリ（差分昇順）
    falling_sales = cat_compare[cat_compare["sales_diff"] < 0].sort_values(
        "sales_diff", ascending=True
    )

    items = []

    # 1. 日商上昇カテゴリ
    if not rising_sales.empty:
        parts = []
        for cat_name, row in rising_sales.head(3).iterrows():
            parts.append(
                f"「{cat_name}」（<strong>+¥{row['sales_diff']:,.0f}</strong>）"
            )
        items.append(
            '<div class="commentary-item">'
            "<strong>日商が上昇したカテゴリ:</strong> "
            + "、".join(parts)
            + " が比較対象で日商を伸ばしています。"
            "</div>"
        )

    # 2. 日商下降カテゴリ
    if not falling_sales.empty:
        parts = []
        for cat_name, row in falling_sales.head(3).iterrows():
            parts.append(
                f"「{cat_name}」（<strong>¥{row['sales_diff']:,.0f}</strong>）"
            )
        margin_top = "12px" if items else "0px"
        items.append(
            f'<div class="commentary-item" style="margin-top: {margin_top};">'
            "<strong>日商が下降したカテゴリ:</strong> "
            + "、".join(parts)
            + " が比較対象で日商を落としています。"
            "</div>"
        )

    # 3. 構成比上昇カテゴリ
    if not rising_ratio.empty:
        parts = []
        for cat_name, row in rising_ratio.head(3).iterrows():
            parts.append(
                f"「{cat_name}」（<strong>+{row['ratio_diff']:.2f}%</strong>）"
            )
        margin_top = "12px" if items else "0px"
        items.append(
            f'<div class="commentary-item" style="margin-top: {margin_top};">'
            "<strong>構成比が上昇したカテゴリ:</strong> "
            + "、".join(parts)
            + " が比較対象で構成比を伸ばしています。"
            "</div>"
        )

    # 4. 構成比下降カテゴリ
    if not falling_ratio.empty:
        parts = []
        for cat_name, row in falling_ratio.head(3).iterrows():
            parts.append(
                f"「{cat_name}」（<strong>{row['ratio_diff']:.2f}%</strong>）"
            )
        margin_top = "12px" if items else "0px"
        items.append(
            f'<div class="commentary-item" style="margin-top: {margin_top};">'
            "<strong>構成比が下降したカテゴリ:</strong> "
            + "、".join(parts)
            + " が比較対象で構成比を落としています。"
            "</div>"
        )

    if not items:
        # カテゴリが1つしかない場合など
        items.append(
            '<div class="commentary-item">'
            "カテゴリ間の目立った日商・構成比シフトはありませんでした。"
            "個別商品の変動分析をご確認ください。"
            "</div>"
        )

    return "\n".join(items)


def generate_ranking_commentary(df_week, df_day, week_rank_dict):
    """セクション4: ランキング傾向コメントを動的生成する。"""
    # 比較基準 Top5 の商品を取得
    top_week = df_week.sort_values("sales_daily", ascending=False).head(5)
    top_day = df_day.sort_values("sales_daily", ascending=False).head(5)

    # 比較対象の順位マップ
    day_sorted = df_day.sort_values("sales_daily", ascending=False)
    day_rank_dict = {
        str(row.code): idx
        for idx, row in enumerate(day_sorted.itertuples(), 1)
    }

    items = []

    # 1. 安定首位の商品
    if not top_week.empty and not top_day.empty:
        week_top1 = top_week.iloc[0]
        day_rank_of_top1 = day_rank_dict.get(str(week_top1["code"]))
        if day_rank_of_top1 is not None and day_rank_of_top1 <= 3:
            week_val = week_top1["sales_daily"]
            day_val_series = df_day[df_day["code"] == str(week_top1["code"])]["sales_daily"]
            if not day_val_series.empty:
                day_val = day_val_series.iloc[0]
                change_ratio = (day_val / week_val * 100) if week_val > 0 else 0
                items.append(
                    '<div class="commentary-item">'
                    f'<strong>「{week_top1["name"]}」の安定した需要:</strong> '
                    f"比較基準で1位（¥{week_val:,.0f}）、"
                    f"比較対象でも{day_rank_of_top1}位（¥{day_val:,.0f}、"
                    f"前期比{change_ratio:.0f}%）と上位を維持しています。"
                    "</div>"
                )

    # 2. 比較対象で急上昇した商品
    rising_items = []
    for _, row in top_day.iterrows():
        prev_rank = week_rank_dict.get(str(row["code"]))
        day_rank = day_rank_dict.get(str(row["code"]))
        if prev_rank is not None and day_rank is not None:
            rank_change = prev_rank - day_rank
            if rank_change >= 3:
                rising_items.append(
                    f"「{row['name']}」（{prev_rank}位→{day_rank}位）"
                )
        elif prev_rank is None and day_rank is not None and day_rank <= 5:
            rising_items.append(
                f"「{row['name']}」（圏外→{day_rank}位）"
            )

    if rising_items:
        items.append(
            '<div class="commentary-item" style="margin-top: 12px;">'
            "<strong>比較対象で順位が上昇した商品:</strong> "
            + "、".join(rising_items[:3])
            + " がランクアップしました。"
            "</div>"
        )

    # 3. 比較基準から大きく下落した商品
    falling_items = []
    for _, row in top_week.iterrows():
        day_rank = day_rank_dict.get(str(row["code"]))
        prev_rank = week_rank_dict.get(str(row["code"]))
        if day_rank is not None and prev_rank is not None:
            rank_change = day_rank - prev_rank
            if rank_change >= 3:
                falling_items.append(
                    f"「{row['name']}」（{prev_rank}位→{day_rank}位）"
                )

    if falling_items:
        items.append(
            '<div class="commentary-item" style="margin-top: 12px;">'
            "<strong>比較対象で順位が下降した商品:</strong> "
            + "、".join(falling_items[:3])
            + " が順位を落としています。"
            "</div>"
        )

    if not items:
        items.append(
            '<div class="commentary-item">'
            "比較基準と比較対象の間で、ランキング上位の顔ぶれに"
            "大きな変動は見られません。"
            "</div>"
        )

    return "\n".join(items)


# ---------------------------------------------------------------------------
# HTML レポート生成
# ---------------------------------------------------------------------------

def _get_val_from_row(row, idx, default="0"):
    """リストまたはSeriesから安全にインデックス位置の値を取得する。"""
    if row is None:
        return default
    try:
        if hasattr(row, "iloc"):
            return str(row.iloc[idx])
        return str(row[idx])
    except (IndexError, KeyError):
        return default



def generate_html_report(
    df_week, df_day, df_growth, df_decline, cat_compare,
    total_row_week, total_row_day, label_week, label_day, header_meta
):
    """データから HTML ダッシュボードレポートを生成する。"""
    week_sales_raw = _get_val_from_row(total_row_week, 2, "0").replace(",", "").replace("¥", "")
    day_sales_raw = _get_val_from_row(total_row_day, 2, "0").replace(",", "").replace("¥", "")
    week_avg_val = float(week_sales_raw) if week_sales_raw else 0
    day_sales_val = float(day_sales_raw) if day_sales_raw else 0

    week_budget = _get_val_from_row(total_row_week, 5, "0.0%")
    day_budget = _get_val_from_row(total_row_day, 5, "0.0%")


    comp_ratio = (day_sales_val / week_avg_val * 100) if week_avg_val > 0 else 0
    comp_diff = day_sales_val - week_avg_val

    comp_color = "var(--accent-green)" if comp_diff >= 0 else "var(--accent-red)"
    comp_diff_sign = "+" if comp_diff >= 0 else ""
    budget_badge_class = "badge-up" if comp_diff >= 0 else "badge-down"

    # --- 動的コメント生成 ---
    sales_commentary, budget_commentary = generate_overall_commentary(
        week_avg_val, day_sales_val, comp_ratio,
        week_budget, day_budget, label_week, label_day,
    )
    category_commentary_html = generate_category_commentary(cat_compare)

    # --- 急上昇商品テーブル ---
    growth_list_html = []
    for idx, row in enumerate(df_growth.head(10).itertuples(), 1):
        ratio_pct = row.sales_growth_ratio * 100
        growth_list_html.append(f"""
        <tr class="item-row">
            <td style="width: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">{idx}</td>
            <td style="font-weight: 500;">{row.name}</td>
            <td style="text-align: right; font-weight: 600; color: var(--accent-green);">+¥{row.sales_diff:,.0f}</td>
            <td style="text-align: right; font-size: 12px; color: var(--text-muted);">
                ¥{row.sales_daily_week:,.0f} ➔ ¥{row.sales_daily_day:,.0f} ({ratio_pct:.0f}%)
            </td>
        </tr>""")
    growth_list_html = "\n".join(growth_list_html)

    # --- 急下落商品テーブル ---
    decline_list_html = []
    for idx, row in enumerate(df_decline.head(10).itertuples(), 1):
        ratio_pct = row.sales_growth_ratio * 100
        decline_list_html.append(f"""
        <tr class="item-row">
            <td style="width: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">{idx}</td>
            <td style="font-weight: 500;">{row.name}</td>
            <td style="text-align: right; font-weight: 600; color: var(--accent-red);">{row.sales_diff:+,.0f}円</td>
            <td style="text-align: right; font-size: 12px; color: var(--text-muted);">
                ¥{row.sales_daily_week:,.0f} ➔ ¥{row.sales_daily_day:,.0f} ({ratio_pct:.0f}%)
            </td>
        </tr>""")
    decline_list_html = "\n".join(decline_list_html)

    # --- 比較基準ランキングテーブル ---
    top_week = df_week.sort_values(by="sales_daily", ascending=False).head(15)
    ranking_week_rows = []
    for idx, row in enumerate(top_week.itertuples(), 1):
        loss_ratio = row.loss_total_ratio
        loss_width = min(max(loss_ratio, 0), 100)
        bar_color = (
            "var(--accent-red)" if loss_ratio >= 10 else "var(--primary-light)"
        )
        ranking_week_rows.append(f"""
        <tr>
            <td style="font-weight: 700; text-align: center;">{idx}</td>
            <td class="product-name">{row.name}</td>
            <td style="color: var(--text-muted); font-size: 12px;">{row.code}</td>
            <td style="text-align: right; font-weight: 600;">¥{row.sales_daily:,.0f}</td>
            <td style="text-align: right;">{row.sales_ratio}%</td>
            <td>
                <div class="progress-bar-container"><div class="progress-bar" style="width: {loss_width}%; background-color: {bar_color};"></div></div>{loss_ratio:.1f}%
            </td>
        </tr>""")
    ranking_week_rows = "\n".join(ranking_week_rows)

    # 比較基準の順位マップを作成
    df_week_sorted = df_week.sort_values(by="sales_daily", ascending=False)
    week_rank_dict = {
        str(row.code): idx
        for idx, row in enumerate(df_week_sorted.itertuples(), 1)
    }

    # --- 比較対象ランキングテーブル ---
    top_day = df_day.sort_values(by="sales_daily", ascending=False).head(15)
    ranking_day_rows = []
    for idx, row in enumerate(top_day.itertuples(), 1):
        loss_ratio = row.loss_total_ratio
        loss_width = min(max(loss_ratio, 0), 100)
        bar_color = (
            "var(--accent-red)" if loss_ratio >= 10 else "var(--primary-light)"
        )
        prev_rank = week_rank_dict.get(str(row.code))
        prev_rank_str = f"{prev_rank}位" if prev_rank is not None else "圏外"
        ranking_day_rows.append(f"""
        <tr>
            <td style="font-weight: 700; text-align: center;">{idx}</td>
            <td class="product-name">{row.name}</td>
            <td style="color: var(--text-muted); font-size: 12px;">{row.code}</td>
            <td style="text-align: right; font-weight: 600;">¥{row.sales_daily:,.0f}</td>
            <td style="text-align: right;">{row.sales_ratio}%</td>
            <td style="font-weight: 600; text-align: center;">{prev_rank_str}</td>
            <td>
                <div class="progress-bar-container"><div class="progress-bar" style="width: {loss_width}%; background-color: {bar_color};"></div></div>{loss_ratio:.1f}%
            </td>
        </tr>""")
    ranking_day_rows = "\n".join(ranking_day_rows)

    # --- ランキング傾向コメント ---
    ranking_commentary_html = generate_ranking_commentary(
        df_week, df_day, week_rank_dict
    )

    # --- カテゴリ別テーブル（構成比の高い順にソート、売上があるものを優先） ---
    cat_compare = cat_compare.sort_values("sales_daily_avg_day", ascending=False)
    # 売上が両期間とも0のカテゴリは除外（または末尾に）
    cat_active = cat_compare[
        (cat_compare["sales_daily_avg_week"] > 0) | (cat_compare["sales_daily_avg_day"] > 0)
    ]
    if cat_active.empty:
        cat_active = cat_compare

    category_table_rows = []
    for cat, row in cat_active.iterrows():
        diff_val = row.ratio_day - row.ratio_week
        diff_class = "badge-up" if diff_val >= 0 else "badge-down"
        diff_sign = "+" if diff_val >= 0 else ""
        
        sales_diff = row.sales_daily_avg_day - row.sales_daily_avg_week
        sales_diff_class = "badge-up" if sales_diff >= 0 else "badge-down"
        sales_diff_sign = "+" if sales_diff >= 0 else ""

        category_table_rows.append(f"""
        <tr>
            <td style="font-weight: 600; color: var(--primary);">{cat}</td>
            <td style="text-align: right;">¥{row.sales_daily_avg_week:,.0f}</td>
            <td style="text-align: right;">{row.ratio_week:.2f}%</td>
            <td style="text-align: right;">¥{row.sales_daily_avg_day:,.0f}</td>
            <td style="text-align: right; font-weight: 600;" class="{sales_diff_class}">{sales_diff_sign}¥{sales_diff:,.0f}</td>
            <td style="text-align: right;">{row.ratio_day:.2f}%</td>
            <td style="text-align: right; font-weight: 600;" class="{diff_class}">{diff_sign}{diff_val:.2f}%</td>
        </tr>""")
    category_table_rows = "\n".join(category_table_rows)

    # 棒グラフデータ（売上上位12カテゴリ）
    bar_top = cat_active.head(12)
    cat_bar_labels = list(bar_top.index)
    cat_bar_week_data = [float(x) for x in bar_top["sales_daily_avg_week"]]
    cat_bar_day_data = [float(x) for x in bar_top["sales_daily_avg_day"]]
    
    # 対比（比率）データ = (比較対象 / 比較基準) * 100
    cat_bar_ratio_data = []
    for week_val, day_val in zip(cat_bar_week_data, cat_bar_day_data):
        if week_val > 0:
            cat_bar_ratio_data.append(round((day_val / week_val) * 100, 1))
        else:
            cat_bar_ratio_data.append(0.0)

    # 円グラフデータ（売上上位7カテゴリ＋その他合算）
    if len(cat_active) > 8:
        pie_top7 = cat_active.head(7)
        pie_other_ratio = float(cat_active.iloc[7:]["ratio_day"].sum())
        cat_pie_labels = list(pie_top7.index) + ["その他（上記以外）"]
        cat_pie_data = [round(float(x), 2) for x in pie_top7["ratio_day"]] + [round(pie_other_ratio, 2)]
    else:
        cat_pie_labels = list(cat_active.index)
        cat_pie_data = [round(float(x), 2) for x in cat_active["ratio_day"]]

    pie_palette = [
        "#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6",
        "#06b6d4", "#f97316", "#84cc16", "#64748b", "#a855f7"
    ]
    pie_colors = pie_palette[: len(cat_pie_labels)]


    html_template = """<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>売上実績＆売れ筋商品比較分析ダッシュボード</title>
    <meta name="description" content="売上データを日商ベースで比較分析したダッシュボードです。">
    <!-- Google Fonts: Noto Sans JP & Outfit (For numbers only) -->
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {{
            --bg-color: #0f1117;
            --card-bg: #1a1d27;
            --primary: #e2e8f0;
            --primary-light: #94a3b8;
            --border-color: #2d3348;
            --border-light: #232839;
            --text-main: #e2e8f0;
            --text-muted: #94a3b8;
            --accent-green: #4ade80;
            --accent-red: #f87171;
            --th-bg: #161924;
            --hover-bg: #1f2233;
            --radius-sm: 0px;
            --radius-md: 0px;
            --radius-lg: 0px;
        }}

        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: 'Noto Sans JP', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            line-height: 1.6;
            padding: 40px 24px;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}

        header {{
            border-bottom: 2px solid var(--primary);
            padding-bottom: 20px;
            margin-bottom: 40px;
        }}

        .header-title-area {{
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            flex-wrap: wrap;
            gap: 16px;
        }}

        h1 {{
            font-size: 26px;
            font-weight: 700;
            color: var(--primary);
            letter-spacing: -0.5px;
        }}

        .header-meta {{
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 500;
            border-left: 2px solid var(--border-color);
            padding-left: 12px;
        }}

        .summary-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }}

        .card {{
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            padding: 24px;
            transition: background-color 0.2s ease;
        }}

        .card-title {{
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }}

        .card-value {{
            font-size: 32px;
            font-weight: 700;
            margin-top: 8px;
            font-family: 'Outfit', sans-serif;
            color: var(--primary);
        }}

        .card-subtext {{
            font-size: 12px;
            margin-top: 8px;
            color: var(--text-muted);
            font-weight: 500;
        }}

        .badge-up {{
            color: var(--accent-green);
        }}

        .badge-down {{
            color: var(--accent-red);
        }}

        .section-title {{
            font-size: 18px;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .chart-section {{
            display: grid;
            grid-template-columns: 1fr;
            gap: 30px;
            margin-bottom: 40px;
        }}

        .chart-card {{
            border: 1px solid var(--border-color);
            padding: 24px;
            background: var(--card-bg);
        }}

        .chart-container {{
            position: relative;
            width: 100%;
            height: 320px;
        }}

        .grid-2col {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 40px;
        }}

        @media (max-width: 900px) {{
            .grid-2col {{
                grid-template-columns: 1fr;
            }}
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 13px;
        }}

        th {{
            background-color: var(--th-bg);
            padding: 10px 12px;
            font-weight: 700;
            color: var(--primary);
            border-top: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
        }}

        td {{
            padding: 12px 12px;
            border-bottom: 1px solid var(--border-light);
            vertical-align: middle;
        }}

        tr.item-row:hover td {{
            background-color: var(--hover-bg);
        }}

        .table-responsive {{
            overflow-x: auto;
            width: 100%;
        }}

        .table-card {{
            border: 1px solid var(--border-color);
            padding: 24px;
            margin-bottom: 40px;
        }}

        .tab-menu {{
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
        }}

        .tab-btn {{
            background-color: transparent;
            border: none;
            padding: 6px 16px;
            cursor: pointer;
            font-weight: 700;
            font-size: 13px;
            color: var(--text-muted);
            transition: all 0.2s;
            border-bottom: 2px solid transparent;
        }}

        .tab-btn.active {{
            color: var(--primary);
            border-bottom: 2px solid var(--primary);
        }}

        .progress-bar-container {{
            width: 80px;
            background-color: var(--border-light);
            height: 4px;
            display: inline-block;
            vertical-align: middle;
            margin-right: 8px;
        }}

        .progress-bar {{
            height: 100%;
            background-color: var(--primary-light);
        }}

        .commentary-block {{
            margin-top: 20px;
            padding-left: 20px;
            border-left: 3px solid var(--primary);
        }}

        .commentary-title {{
            font-size: 14px;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 8px;
        }}

        .commentary-body {{
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.8;
        }}

        .commentary-item {{
            margin-bottom: 12px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <!-- ヘッダー -->
        <header id="header-main">
            <div class="header-title-area">
                <div>
                    <h1>売上実績＆売れ筋商品 比較分析ダッシュボード</h1>
                </div>
                <div class="header-meta">
                    {header_meta}
                </div>
            </div>
        </header>

        <!-- 主要サマリー指標 -->
        <div class="summary-grid">
            <!-- 指標1 -->
            <div class="card" id="card-week-avg">
                <span class="card-title">比較基準データ</span>
                <div class="card-value">¥{week_avg_val:,.0f}</div>
                <div class="card-subtext">{label_week}</div>
            </div>

            <!-- 指標2 -->
            <div class="card" id="card-day-sales">
                <span class="card-title">比較対象データ</span>
                <div class="card-value">¥{day_sales_val:,.0f}</div>
                <div class="card-subtext">{label_day}</div>
            </div>

            <!-- 指標3 -->
            <div class="card" id="card-comparison">
                <span class="card-title">比較基準に対する比率</span>
                <div class="card-value" style="color: {comp_color};">{comp_ratio:.2f}%</div>
                <div class="card-subtext">
                    差額: <span class="{budget_badge_class}">{comp_diff_sign}¥{comp_diff:,.0f}</span>
                </div>
            </div>
        </div>

        <!-- 1. 売上実績の全体対比 分析・解説 -->
        <div class="card" style="margin-bottom: 40px;">
            <h3 class="section-title">1. 売上実績の全体対比 (日商ベース)</h3>
            <div class="commentary-body">
                <div class="commentary-item">
                    <strong>日商の推移:</strong> {sales_commentary}
                </div>
                <div class="commentary-item" style="margin-top: 12px;">
                    <strong>予算比分析:</strong> {budget_commentary}
                </div>
            </div>
        </div>

        <!-- 2. カテゴリ別の売上構成比のシフトセクション -->
        <div class="card" style="margin-bottom: 40px;">
            <h3 class="section-title">2. カテゴリ別の売上構成比のシフト (日商ベース)</h3>
            <div style="display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 30px; margin-top: 16px;">
                <!-- 左：カテゴリテーブル -->
                <div class="table-responsive">
                    <table>
                        <thead>
                            <tr>
                                <th>カテゴリ</th>
                                <th style="text-align: right;">比較基準 日商平均</th>
                                <th style="text-align: right;">比較基準 構成比</th>
                                <th style="text-align: right;">比較対象 日商</th>
                                <th style="text-align: right;">日商差分</th>
                                <th style="text-align: right;">比較対象 構成比</th>
                                <th style="text-align: right;">構成比差分</th>
                            </tr>
                        </thead>
                        <tbody>
                            {category_table_rows}
                        </tbody>
                    </table>
                </div>
                <!-- 右：円グラフ -->
                <div class="chart-container" style="display: flex; align-items: center; justify-content: center;">
                    <canvas id="categoryPieChart"></canvas>
                </div>
            </div>

            <!-- カテゴリ分析のまとめ -->
            <div class="commentary-block">
                <div class="commentary-title">カテゴリ分析のまとめ</div>
                <div class="commentary-body">
                    {category_commentary_html}
                </div>
            </div>
        </div>

        <!-- カテゴリ別日商対比棒グラフ -->
        <div class="chart-card" style="margin-bottom: 40px;">
            <h3 class="section-title" style="border-bottom: none; margin-bottom: 0;">カテゴリ別日商対比 (比較基準 vs 比較対象)</h3>
            <div class="chart-container" style="margin-top: 20px;">
                <canvas id="categoryBarChart"></canvas>
            </div>
        </div>

        <!-- 3. 日商変動の顕著な商品分析 -->
        <div style="margin-bottom: 40px;">
            <h3 class="section-title">3. 日商変動の顕著な商品分析</h3>
            <div class="grid-2col">
                <!-- 急上昇 -->
                <div class="chart-card">
                    <h4 style="font-size: 14px; font-weight: 700; color: var(--accent-green); margin-bottom: 16px;">
                        日商増加額の上位10商品
                    </h4>
                    <div class="table-responsive">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;">#</th>
                                    <th>商品名</th>
                                    <th style="text-align: right;">増加額</th>
                                    <th style="text-align: right;">推移 (伸長率)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {growth_list_html}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 急下落 -->
                <div class="chart-card">
                    <h4 style="font-size: 14px; font-weight: 700; color: var(--accent-red); margin-bottom: 16px;">
                        日商減少額の上位10商品
                    </h4>
                    <div class="table-responsive">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;">#</th>
                                    <th>商品名</th>
                                    <th style="text-align: right;">減少額</th>
                                    <th style="text-align: right;">推移 (残存率)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {decline_list_html}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. 売れ筋ランキング比較テーブル -->
        <div class="table-card" id="card-rankings">
            <h3 class="section-title">4. 売れ筋商品ランキング比較 (Top 15 - 日商ベース)</h3>

            <div class="tab-menu" role="tablist">
                <button class="tab-btn active" onclick="switchTab('week')" role="tab" aria-selected="true" id="tab-btn-week">比較基準: {label_week}</button>
                <button class="tab-btn" onclick="switchTab('day')" role="tab" aria-selected="false" id="tab-btn-day">比較対象: {label_day}</button>
            </div>

            <!-- 比較基準ランキングテーブル -->
            <div class="table-responsive" id="table-week">
                <table id="tbl-week">
                    <thead>
                        <tr>
                            <th style="width: 60px; text-align: center;">順位</th>
                            <th>商品名</th>
                            <th>商品コード</th>
                            <th style="text-align: right;">日商</th>
                            <th style="text-align: right;">構成比</th>
                            <th>ロス率</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ranking_week_rows}
                    </tbody>
                </table>
            </div>

            <!-- 比較対象ランキングテーブル -->
            <div class="table-responsive" id="table-day" style="display: none;">
                <table id="tbl-day">
                    <thead>
                        <tr>
                            <th style="width: 60px; text-align: center;">順位</th>
                            <th>商品名</th>
                            <th>商品コード</th>
                            <th style="text-align: right;">日商</th>
                            <th style="text-align: right;">構成比</th>
                            <th style="width: 100px; text-align: center;">比較基準順位</th>
                            <th>ロス率</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ranking_day_rows}
                    </tbody>
                </table>
            </div>

            <!-- ランキング傾向 -->
            <div class="commentary-block">
                <div class="commentary-title">日商ベースでのランキング傾向</div>
                <div class="commentary-body">
                    {ranking_commentary_html}
                </div>
            </div>
        </div>
    </div>

    <!-- チャートデータの流し込みと制御スクリプト -->
    <script>
        // タブ切替ロジック
        function switchTab(tab) {{
            const btnWeek = document.getElementById('tab-btn-week');
            const btnDay = document.getElementById('tab-btn-day');
            const tblWeek = document.getElementById('table-week');
            const tblDay = document.getElementById('table-day');

            if (tab === 'week') {{
                btnWeek.classList.add('active');
                btnWeek.setAttribute('aria-selected', 'true');
                btnDay.classList.remove('active');
                btnDay.setAttribute('aria-selected', 'false');
                tblWeek.style.display = 'block';
                tblDay.style.display = 'none';
            }} else {{
                btnDay.classList.add('active');
                btnDay.setAttribute('aria-selected', 'true');
                btnWeek.classList.remove('active');
                btnWeek.setAttribute('aria-selected', 'false');
                tblDay.style.display = 'block';
                tblWeek.style.display = 'none';
            }}
        }}

        // グラフ描画
        document.addEventListener('DOMContentLoaded', function() {{
            // カテゴリ別棒グラフ（上位カテゴリ）
            const barCtx = document.getElementById('categoryBarChart').getContext('2d');
            new Chart(barCtx, {{
                type: 'bar',
                data: {{
                    labels: {cat_bar_labels_js},
                    datasets: [
                        {{
                            label: '対比',
                            type: 'line',
                            data: {cat_bar_ratio_data_js},
                            backgroundColor: '#fbbf24',
                            borderColor: '#fbbf24',
                            borderWidth: 2,
                            fill: false,
                            yAxisID: 'y1',
                            tension: 0.1
                        }},
                        {{
                            label: '比較基準',
                            type: 'bar',
                            data: {cat_bar_week_data_js},
                            backgroundColor: '#475569',
                            borderColor: '#64748b',
                            borderWidth: 1,
                            yAxisID: 'y'
                        }},
                        {{
                            label: '比較対象',
                            type: 'bar',
                            data: {cat_bar_day_data_js},
                            backgroundColor: '#60a5fa',
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            yAxisID: 'y'
                        }}
                    ]
                }},
                options: {{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {{
                        y: {{
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            ticks: {{
                                color: '#94a3b8',
                                callback: function(value) {{
                                    return '¥' + value.toLocaleString();
                                }}
                            }},
                            grid: {{
                                color: '#2d3348'
                            }}
                        }},
                        y1: {{
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            title: {{
                                display: true,
                                text: '対比 (%)',
                                color: '#94a3b8'
                            }},
                            ticks: {{
                                color: '#94a3b8',
                                callback: function(value) {{
                                    return value + '%';
                                }}
                            }},
                            grid: {{
                                drawOnChartArea: false,
                                color: '#2d3348'
                            }}
                        }},
                        x: {{
                            ticks: {{
                                color: '#94a3b8',
                                autoSkip: false,
                                maxRotation: 45,
                                minRotation: 0
                            }},
                            grid: {{
                                color: '#2d3348'
                            }}
                        }}
                    }},
                    plugins: {{
                        legend: {{
                            labels: {{
                                color: '#e2e8f0',
                                font: {{
                                    family: "'Noto Sans JP', sans-serif",
                                    weight: 'bold'
                                }}
                            }}
                        }},
                        tooltip: {{
                            callbacks: {{
                                label: function(context) {{
                                    if (context.dataset.type === 'line') {{
                                        return context.dataset.label + ': ' + context.raw + '%';
                                    }}
                                    return context.dataset.label + ': ¥' + context.raw.toLocaleString();
                                }}
                            }}
                        }}
                    }}
                }}
            }});

            // 構成比円グラフ（上位＋その他）
            const pieCtx = document.getElementById('categoryPieChart').getContext('2d');
            new Chart(pieCtx, {{
                type: 'doughnut',
                data: {{
                    labels: {cat_pie_labels_js},
                    datasets: [{{
                        data: {cat_pie_data_js},
                        backgroundColor: {pie_colors_js},
                        borderWidth: 1,
                        borderColor: '#1a1d27'
                    }}]
                }},
                options: {{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {{
                        legend: {{
                            position: 'right',
                            labels: {{
                                color: '#e2e8f0',
                                boxWidth: 12,
                                padding: 10,
                                font: {{
                                    size: 11,
                                    family: "'Noto Sans JP', sans-serif"
                                }}
                            }}
                        }},
                        tooltip: {{
                            callbacks: {{
                                label: function(context) {{
                                    return ' ' + context.label + ': ' + context.raw + '%';
                                }}
                            }}
                        }}
                    }}
                }}
            }});
        }});
    </script>
</body>
</html>"""

    html_content = html_template.format(
        week_avg_val=week_avg_val,
        day_sales_val=day_sales_val,
        comp_ratio=comp_ratio,
        comp_diff=abs(comp_diff),
        comp_color=comp_color,
        comp_diff_sign=comp_diff_sign,
        budget_badge_class=budget_badge_class,
        sales_commentary=sales_commentary,
        budget_commentary=budget_commentary,
        category_commentary_html=category_commentary_html,
        ranking_commentary_html=ranking_commentary_html,
        growth_list_html=growth_list_html,
        decline_list_html=decline_list_html,
        ranking_week_rows=ranking_week_rows,
        ranking_day_rows=ranking_day_rows,
        category_table_rows=category_table_rows,
        label_week=label_week,
        label_day=label_day,
        header_meta=header_meta,
        cat_bar_labels_js=json.dumps(cat_bar_labels, ensure_ascii=False),
        cat_bar_week_data_js=json.dumps(cat_bar_week_data),
        cat_bar_day_data_js=json.dumps(cat_bar_day_data),
        cat_bar_ratio_data_js=json.dumps(cat_bar_ratio_data),
        cat_pie_labels_js=json.dumps(cat_pie_labels, ensure_ascii=False),
        cat_pie_data_js=json.dumps(cat_pie_data),
        pie_colors_js=json.dumps(pie_colors),
    )

    output_dir = "output_data"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_path = os.path.join(output_dir, "sales_analysis_report.html")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    logger.info("Web report successfully generated: %s", output_path)


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------

def main():
    """メインエントリポイント。"""
    file_week, file_day = find_csv_files()

    if not file_week or not file_day:
        logger.error("Required CSV files not found in input_data/.")
        return

    logger.info("比較基準: %s", file_week)
    logger.info("比較対象: %s", file_day)

    # 日付ラベルの自動抽出
    label_week = extract_period_label(file_week)
    label_day = extract_period_label(file_day)

    # CSVメタデータの抽出（店舗名・部門パス）
    metadata = extract_csv_metadata(file_week)
    store = metadata["store"] if metadata["store"] else "全店舗"
    department = metadata["department"] if metadata["department"] else "全集計部門"
    header_meta = f"{store} / {department}"

    df_week = load_and_clean_csv(file_week)
    df_day = load_and_clean_csv(file_day)

    # 合計行の抽出
    total_row_week = extract_total_row(file_week)
    total_row_day = extract_total_row(file_day)


    # 商品別マージ & 変動分析
    df_merged = pd.merge(
        df_week[["code", "name", "sales_daily", "sales_ratio"]],
        df_day[["code", "sales_daily", "sales_ratio"]],
        on="code",
        how="outer",
        suffixes=("_week", "_day"),
    ).fillna(0)

    # name補完
    df_merged["name"] = df_merged["name"].replace(0, "")
    df_merged = pd.merge(
        df_merged,
        df_day[["code", "name"]],
        on="code",
        how="left",
        suffixes=("", "_day_name"),
    )
    df_merged["name"] = df_merged["name"].fillna("").astype(str)
    if "name_day_name" in df_merged.columns:
        df_merged["name"] = df_merged.apply(
            lambda r: r["name"] if r["name"] != "" else r["name_day_name"],
            axis=1,
        )
        df_merged.drop(columns=["name_day_name"], inplace=True)

    df_merged["sales_diff"] = (
        df_merged["sales_daily_day"] - df_merged["sales_daily_week"]
    )
    df_merged["sales_growth_ratio"] = np.where(
        df_merged["sales_daily_week"] > 0,
        df_merged["sales_daily_day"] / df_merged["sales_daily_week"],
        0,
    )

    # 変動が顕著な商品のみ抽出（データが十分あれば日商基準でフィルタ、少なければ全体から抽出）
    significant_mask = (
        (df_merged["sales_daily_week"] >= 1000)
        | (df_merged["sales_daily_day"] >= 5000)
    )
    df_growth = (
        df_merged[significant_mask & (df_merged["sales_diff"] > 0)]
        .sort_values(by="sales_diff", ascending=False)
    )
    if len(df_growth) < 10:
        df_growth = (
            df_merged[df_merged["sales_diff"] > 0]
            .sort_values(by="sales_diff", ascending=False)
        )

    df_decline = (
        df_merged[significant_mask & (df_merged["sales_diff"] < 0)]
        .sort_values(by="sales_diff", ascending=True)
    )
    if len(df_decline) < 10:
        df_decline = (
            df_merged[df_merged["sales_diff"] < 0]
            .sort_values(by="sales_diff", ascending=True)
        )


    # カテゴリ分類（汎用）
    df_week, df_day = apply_categorization(df_week, df_day)

    cat_week = df_week.groupby("category").agg(
        sales_daily_avg=("sales_daily", "sum")
    )
    cat_week["ratio"] = (
        cat_week["sales_daily_avg"] / cat_week["sales_daily_avg"].sum() * 100
    )

    cat_day = df_day.groupby("category").agg(
        sales_daily_avg=("sales_daily", "sum")
    )
    cat_day["ratio"] = (
        cat_day["sales_daily_avg"] / cat_day["sales_daily_avg"].sum() * 100
    )

    cat_compare = pd.merge(
        cat_week[["sales_daily_avg", "ratio"]],
        cat_day[["sales_daily_avg", "ratio"]],
        on="category",
        how="outer",
        suffixes=("_week", "_day"),
    ).fillna(0)

    generate_html_report(
        df_week, df_day, df_growth, df_decline, cat_compare,
        total_row_week, total_row_day, label_week, label_day, header_meta,
    )


if __name__ == "__main__":
    main()
