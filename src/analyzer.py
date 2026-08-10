import os
import sys
import glob
import re
import pandas as pd
import numpy as np

_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
from category_loader import apply_categories

def extract_start_date_from_csv(file_path):
    """
    CSVファイルの2行目を読み込み、対象期間開始日の日付を取得します。
    """
    try:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            f.readline()  # 1行目スキップ
            line2 = f.readline()
    except Exception:
        with open(file_path, 'r', encoding='cp932') as f:
            f.readline()  # 1行目スキップ
            line2 = f.readline()
            
    # 例：対象期間開始日：2026年07月06日(月),,,,,,,,,,,,,,,,,,,,,
    match = re.search(r"対象期間開始日：(\d{4})年(\d{2})月(\d{2})日(\([^)]+\))?", line2)
    if match:
        year = match.group(1)
        month = match.group(2)
        day = match.group(3)
        wday = match.group(4) if match.group(4) else ""
        date_str = f"{year}-{month}-{day}"
        label_date_str = f"{year}/{month}/{day}{wday}"
        return date_str, label_date_str
    else:
        mtime = os.path.getmtime(file_path)
        dt = pd.to_datetime(mtime, unit='s').tz_localize('UTC').tz_convert('Asia/Tokyo')
        date_str = dt.strftime('%Y-%m-%d')
        label_date_str = dt.strftime('%Y/%m/%d')
        return date_str, label_date_str

def get_sorted_csv_files(directory="input_data"):
    """
    input_dataディレクトリ内のCSVファイルを検出し、CSV内の対象期間開始日順（古い順）にソートして返します。
    """
    pattern = os.path.join(directory, "販売管理表(単品別売上実績)-*.csv")
    files = glob.glob(pattern)
    
    parsed_files = []
    for f in files:
        start_date, label_date = extract_start_date_from_csv(f)
        
        match = re.search(r"(\d{12})", os.path.basename(f))
        if match:
            timestamp = match.group(1)
            time_str = f"{timestamp[8:10]}:{timestamp[10:12]}"
        else:
            mtime = os.path.getmtime(f)
            dt = pd.to_datetime(mtime, unit='s').tz_localize('UTC').tz_convert('Asia/Tokyo')
            timestamp = dt.strftime('%Y%m%d%H%M')
            time_str = dt.strftime('%H:%M')
            
        formatted_label = f"{label_date} {time_str}"
        sort_key = (start_date, timestamp)
        parsed_files.append((f, sort_key, formatted_label))
        
    parsed_files.sort(key=lambda x: x[1])
    return parsed_files

def load_and_clean_csv(file_path):
    try:
        df = pd.read_csv(file_path, header=6, encoding='utf-8-sig')
    except Exception:
        df = pd.read_csv(file_path, header=6, encoding='cp932')
    
    columns = [
        'code', 'name', 
        'sales_daily', 'sales_total', 'sales_ratio', 'sales_budget_ratio', 'sales_compare_ratio',
        'hits_daily', 'hits_total', 'hits_compare_ratio',
        'unit_price', 'unit_price_compare_ratio',
        'loss_discard_amount', 'loss_discount_amount', 'loss_discard_ratio', 'loss_discount_ratio', 'loss_total_ratio',
        'margin_ratio', 'margin_ratio_compare',
        'profit_total', 'profit_ratio', 'profit_compare_ratio'
    ]
    
    if len(df.columns) == len(columns):
        df.columns = columns
    else:
        df.columns = columns[:len(df.columns)]
    
    df = df.dropna(subset=['name'])
    df = df[df['name'] != '合計']
    df = df.dropna(subset=['code'])
    df['code'] = df['code'].astype(str).str.strip()
    df = df[~df['code'].str.contains('商品コード')]
    
    num_cols = [
        'sales_daily', 'sales_total', 'sales_ratio', 'sales_budget_ratio', 'sales_compare_ratio',
        'hits_daily', 'hits_total', 'unit_price', 'profit_total', 'profit_ratio',
        'loss_discard_ratio', 'loss_discount_ratio', 'loss_total_ratio', 'margin_ratio'
    ]
    for col in num_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).str.replace(',', '').str.replace('%', '').str.strip()
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
    return df

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
                    row_str = " ".join(row)
                    if "合計" in row_str:
                        return [str(c).strip() for c in row]
        except Exception:
            continue
    return None



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


def analyze_and_compare(file_newer, file_older, label_newer, label_older):
    """
    2つのCSVファイルを比較分析し、目次、マークダウンテーブル、動的解説文を含むリッチレポートを生成します。
    """
    df_week = load_and_clean_csv(file_older)
    df_day = load_and_clean_csv(file_newer)

    total_row_week = extract_total_row(file_older)
    total_row_day = extract_total_row(file_newer)

    # 1. 売上実績の全体対比数値の抽出と計算
    try:
        older_sales_val = float(_get_val_from_row(total_row_week, 2, "0").replace(",", "").replace("¥", ""))
        older_budget_val = float(_get_val_from_row(total_row_week, 5, "0").replace("%", ""))
    except Exception:
        older_sales_val = 0
        older_budget_val = 0

    try:
        newer_sales_val = float(_get_val_from_row(total_row_day, 2, "0").replace(",", "").replace("¥", ""))
        newer_budget_val = float(_get_val_from_row(total_row_day, 5, "0").replace("%", ""))
    except Exception:
        newer_sales_val = 0
        newer_budget_val = 0


    diff_sales = newer_sales_val - older_sales_val
    ratio_sales = (newer_sales_val / older_sales_val * 100) if older_sales_val > 0 else 0
    diff_pct = ((newer_sales_val - older_sales_val) / older_sales_val * 100) if older_sales_val > 0 else 0

    trend_word = "増加" if diff_sales >= 0 else "減少"
    budget_comment = ""
    if newer_budget_val >= 100 and older_budget_val >= 100:
        budget_comment = "両期間ともに予算目標を達成しており、非常に好調な推移を維持しています。"
    elif newer_budget_val < 100 and older_budget_val >= 100:
        budget_comment = f"古い期間（{label_older}）では予算を上回る好調な推移でしたが、新しい期間（{label_newer}）は {newer_budget_val}% に留まり、目標未達となっています。曜日要因や一時的な需要の落ち着きが影響している可能性があります。"
    elif newer_budget_val < 100 and older_budget_val < 100:
        budget_comment = "両期間ともに予算を下回る推移となっており、集客または客単価の改善に向けた対策が必要と考えられます。"
    else:
        budget_comment = "予算目標に対してはおおむね堅調に推移しています。"

    # レポートマークダウン構築開始
    output = []
    output.append(f"# 売上実績および売れ筋商品傾向の比較分析レポート")
    output.append(f"\n**対象期間対比**: {label_older} vs {label_newer}")
    output.append(f"\n本レポートは、{label_older} の売上データと、{label_newer} の売上データについて、いずれも**「売上高 日商」**を基準として売上対比および売れ筋商品の傾向差を分析したものです。売上のスケールを1日あたり（日商ベース）に統一することで、正確な比較を行っています。")
    
    # 目次 (TOC)
    output.append(f"\n---")
    output.append(f"\n## 目次")
    output.append(f"- [1. 売上実績の全体対比 (日商ベース)](#1-売上実績の全体対比-日商ベース)")
    output.append(f"- [2. 売れ筋商品ランキング比較 (Top 15)](#2-売れ筋商品ランキング比較-top-15)")
    output.append(f"- [3. 日商変動の顕著な商品分析](#3-日商変動の顕著な商品分析)")
    output.append(f"- [4. カテゴリ別の売上構成比のシフト](#4-カテゴリ別の売上構成比のシフト)")
    output.append(f"\n---")

    # 1. 全体対比セクション
    output.append(f"\n## 1. 売上実績の全体対比 (日商ベース)")
    output.append(f"\n全体の売上規模（日商）および予算比の対比は以下の通りです。")
    output.append(f"\n| 期間 | 日商（1日平均売上） | 予算比 | 当日（{label_newer}）との対比 |")
    output.append(f"| :--- | :--- | :--- | :--- |")
    output.append(f"| **{label_older}** | {older_sales_val:,.0f}円 | {older_budget_val:.1f}% | - |")
    output.append(f"| **{label_newer}** | {newer_sales_val:,.0f}円 | {newer_budget_val:.1f}% | {label_older}比 **{ratio_sales:.2f}%** ({diff_pct:+.2f}%) |")
    
    output.append(f"\n### 【分析・解説】")
    output.append(f"* **日商の変動**: {label_newer} の日商は、{label_older} と比較して **約 {abs(diff_sales):,.0f}円 ({diff_pct:+.2f}%)** {trend_word} しています。")
    output.append(f"* **予算比の動向**: {budget_comment}")

    # 2. ランキング比較セクション
    output.append(f"\n---")
    output.append(f"\n## 2. 売れ筋商品ランキング比較 (Top 15)")
    output.append(f"\n売上日商に基づく、両期間の売上上位15商品は以下の通りです。")
    
    output.append(f"\n### {label_older} の売上上位15商品")
    output.append(f"| 順位 | 商品コード | 商品名 | 日商平均 | 構成比 | ロス率 |")
    output.append(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
    top_week = df_week.sort_values(by='sales_daily', ascending=False).head(15)
    for idx, row in enumerate(top_week.itertuples(), 1):
        output.append(f"| {idx} | `{row.code}` | {row.name} | {row.sales_daily:,.0f}円 | {row.sales_ratio:.1f}% | {row.loss_total_ratio:.1f}% |")

    output.append(f"\n### {label_newer} の売上上位15商品")
    output.append(f"| 順位 | 商品コード | 商品名 | 当日日商 | 構成比 | ロス率 |")
    output.append(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
    top_day = df_day.sort_values(by='sales_daily', ascending=False).head(15)
    for idx, row in enumerate(top_day.itertuples(), 1):
        output.append(f"| {idx} | `{row.code}` | {row.name} | {row.sales_daily:,.0f}円 | {row.sales_ratio:.1f}% | {row.loss_total_ratio:.1f}% |")

    top1_older = top_week.iloc[0]['name'] if len(top_week) > 0 else "なし"
    top1_newer = top_day.iloc[0]['name'] if len(top_day) > 0 else "なし"
    ranking_comment = ""
    if top1_older == top1_newer:
        ranking_comment = f"両期間で1位となった「**{top1_older}**」は、日商がほぼ同じレベルを維持しており、平日・休日を問わない極めて強固な需要がある不動の定番商品と言えます。"
    else:
        ranking_comment = f"{label_older} の首位は「**{top1_older}**」であったのに対し、{label_newer} では「**{top1_newer}**」が首位となり、需要の変化が反映されています。"

    output.append(f"\n### 【ランキング傾向分析】")
    output.append(f"* **定番商品の安定性**: {ranking_comment}")
    output.append(f"* **即食・お惣菜の需要**: ランキング全体を見ると、お弁当やおかずセットなどの日常の食事にすぐに利用できる簡便即食フードが上位に多く連なっており、安定した需要を形成しています。")

    # 3. 顕著な増減商品分析セクション
    df_merged = pd.merge(
        df_week[['code', 'name', 'sales_daily', 'sales_ratio']],
        df_day[['code', 'sales_daily', 'sales_ratio']],
        on='code',
        how='outer',
        suffixes=('_week', '_day')
    ).fillna(0)

    # name補完
    df_merged['name'] = df_merged['name'].replace(0, '')
    df_merged = pd.merge(
        df_merged,
        df_day[['code', 'name']],
        on='code',
        how='left',
        suffixes=('', '_day_name')
    )
    df_merged['name'] = df_merged['name'].fillna('').astype(str)
    if 'name_day_name' in df_merged.columns:
        df_merged['name'] = df_merged.apply(
            lambda r: r['name'] if r['name'] != '' else r['name_day_name'], axis=1
        )
        df_merged.drop(columns=['name_day_name'], inplace=True)

    df_merged['sales_diff'] = df_merged['sales_daily_day'] - df_merged['sales_daily_week']
    df_merged['sales_growth_ratio'] = np.where(
        df_merged['sales_daily_week'] > 0,
        df_merged['sales_daily_day'] / df_merged['sales_daily_week'],
        0
    )

    output.append(f"\n---")
    output.append(f"\n## 3. 日商変動の顕著な商品分析")
    output.append(f"\n1日あたりの売上金額（日商）の増減差が大きい商品を分析します。")

    # 増加
    output.append(f"\n### 📊 日商増加額の上位15商品")
    output.append(f"| 順位 | 商品名 | {label_older}日商 | {label_newer}日商 | 日商差額 | 伸長率 |")
    output.append(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
    df_growth = df_merged[
        (df_merged['sales_daily_week'] >= 1000) | (df_merged['sales_daily_day'] >= 5000)
    ].sort_values(by='sales_diff', ascending=False)
    if len(df_growth[df_growth['sales_diff'] > 0]) < 15:
        df_growth = df_merged.sort_values(by='sales_diff', ascending=False)
    df_growth = df_growth[df_growth['sales_diff'] > 0].head(15)

    for idx, row in enumerate(df_growth.itertuples(), 1):
        output.append(f"| {idx} | {row.name} | {row.sales_daily_week:,.0f}円 | {row.sales_daily_day:,.0f}円 | **{row.sales_diff:+,.0f}円** | {row.sales_growth_ratio*100:.1f}% |")

    # 減少
    output.append(f"\n### 📉 日商減少額の上位15商品")
    output.append(f"| 順位 | 商品名 | {label_older}日商 | {label_newer}日商 | 日商差額 | 減少率 |")
    output.append(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
    df_decline = df_merged[
        (df_merged['sales_daily_week'] >= 1000) | (df_merged['sales_daily_day'] >= 5000)
    ].sort_values(by='sales_diff', ascending=True)
    if len(df_decline[df_decline['sales_diff'] < 0]) < 15:
        df_decline = df_merged.sort_values(by='sales_diff', ascending=True)
    df_decline = df_decline[df_decline['sales_diff'] < 0].head(15)


    for idx, row in enumerate(df_decline.itertuples(), 1):
        output.append(f"| {idx} | {row.name} | {row.sales_daily_week:,.0f}円 | {row.sales_daily_day:,.0f}円 | **{row.sales_diff:+,.0f}円** | {row.sales_growth_ratio*100:.1f}% |")

    growth_top1 = df_growth.iloc[0] if len(df_growth) > 0 else None
    decline_top1 = df_decline.iloc[0] if len(df_decline) > 0 else None
    growth_desc = ""
    if growth_top1 is not None:
        growth_desc = f"「**{growth_top1['name']}**」が差額 `{growth_top1['sales_diff']:+,.0f}円` と最も大きく売上を伸ばしています。お惣菜やお弁当、簡便食品などの日常食が伸びる傾向があります。"
    decline_desc = ""
    if decline_top1 is not None:
        decline_desc = f"一方で、「**{decline_top1['name']}**」が差額 `{decline_top1['sales_diff']:,.0f}円` 減少し、最も大きな落ち込みを見せています。ハレの日需要や週末ギフト用途の落ち着きによる影響が大きいです。"

    output.append(f"\n### 【主な増減要因分析】")
    output.append(f"* **日商増加要因**: {growth_desc}")
    output.append(f"* **日商減少要因**: {decline_desc}")

    # 4. カテゴリ別シフトセクション（設定ファイル連携）
    df_week, df_day = apply_categories(df_week, df_day)

    cat_week = df_week.groupby('category').agg(
        sales_daily_avg=('sales_daily', 'sum')
    )
    cat_week['ratio'] = cat_week['sales_daily_avg'] / cat_week['sales_daily_avg'].sum() * 100

    cat_day = df_day.groupby('category').agg(
        sales_daily_avg=('sales_daily', 'sum')
    )
    cat_day['ratio'] = cat_day['sales_daily_avg'] / cat_day['sales_daily_avg'].sum() * 100

    cat_compare = pd.merge(
        cat_week[['sales_daily_avg', 'ratio']],
        cat_day[['sales_daily_avg', 'ratio']],
        on='category',
        how='outer',
        suffixes=('_week', '_day')
    ).fillna(0)

    cat_compare['diff'] = cat_compare['sales_daily_avg_day'] - cat_compare['sales_daily_avg_week']
    cat_compare['ratio_diff'] = cat_compare['ratio_day'] - cat_compare['ratio_week']

    output.append(f"\n---")
    output.append(f"\n## 4. カテゴリ別の売上構成比のシフト")
    output.append(f"\nカテゴリ別の売上日商および構成比の対比は以下の通りです。")
    output.append(f"\n| カテゴリ | {label_older} 日商 | {label_older} 構成比 | {label_newer} 日商 | {label_newer} 構成比 | 差額 | 構成比差 |")
    output.append(f"| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

    # 最大の売上差額と構成比シフトカテゴリの算出
    max_diff_cat = "なし"
    max_diff_val = 0
    max_ratio_shift_cat = "なし"
    max_ratio_shift_val = 0

    for cat, row in cat_compare.iterrows():
        output.append(f"| {cat} | {row.sales_daily_avg_week:10,.0f}円 | {row.ratio_week:5.2f}% | {row.sales_daily_avg_day:10,.0f}円 | {row.ratio_day:5.2f}% | **{row['diff']:+,.0f}円** | {row.ratio_diff:+.2f}% |")
        
        if abs(row['diff']) > abs(max_diff_val):
            max_diff_val = row['diff']
            max_diff_cat = cat
        if abs(row['ratio_diff']) > abs(max_ratio_shift_val):
            max_ratio_shift_val = row['ratio_diff']
            max_ratio_shift_cat = cat

    output.append(f"\n### 【構成比シフトの要約】")
    output.append(f"* **金額変動の最大要因**: カテゴリ別で見ると、最も売上金額の変動（絶対値）が大きかったのは **「{max_diff_cat}」** で、差額は **{max_diff_val:+,.0f}円** となっています。")
    output.append(f"* **構成比シェアの最大シフト**: 売上構成比の面では、**「{max_ratio_shift_cat}」** カテゴリのシェアが **{max_ratio_shift_val:+.2f}%** と最も大きく変化し、客層のニーズ変更や販売トレンドの転換を示しています。")

    # コンソール出力 (cp932環境でのエンコードエラーを安全に回避)
    import sys
    full_output = '\n'.join(output)
    try:
        print(full_output)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or 'utf-8'
        print(full_output.encode(encoding, errors='replace').decode(encoding))

    # output_data/ へのマークダウンファイル自動出力
    def clean_label(label):
        clean = label.replace('/', '').replace(':', '').replace(' ', '_').replace('(', '_').replace(')', '')
        return clean

    newer_clean = clean_label(label_newer)
    older_clean = clean_label(label_older)
    out_filename = os.path.join("output_data", f"売上比較レポート_{newer_clean}_vs_{older_clean}.md")

    try:
        os.makedirs("output_data", exist_ok=True)
        with open(out_filename, 'w', encoding='utf-8') as out_f:
            out_f.write('\n'.join(output))
        print(f"\n[INFO] 分析レポートを保存しました: {out_filename}")
    except Exception as e:
        print(f"\n[ERROR] レポートの保存に失敗しました: {e}")
