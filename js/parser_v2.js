/**
 * 売上データ解析パーサーモジュール (parser.js)
 * 単品別売上実績CSV/Excel および 日別集計表に対応
 */
(function (global) {
    'use strict';

    /**
     * 全角英数字を半角に変換
     */
    function toHalfWidth(str) {
        if (!str || typeof str !== 'string') return '';
        return str.replace(/[！-～]/g, function (s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        }).replace(/　/g, ' ').trim();
    }

    /**
     * 数値文字列のクリーニング（カンマ、円記号、パーセント等の除去）
     */
    function parseNumeric(val) {
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        if (!val) return 0;
        var s = String(val).replace(/[¥,％%\s]/g, '').trim();
        var num = parseFloat(s);
        return isNaN(num) ? 0 : num;
    }

    /**
     * 比率・パーセント値のクリーニングと正規化（小数表記 1.125 -> 112.5% のケア）
     */
    function parseRatio(val) {
        if (val === undefined || val === null || val === '') return null;
        var str = String(val).trim();
        if (!str || str === '-') return null;
        var hasPercent = str.indexOf('%') !== -1 || str.indexOf('％') !== -1;
        var num = parseNumeric(str);
        if (isNaN(num)) return null;
        if (hasPercent) return num;
        // 小数表記（例: 0.042 -> 4.2%, 1.125 -> 112.5%）の自動変換
        if (num > 0 && num <= 2.5) {
            return parseFloat((num * 100).toFixed(2));
        }
        return num;
    }

    /**
     * 商品のカテゴリー分類（設定ファイル config.md.xlsx 完全準拠）
     * category_map.js の classifyProduct を使用
     */
    function getProductCategory(name, code) {
        if (typeof window !== 'undefined' && typeof window.classifyProduct === 'function') {
            return window.classifyProduct(name, code);
        }
        return 'その他';
    }

    var DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];

    function formatDateWithDow(y, m, d) {
        var year = Number(y);
        var month = Number(m);
        var day = Number(d);
        if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            var dt = new Date(year, month - 1, day);
            var dow = !isNaN(dt.getTime()) ? '(' + DAYS_JP[dt.getDay()] + ')' : '';
            return year + '/' + String(month).padStart(2, '0') + '/' + String(day).padStart(2, '0') + dow;
        }
        return '';
    }

    function normalizeDateToken(raw) {
        if (raw === null || raw === undefined || raw === '') return '';
        if (typeof raw === 'number' && raw > 25000 && raw < 70000) {
            var utcDays = Math.floor(raw - 25569);
            var dt = new Date(utcDays * 86400 * 1000);
            return formatDateWithDow(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        }
        var s = toHalfWidth(String(raw));
        var mYmd = s.match(/(20\d{2})[年\/\-.]\s*(\d{1,2})[月\/\-.]\s*(\d{1,2})日?(?:\(([日月火水木金土])\))?/);
        if (mYmd) {
            if (mYmd[4]) {
                return mYmd[1] + '/' + String(mYmd[2]).padStart(2, '0') + '/' + String(mYmd[3]).padStart(2, '0') + '(' + mYmd[4] + ')';
            }
            return formatDateWithDow(mYmd[1], mYmd[2], mYmd[3]);
        }
        return s;
    }

    function isGenericSheetName(name) {
        if (!name || typeof name !== 'string') return true;
        var clean = name.trim();
        return /^(?:sheet\s*\d*|シート\s*\d*|page\s*\d*|table\s*\d*|ワークシート\d*|売上.*|データ.*)$/i.test(clean);
    }

    function normalizeStoreLabel(raw) {
        if (!raw || typeof raw !== 'string') return '';
        var s = toHalfWidth(raw.slice(0, 120)).replace(/[\u0000-\u001F\u007F]/g, '').trim();
        if (!s) return '';
        if (/(?:全店舗|全店|全社|全体|全店計|全店合計|^all$)/i.test(s)) {
            return '全店舗';
        }
        s = s.replace(/^\d{1,4}[\s:：_\-]*/, '').trim().slice(0, 30);
        return s;
    }

    /**
     * 行データ・シート名・ファイル名から対象期間と店舗名を抽出
     * @param {Array<Array<any>>} rows
     * @param {string} fileName
     * @param {string} [sheetName]
     * @returns {{ periodStr: string, storeName: string }}
     */
    function extractMetaFromRowsAndName(rows, fileName, sheetName) {
        var periodStr = '';
        var storeName = '';
        var startDate = '';
        var endDate = '';

        if (Array.isArray(rows)) {
            var scanLimit = Math.min(rows.length, 8);
            for (var r = 0; r < scanLimit; r++) {
                var row = rows[r] || [];
                var maxCols = Math.min(row.length, 30);
                var rowStr = row.slice(0, maxCols).join(' ').slice(0, 500);

                for (var c = 0; c < maxCols; c++) {
                    var cellVal = row[c];
                    if (cellVal === null || cellVal === undefined || cellVal === '') continue;
                    var cellStr = toHalfWidth(String(cellVal).slice(0, 300)).replace(/[\u0000-\u001F\u007F]/g, '');
                    if (!cellStr) continue;

                    if (cellStr.indexOf('対象期間開始日') !== -1) {
                        var partsStart = cellStr.split(/[：:]/);
                        var candStart = (partsStart[1] && partsStart[1].trim()) ? partsStart[1].trim() : (row[c + 1] !== undefined ? row[c + 1] : '');
                        var normStart = normalizeDateToken(candStart);
                        if (normStart) startDate = normStart;
                        continue;
                    }
                    if (cellStr.indexOf('対象期間終了日') !== -1) {
                        var partsEnd = cellStr.split(/[：:]/);
                        var candEnd = (partsEnd[1] && partsEnd[1].trim()) ? partsEnd[1].trim() : (row[c + 1] !== undefined ? row[c + 1] : '');
                        var normEnd = normalizeDateToken(candEnd);
                        if (normEnd) endDate = normEnd;
                        continue;
                    }

                    if (!storeName) {
                        var keyPart = cellStr.split(/[：:]/)[0].trim();
                        if (/^(?:店舗名|店名|対象店舗|検索店舗|店舗)$/.test(keyPart)) {
                            var partsStore = cellStr.split(/[：:]/);
                            var candStore = (partsStore[1] && partsStore[1].trim()) ? partsStore[1].trim() : (row[c + 1] !== undefined ? toHalfWidth(String(row[c + 1])) : '');
                            if (candStore && !/^(?:対象期間|年月日|日付|商品)/.test(candStore)) {
                                storeName = normalizeStoreLabel(candStore);
                            }
                        } else if (r < 4 && /^(?:全店舗|全店|全店計|全店合計|\d{2,4}[\s:：_\-]*[^\d\s]{1,10}店)$/.test(cellStr)) {
                            storeName = normalizeStoreLabel(cellStr);
                        }
                    }
                }

                if (!periodStr) {
                    var matchPeriod = rowStr.match(/(\d{4}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}[日]?(?:\([^)]+\))?)\s*[～~〜ー\-－]\s*(\d{4}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}[日]?(?:\([^)]+\))?)/);
                    if (matchPeriod) {
                        var s1 = normalizeDateToken(matchPeriod[1]);
                        var s2 = normalizeDateToken(matchPeriod[2]);
                        periodStr = (s1 === s2) ? s1 : (s1 + '〜' + s2);
                    } else {
                        var matchSingle = rowStr.match(/(?:対象期間|表示期間|集計期間|年月日|営業日|日付)[：:\s]*(\d{4}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}[日]?(?:\([^)]+\))?)/);
                        if (matchSingle) {
                            periodStr = normalizeDateToken(matchSingle[1]);
                        }
                    }
                }
            }
        }

        if (!periodStr && (startDate || endDate)) {
            if (startDate && endDate) {
                periodStr = (startDate === endDate) ? startDate : (startDate + '〜' + endDate);
            } else {
                periodStr = startDate || endDate;
            }
        }

        var cleanFn = toHalfWidth(String(fileName || '').replace(/\.[^.]+$/, ''));
        if (!periodStr && cleanFn) {
            var mFnRange = cleanFn.match(/(20\d{2})[年\/\-._]?([01]\d)[月\/\-._]?([0-3]\d)日?\s*[~〜～\-_]\s*(?:(20\d{2})[年\/\-._]?)?([01]\d)[月\/\-._]?([0-3]\d)日?/);
            if (mFnRange) {
                var f1 = formatDateWithDow(mFnRange[1], mFnRange[2], mFnRange[3]);
                var f2 = formatDateWithDow(mFnRange[4] || mFnRange[1], mFnRange[5], mFnRange[6]);
                if (f1 && f2) periodStr = (f1 === f2) ? f1 : (f1 + '〜' + f2);
            }
            if (!periodStr) {
                var matchFileYmd = cleanFn.match(/(20\d{2})[年\/\-._\s]([01]?\d)[月\/\-._\s]([0-3]?\d)日?/) ||
                    cleanFn.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
                if (matchFileYmd) {
                    periodStr = formatDateWithDow(matchFileYmd[1], matchFileYmd[2], matchFileYmd[3]);
                }
            }
            if (!periodStr) {
                var matchFileYm = cleanFn.match(/(20\d{2})[年\/\-._\s]?([01]?\d)月?/);
                if (matchFileYm && Number(matchFileYm[2]) >= 1 && Number(matchFileYm[2]) <= 12) {
                    periodStr = matchFileYm[1] + '年' + Number(matchFileYm[2]) + '月';
                }
            }
        }

        if (!storeName && sheetName && !isGenericSheetName(sheetName)) {
            storeName = normalizeStoreLabel(sheetName);
        }

        if (!storeName && cleanFn) {
            if (/(?:全店舗|全店|全社|全体)/.test(cleanFn)) {
                storeName = '全店舗';
            } else {
                var mStore = cleanFn.match(/(?:\d{2,4}[_\-\s]*)?([^\d_\-\s()（）.]{1,12}店)/);
                if (mStore) {
                    storeName = normalizeStoreLabel(mStore[1]);
                }
            }
        }

        if (!periodStr) {
            periodStr = '期間未特定';
        }
        if (!storeName) {
            storeName = '全店舗';
        }

        return {
            periodStr: periodStr,
            storeName: storeName
        };
    }

    /**
     * 単品別売上実績CSV/Excelの構造を解析
     * @param {Array<Array<any>>} rows 2次元配列
     * @param {string} fileName ファイル名
     * @param {string} [sheetName] シート名
     */
    function parseItemizedReport(rows, fileName, sheetName) {
        var meta = extractMetaFromRowsAndName(rows, fileName, sheetName);
        var periodStr = meta.periodStr;
        var storeName = meta.storeName;
        var totalDailySales = 0;
        var totalPeriodSales = 0;
        var headerRowIndex = -1;
        var colMap = {};

        // 2. ヘッダー行の検出 (「商品名」「コード」を含む行の探索)
        for (var r = 0; r < Math.min(rows.length, 15); r++) {
            var row = rows[r] || [];
            for (var c = 0; c < row.length; c++) {
                var cell = toHalfWidth(String(row[c] || ''));
                if (cell.indexOf('商品名') !== -1 || cell.indexOf('品名') !== -1 || cell.indexOf('商品コード') !== -1) {
                    headerRowIndex = r;
                    break;
                }
            }
            if (headerRowIndex !== -1) break;
        }

        if (headerRowIndex === -1) headerRowIndex = 6; // デフォルト6行目

        // 複合ヘッダー（2段組見出し）の考慮
        var rowMain = rows[headerRowIndex] || [];
        var rowSub = (headerRowIndex + 1 < rows.length) ? rows[headerRowIndex + 1] : [];
        var isSubHeader = false;
        if (rowSub.length > 0) {
            var subJoined = rowSub.join(' ');
            if (subJoined.indexOf('実績') !== -1 || subJoined.indexOf('比較日比') !== -1 || subJoined.indexOf('構成比') !== -1) {
                isSubHeader = true;
            }
        }

        var maxCols = Math.max(rowMain.length, rowSub.length);
        for (var c = 0; c < maxCols; c++) {
            var hMain = toHalfWidth(String(rowMain[c] || '')).replace(/\s+/g, '');
            var hSub = isSubHeader ? toHalfWidth(String(rowSub[c] || '')).replace(/\s+/g, '') : '';
            var hCombined = hMain + '_' + hSub;

            // 商品コード
            if (hMain.indexOf('コード') !== -1 || hSub.indexOf('コード') !== -1 || hMain.indexOf('品番') !== -1) {
                colMap.code = c;
            }
            // 商品名
            else if (hMain.indexOf('品名') !== -1 || hMain.indexOf('商品名') !== -1 || hSub.indexOf('品名') !== -1) {
                colMap.name = c;
            }
            // 部門・カテゴリー
            else if (hMain.indexOf('部門') !== -1 || hMain.indexOf('カテゴリ') !== -1 || hMain.indexOf('大分類') !== -1 || hMain.indexOf('分類') !== -1) {
                colMap.category = c;
            }
            // 比較日比 / 前年比 / 対比（売上高の比較日比を最優先）
            else if (hCombined.indexOf('比較日比') !== -1 || hSub.indexOf('比較日比') !== -1 || hMain.indexOf('比較日比') !== -1 || hCombined.indexOf('比較日') !== -1) {
                if (colMap.compRatio === undefined || hCombined.indexOf('売上') !== -1) {
                    colMap.compRatio = c;
                }
            }
            else if ((hCombined.indexOf('売上') !== -1 && (hCombined.indexOf('前年比') !== -1 || hCombined.indexOf('対比') !== -1)) ||
                (colMap.compRatio === undefined && (hCombined.indexOf('前年比') !== -1 || hCombined.indexOf('対比') !== -1))) {
                colMap.compRatio = c;
            }

            // 構成比
            else if (hCombined.indexOf('構成比') !== -1 || hCombined.indexOf('売上比') !== -1) {
                if (colMap.ratio === undefined || hCombined.indexOf('売上') !== -1) {
                    colMap.ratio = c;
                }
            }
            // 予算比
            else if (hCombined.indexOf('予算比') !== -1) {
                colMap.budgetRatio = c;
            }
            // 点数・客数
            else if (hCombined.indexOf('点数') !== -1 || hCombined.indexOf('客数') !== -1 || hCombined.indexOf('打数') !== -1) {
                colMap.hits = c;
            }
            // 単価
            else if (hCombined.indexOf('単価') !== -1) {
                colMap.unitPrice = c;
            }
        }

        // デフォルト列インデックス（POS標準帳票・d3968cd_analyzer.py 準拠）
        if (colMap.code === undefined) colMap.code = 0;
        if (colMap.name === undefined) colMap.name = 1;
        if (colMap.dailySales === undefined) colMap.dailySales = 3;
        if (colMap.totalSales === undefined) colMap.totalSales = 3;
        if (colMap.ratio === undefined) colMap.ratio = 4;
        if (colMap.budgetRatio === undefined) colMap.budgetRatio = 5;
        if (colMap.compRatio === undefined) colMap.compRatio = 6;

        var startDataRow = isSubHeader ? (headerRowIndex + 2) : (headerRowIndex + 1);

        // ユーザー指定により、D8セル（実績合計）を強制取得する
        if (rows.length > 7 && rows[7]) {
            if (rows[7].length > 3) {
                var d8Value = parseNumeric(rows[7][3]);
                if (d8Value > 0) {
                    totalPeriodSales = d8Value;
                    totalDailySales = d8Value;
                }
            }
        }

        // 3. データ行の走査・合計行の抽出・Top商品リスト
        var items = [];
        var categoryMap = Object.create(null);

        for (var r = startDataRow; r < rows.length; r++) {
            var row = rows[r];
            if (!row || row.length === 0) continue;

            var firstCell = toHalfWidth(String(row[colMap.code] || '')).trim();
            var nameCell = toHalfWidth(String(row[colMap.name] || '')).trim();

            // 合計行の検出
            if (firstCell.indexOf('合計') !== -1 || nameCell.indexOf('合計') !== -1) {
                if (!totalDailySales) totalDailySales = parseNumeric(row[colMap.dailySales]);
                if (!totalPeriodSales) totalPeriodSales = parseNumeric(row[colMap.totalSales]) || totalDailySales;
                continue;
            }

            // 不要行をスキップ（商品コードが空でも、商品名がある行は救済する）
            if (firstCell.indexOf('対象') !== -1 || !nameCell || nameCell === '0' || nameCell.indexOf('商品コード') !== -1 || nameCell.indexOf('品名') !== -1 || nameCell.indexOf('小計') !== -1) continue;

            var dailySales = parseNumeric(row[colMap.dailySales]);
            var periodSales = parseNumeric(row[colMap.totalSales]) || dailySales;
            // POS CSVで列3が売上高の場合の補完
            if (dailySales === 0 && periodSales > 0 && (colMap.dailySales === 3 || colMap.dailySales === 2)) {
                dailySales = periodSales;
            }

            var ratio = parseRatio(row[colMap.ratio]);
            var compRatio = parseRatio(row[colMap.compRatio]);
            var budgetRatio = parseRatio(row[colMap.budgetRatio]);
            var hits = parseNumeric(row[colMap.hits]);
            var unitPrice = parseNumeric(row[colMap.unitPrice]);

            var rawName = String(row[colMap.name] || '').trim();
            var rawCode = String(row[colMap.code] || '').trim();

            // 売上ダッシュボードの仕様に合わせ、CSVのカテゴリ列を無視してマスタ分類を強制する
            var resolvedCategory = getProductCategory(rawName, rawCode);

            if (dailySales > 0 || periodSales > 0) {
                items.push({
                    code: firstCell,
                    name: nameCell,
                    category: resolvedCategory,
                    dailySales: dailySales,
                    periodSales: periodSales,
                    ratio: ratio,
                    compRatio: compRatio,
                    budgetRatio: budgetRatio,
                    hits: hits,
                    unitPrice: unitPrice
                });
            }
        }

        // 全単品の合計実績を算出（構成比算出の確実な分母とする）
        var sumItemDailySales = 0;
        items.forEach(function (it) { sumItemDailySales += it.dailySales; });

        if (totalDailySales === 0 && items.length > 0) {
            totalDailySales = sumItemDailySales;
        }

        // 単品の構成比補完（総合計行の金額を優先して分母とする）
        var itemDenominator = totalDailySales > 0 ? totalDailySales : sumItemDailySales;
        if (itemDenominator > 0) {
            items.forEach(function (it) {
                if (it.ratio === null || it.ratio === undefined || isNaN(it.ratio)) {
                    it.ratio = parseFloat((it.dailySales / itemDenominator * 100).toFixed(2));
                }
            });
        }

        // カテゴリ別集計（実績は表示用、期間売上はダッシュボード互換の構成比計算用）
        var categoryPeriodMap = Object.create(null);
        items.forEach(function (item) {
            var cat = item.category || 'その他';
            if (!categoryMap[cat]) {
                categoryMap[cat] = 0;
                categoryPeriodMap[cat] = 0;
            }
            categoryMap[cat] += item.dailySales;
            categoryPeriodMap[cat] += item.periodSales;
        });

        // カテゴリ構成比の算出（総合計行の期間売上を優先して分母とする）
        var sumItemPeriodSales = 0;
        items.forEach(function (it) { sumItemPeriodSales += it.periodSales; });
        var catPeriodDenominator = totalPeriodSales > 0 ? totalPeriodSales : sumItemPeriodSales;

        var categories = [];
        for (var catName in categoryMap) {
            categories.push({
                name: catName,
                sales: categoryMap[catName],
                ratio: catPeriodDenominator > 0 ? (categoryPeriodMap[catName] / catPeriodDenominator * 100) : 0
            });
        }
        categories.sort(function (a, b) { return b.sales - a.sales; });

        items.sort(function (a, b) {
            return b.dailySales - a.dailySales;
        });

        return {
            fileName: fileName,
            periodStr: periodStr,
            storeName: storeName,
            totalDailySales: totalDailySales,
            totalPeriodSales: totalPeriodSales,
            itemCount: items.length,
            topItems: items.slice(0, 50),
            allItems: items,
            categories: categories
        };
    }

    /**
     * アップロードされたファイルを非同期に解析（CSVおよびExcelに対応、Excelは値のみ読み込み）
     * @param {File} file
     * @returns {Promise<Object>}
     */
    function parseSalesFile(file) {
        return new Promise(function (resolve, reject) {
            if (!file) {
                return reject(new Error('ファイルが指定されていません。'));
            }

            var fileName = file.name || '';
            var ext = fileName.slice((fileName.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
            var validExtensions = ['csv', 'xlsx', 'xls', 'xlsm', 'xlsb'];
            if (validExtensions.indexOf(ext) === -1) {
                return reject(new Error('サポートされていないファイル形式です。CSVまたはExcelファイル（.xlsx, .xls等）を指定してください。'));
            }

            // 巨大ファイル（例: 50MB超）のメモリ枯渇防止
            var MAX_FILE_SIZE = 50 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                return reject(new Error('ファイルサイズが上限（50MB）を超えています。'));
            }

            var reader = new FileReader();
            reader.onload = function (e) {
                try {
                    var buffer = e.target.result;
                    var data = new Uint8Array(buffer);
                    var workbook;

                    var isCSV = (ext === 'csv');
                    if (isCSV) {
                        var isUtf8 = true;
                        try {
                            var utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                            utf8Decoder.decode(data);
                            isUtf8 = true;
                        } catch (err) {
                            isUtf8 = false;
                        }

                        if (isUtf8) {
                            var utf8Str = new TextDecoder('utf-8').decode(data);
                            workbook = XLSX.read(utf8Str, { type: 'string', raw: true });
                        } else {
                            try {
                                var sjisDecoder = new TextDecoder('shift-jis');
                                var sjisStr = sjisDecoder.decode(data);
                                workbook = XLSX.read(sjisStr, { type: 'string', raw: true });
                            } catch (e2) {
                                workbook = XLSX.read(data, { type: 'array', codepage: 932, raw: true });
                            }
                        }
                    } else {
                        // Excel読み込み時: 計算式やHTML装飾を排除し、評価済みの「値のみ」を取得
                        workbook = XLSX.read(data, {
                            type: 'array',
                            cellFormula: false, // 計算式(.f)は読み込まず破棄
                            cellHTML: false,    // HTML装飾は除外
                            cellText: false,    // 書式化文字列ではなく生値
                            cellStyles: false,  // スタイル除外
                            raw: true           // 生の値のみ保持
                        });
                    }

                    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                        return reject(new Error('有効なシートが存在しません。'));
                    }

                    var firstSheetName = workbook.SheetNames[0];
                    var firstSheet = workbook.Sheets[firstSheetName];

                    // 防御策: セルオブジェクト内に数式(.f)が残存している場合は完全に消去し「値のみ」にする
                    if (firstSheet && !isCSV) {
                        for (var cellKey in firstSheet) {
                            if (cellKey.charCodeAt(0) === 33) continue; // '!' で始まるメタデータ(!ref等)はスキップ
                            var cell = firstSheet[cellKey];
                            if (cell && typeof cell === 'object' && 'f' in cell) {
                                delete cell.f; // 数式フィールドを削除
                            }
                        }
                    }

                    // raw: true を指定してフォーマット文字列ではなく生の値（値のみ）を抽出
                    var rows = XLSX.utils.sheet_to_json(firstSheet, {
                        header: 1,
                        defval: '',
                        raw: true
                    });

                    if (!rows || rows.length === 0) {
                        return reject(new Error('データが空です。'));
                    }

                    var parsedResult = parseItemizedReport(rows, fileName, isCSV ? '' : firstSheetName);
                    resolve(parsedResult);
                } catch (err) {
                    reject(new Error('ファイル解析エラー: ' + err.message));
                }
            };

            reader.onerror = function () {
                reject(new Error('ファイル読み込みに失敗しました。'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    global.SalesParser = {
        parseSalesFile: parseSalesFile,
        extractMeta: extractMetaFromRowsAndName
    };

})(window);
