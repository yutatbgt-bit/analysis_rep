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

        // 2. ヘッダー行の検出 (「商品名」または「コード」が含まれる行)
        for (var r = 0; r < Math.min(rows.length, 15); r++) {
            var row = rows[r] || [];
            for (var c = 0; c < row.length; c++) {
                var cell = toHalfWidth(String(row[c] || ''));
                if (cell.indexOf('商品名') !== -1 || cell.indexOf('品名') !== -1) {
                    headerRowIndex = r;
                    break;
                }
            }
            if (headerRowIndex !== -1) break;
        }

        if (headerRowIndex === -1) headerRowIndex = 6; // デフォルト6行目

        // ヘッダー列インデックスのマッピング
        var headerRow = rows[headerRowIndex] || [];
        for (var c = 0; c < headerRow.length; c++) {
            var h = toHalfWidth(String(headerRow[c] || ''));
            if (h.indexOf('コード') !== -1) colMap.code = c;
            else if (h.indexOf('品名') !== -1 || h.indexOf('商品名') !== -1) colMap.name = c;
            else if (h.indexOf('日商') !== -1 || (h.indexOf('売上') !== -1 && h.indexOf('日') !== -1)) colMap.dailySales = c;
            else if (h.indexOf('売上') !== -1 && h.indexOf('累計') !== -1) colMap.totalSales = c;
            else if (h.indexOf('構成比') !== -1) colMap.ratio = c;
            else if (h.indexOf('予算比') !== -1) colMap.budgetRatio = c;
            else if (h.indexOf('前年比') !== -1 || h.indexOf('対比') !== -1) colMap.compRatio = c;
            else if (h.indexOf('点数') !== -1 || h.indexOf('客数') !== -1) colMap.hits = c;
            else if (h.indexOf('単価') !== -1) colMap.unitPrice = c;
        }

        if (colMap.code === undefined) colMap.code = 0;
        if (colMap.name === undefined) colMap.name = 1;
        if (colMap.dailySales === undefined) colMap.dailySales = 2;
        if (colMap.totalSales === undefined) colMap.totalSales = 3;

        // 3. データ行の走査・合計行の抽出・Top商品リスト
        var items = [];
        var categoryMap = {};

        for (var r = headerRowIndex + 1; r < rows.length; r++) {
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

            if (!nameCell || nameCell === '0' || nameCell.indexOf('商品コード') !== -1) continue;

            var dailySales = parseNumeric(row[colMap.dailySales]);
            var periodSales = parseNumeric(row[colMap.totalSales]) || dailySales;
            var ratio = parseNumeric(row[colMap.ratio]);
            var compRatio = parseNumeric(row[colMap.compRatio]);
            var budgetRatio = parseNumeric(row[colMap.budgetRatio]);
            var hits = parseNumeric(row[colMap.hits]);
            var unitPrice = parseNumeric(row[colMap.unitPrice]);

            if (dailySales > 0 || periodSales > 0) {
                items.push({
                    code: firstCell,
                    name: nameCell,
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

        items.sort(function(a, b) {
            return b.dailySales - a.dailySales;
        });

        if (totalDailySales === 0 && items.length > 0) {
            var sum = 0;
            items.forEach(function(it) { sum += it.dailySales; });
            totalDailySales = sum;
        }

        // カテゴリ推定（品名からの簡易分類）
        var KNOWN_CATS = ['野菜', '果物', 'チルド', 'インストアデリカ', '牛肉', '豚肉', '鶏肉', '日配', '菓子', '洋惣菜', '和惣菜', '刺身', '寿司', '飲料', '酒', '米', '鮮魚'];
        items.forEach(function(item) {
            var matchedCat = 'その他';
            for (var i = 0; i < KNOWN_CATS.length; i++) {
                if (item.name.indexOf(KNOWN_CATS[i]) !== -1) {
                    matchedCat = KNOWN_CATS[i];
                    break;
                }
            }
            if (!categoryMap[matchedCat]) {
                categoryMap[matchedCat] = 0;
            }
            categoryMap[matchedCat] += item.dailySales;
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
            topItems: items.slice(0, 15),
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
                    var data = new Uint8Array(e.target.result);
                    var workbook = XLSX.read(data, { type: 'array' });

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
