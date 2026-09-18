/**
 * 売上データ解析パーサーモジュール (parser.js)
 * 単品別売上実績CSV/Excel および 日別集計表に対応
 */
(function(global) {
    'use strict';

    /**
     * 全角英数字を半角に変換
     */
    function toHalfWidth(str) {
        if (!str || typeof str !== 'string') return '';
        return str.replace(/[！-～]/g, function(s) {
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

    /**
     * 単品別売上実績CSV/Excelの構造を解析
     * @param {Array<Array<any>>} rows 2次元配列
     * @param {string} fileName ファイル名
     */
    function parseItemizedReport(rows, fileName) {
        var periodStr = '';
        var totalDailySales = 0;
        var totalPeriodSales = 0;
        var headerRowIndex = -1;
        var colMap = {};

        // 1. 期間メタデータの探索 (行1〜行6)
        for (var r = 0; r < Math.min(rows.length, 6); r++) {
            var rowStr = (rows[r] || []).join(' ');
            var matchPeriod = rowStr.match(/(\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}[日]?(\([^)]+\))?)\s*[～~ー-]\s*(\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}[日]?(\([^)]+\))?)/);
            if (matchPeriod) {
                periodStr = matchPeriod[0];
                break;
            }
            var matchSingle = rowStr.match(/対象期間[：:\s]*(\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}[日]?(\([^)]+\))?)/);
            if (matchSingle) {
                periodStr = matchSingle[1];
                break;
            }
        }
        if (!periodStr) {
            var matchFileDate = fileName.match(/(\d{4})(\d{2})(\d{2})/);
            if (matchFileDate) {
                periodStr = matchFileDate[1] + '年' + matchFileDate[2] + '月' + matchFileDate[3] + '日';
            } else {
                periodStr = '期間未定';
            }
        }

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
            if (subJoined.indexOf('日商') !== -1 || subJoined.indexOf('比較日比') !== -1 || subJoined.indexOf('構成比') !== -1) {
                isSubHeader = true;
            }
        }

        var maxCols = Math.max(rowMain.length, rowSub.length);
        for (var c = 0; c < maxCols; c++) {
            var hMain = toHalfWidth(String(rowMain[c] || '')).replace(/\s+/g, '');
            var hSub  = isSubHeader ? toHalfWidth(String(rowSub[c] || '')).replace(/\s+/g, '') : '';
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
            // 売上日商
            else if (hCombined.indexOf('日商') !== -1 || (hCombined.indexOf('売上') !== -1 && hCombined.indexOf('日') !== -1)) {
                if (colMap.dailySales === undefined || hCombined.indexOf('売上') !== -1) {
                    colMap.dailySales = c;
                }
            }
            // 売上累計 / 売上高実績
            else if (hCombined.indexOf('売上') !== -1 && (hCombined.indexOf('累計') !== -1 || hCombined.indexOf('実績') !== -1)) {
                colMap.totalSales = c;
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
        if (colMap.dailySales === undefined) colMap.dailySales = 2;
        if (colMap.totalSales === undefined) colMap.totalSales = 3;
        if (colMap.ratio === undefined) colMap.ratio = 4;
        if (colMap.budgetRatio === undefined) colMap.budgetRatio = 5;
        if (colMap.compRatio === undefined) colMap.compRatio = 6;

        var startDataRow = isSubHeader ? (headerRowIndex + 2) : (headerRowIndex + 1);

        // 3. データ行の走査・合計行の抽出・Top商品リスト
        var items = [];
        var categoryMap = {};

        for (var r = startDataRow; r < rows.length; r++) {
            var row = rows[r];
            if (!row || row.length === 0) continue;

            var firstCell = toHalfWidth(String(row[colMap.code] || ''));
            var nameCell = toHalfWidth(String(row[colMap.name] || ''));

            // 合計行の検出
            if (firstCell.indexOf('合計') !== -1 || nameCell.indexOf('合計') !== -1) {
                totalDailySales = parseNumeric(row[colMap.dailySales]);
                totalPeriodSales = parseNumeric(row[colMap.totalSales]) || totalDailySales;
                continue;
            }

            if (!nameCell || nameCell === '0' || nameCell.indexOf('商品コード') !== -1 || nameCell.indexOf('品名') !== -1) continue;

            var dailySales = parseNumeric(row[colMap.dailySales]);
            var periodSales = parseNumeric(row[colMap.totalSales]) || dailySales;
            // POS CSVで列3が売上高の場合の補完
            if (dailySales === 0 && periodSales > 0 && colMap.dailySales === 2) {
                dailySales = periodSales;
            }

            var ratio = parseRatio(row[colMap.ratio]);
            var compRatio = parseRatio(row[colMap.compRatio]);
            var budgetRatio = parseRatio(row[colMap.budgetRatio]);
            var hits = parseNumeric(row[colMap.hits]);
            var unitPrice = parseNumeric(row[colMap.unitPrice]);

            var catFromCol = colMap.category !== undefined ? toHalfWidth(String(row[colMap.category] || '')) : '';
            var resolvedCategory = catFromCol || getProductCategory(nameCell, firstCell);

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

        if (totalDailySales === 0 && items.length > 0) {
            var sum = 0;
            items.forEach(function(it) { sum += it.dailySales; });
            totalDailySales = sum;
        }

        // 構成比の自動算出補完（CSV内に構成比がなかった場合のケア）
        if (totalDailySales > 0) {
            items.forEach(function(it) {
                if (it.ratio === null || it.ratio === undefined || isNaN(it.ratio)) {
                    it.ratio = parseFloat((it.dailySales / totalDailySales * 100).toFixed(2));
                }
            });
        }

        // カテゴリ別集計（config.md.xlsx 完全準拠）
        items.forEach(function(item) {
            var cat = item.category || 'その他';
            if (!categoryMap[cat]) {
                categoryMap[cat] = 0;
            }
            categoryMap[cat] += item.dailySales;
        });

        var categories = [];
        for (var catName in categoryMap) {
            categories.push({
                name: catName,
                sales: categoryMap[catName],
                ratio: totalDailySales > 0 ? (categoryMap[catName] / totalDailySales * 100) : 0
            });
        }
        categories.sort(function(a, b) { return b.sales - a.sales; });

        items.sort(function(a, b) {
            return b.dailySales - a.dailySales;
        });

        if (totalDailySales === 0 && items.length > 0) {
            var sum = 0;
            items.forEach(function(it) { sum += it.dailySales; });
            totalDailySales = sum;
        }

        // カテゴリ別集計
        items.forEach(function(item) {
            var cat = item.category || 'その他';
            if (!categoryMap[cat]) {
                categoryMap[cat] = 0;
            }
            categoryMap[cat] += item.dailySales;
        });

        var categories = [];
        for (var catName in categoryMap) {
            categories.push({
                name: catName,
                sales: categoryMap[catName],
                ratio: totalDailySales > 0 ? (categoryMap[catName] / totalDailySales * 100) : 0
            });
        }
        categories.sort(function(a, b) { return b.sales - a.sales; });

        return {
            fileName: fileName,
            periodStr: periodStr,
            totalDailySales: totalDailySales,
            totalPeriodSales: totalPeriodSales,
            itemCount: items.length,
                        topItems: items.slice(0, 50),
            allItems: items,
            categories: categories
        };
    }

    /**
     * アップロードされたファイルを非同期に解析
     * @param {File} file
     * @returns {Promise<Object>}
     */
    function parseSalesFile(file) {
        return new Promise(function(resolve, reject) {
            if (!file) {
                return reject(new Error('ファイルが指定されていません。'));
            }

            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var buffer = e.target.result;
                    var data = new Uint8Array(buffer);
                    var workbook;

                    var isCSV = file.name.toLowerCase().endsWith('.csv');
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
                            workbook = XLSX.read(utf8Str, { type: 'string' });
                        } else {
                            try {
                                var sjisDecoder = new TextDecoder('shift-jis');
                                var sjisStr = sjisDecoder.decode(data);
                                workbook = XLSX.read(sjisStr, { type: 'string' });
                            } catch (e2) {
                                workbook = XLSX.read(data, { type: 'array', codepage: 932 });
                            }
                        }
                    } else {
                        workbook = XLSX.read(data, { type: 'array' });
                    }

                    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                        return reject(new Error('有効なシートが存在しません。'));
                    }

                    var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                    if (!rows || rows.length === 0) {
                        return reject(new Error('データが空です。'));
                    }

                    var parsedResult = parseItemizedReport(rows, file.name);
                    resolve(parsedResult);
                } catch (err) {
                    reject(new Error('ファイル解析エラー: ' + err.message));
                }
            };

            reader.onerror = function(err) {
                reject(new Error('ファイル読み込みに失敗しました。'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    global.SalesParser = {
        parseSalesFile: parseSalesFile
    };

})(window);
