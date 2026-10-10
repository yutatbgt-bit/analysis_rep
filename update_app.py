import os

path = r'C:\Users\ht006\Documents\project\analysis_rep\js\app.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start_idx = content.find('var risingBody  = document.getElementById(\'tbody-rising\');')
end_idx = content.find('// 3. 単品ランキングテーブル Best50')

if start_idx == -1 or end_idx == -1:
    print('Block not found!')
else:
    old_block = content[start_idx:end_idx]
    
    new_block = '''var risingBody  = document.getElementById('tbody-rising');
    var fallingBody = document.getElementById('tbody-falling');
    if (uploadedBaseData && uploadedCompareData &&
        uploadedBaseData.topItems && uploadedCompareData.topItems) {
        var baseItemMap = {};
        uploadedBaseData.topItems.forEach(function(it) { baseItemMap[it.name] = it.dailySales; });
        var diffs = [];
        uploadedCompareData.topItems.forEach(function(it) {
            var bSales = baseItemMap[it.name] || 0;
            diffs.push({ name: it.name, code: it.code, bSales: bSales, cSales: it.dailySales, diff: it.dailySales - bSales });
        });
        uploadedBaseData.topItems.forEach(function(it) {
            var found = diffs.some(function(d) { return d.name === it.name; });
            if (!found) diffs.push({ name: it.name, code: it.code, bSales: it.dailySales, cSales: 0, diff: -it.dailySales });
        });
        window.risingItems = diffs.filter(function(d) { return d.diff > 0; }).sort(function(a,b){return b.diff-a.diff;}).slice(0,50);
        window.fallingItems = diffs.filter(function(d) { return d.diff < 0; }).sort(function(a,b){return a.diff-b.diff;}).slice(0,50);

        if (typeof window.renderRankTableRising === 'function') window.renderRankTableRising(1);
        if (typeof window.renderRankTableFalling === 'function') window.renderRankTableFalling(1);
    }

    '''
    
    content = content.replace(old_block, new_block)
    
    anchor = '// 比較基準テーブル (9列: 順位/商品名/商品コード/実績/構成比/比較順位/順位変動/実績差分/前年比)'
    functions = '''window.renderRankTableRising = function(page) {
        var risingBody = document.getElementById('tbody-rising');
        var paginationDiv = document.getElementById('pagination-rising');
        if (!risingBody) return;
        var items = window.risingItems || [];
        if (items.length === 0) {
            risingBody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;\">データが読み込まれていません</td></tr>';
            if (paginationDiv) paginationDiv.innerHTML = '';
            return;
        }

        var totalPages = Math.ceil(items.length / window.rankItemsPerPage);
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;
        window.currentRankPageRising = page;

        var startIdx = (page - 1) * window.rankItemsPerPage;
        var endIdx = startIdx + window.rankItemsPerPage;
        var pageItems = items.slice(startIdx, endIdx);

        risingBody.innerHTML = pageItems.map(function(d, i) {
            var idx = startIdx + i;
            var growthStr = d.bSales > 0 ? formatCompRatio(d.cSales / d.bSales * 100) : '-';
            return '<tr>' +
                '<td style=\"text-align:center;\">' + (idx + 1) + '</td>' +
                '<td style=\"font-weight:500;\">' + escHtml(d.name) + '</td>' +
                '<td class=\"text-right\">' + formatYen(d.bSales) + '</td>' +
                '<td class=\"text-right\">' + formatYen(d.cSales) + '</td>' +
                '<td class=\"text-right\" style=\"white-space:nowrap;\">' + formatDiffYen(d.diff) + '</td>' +
                '<td class=\"text-right\">' + growthStr + '</td>' +
                '</tr>';
        }).join('');

        if (paginationDiv) {
            renderPagination(totalPages, page, 'pagination-rising', 'window.renderRankTableRising');
        }
    };

    window.renderRankTableFalling = function(page) {
        var fallingBody = document.getElementById('tbody-falling');
        var paginationDiv = document.getElementById('pagination-falling');
        if (!fallingBody) return;
        var items = window.fallingItems || [];
        if (items.length === 0) {
            fallingBody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;\">データが読み込まれていません</td></tr>';
            if (paginationDiv) paginationDiv.innerHTML = '';
            return;
        }

        var totalPages = Math.ceil(items.length / window.rankItemsPerPage);
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;
        window.currentRankPageFalling = page;

        var startIdx = (page - 1) * window.rankItemsPerPage;
        var endIdx = startIdx + window.rankItemsPerPage;
        var pageItems = items.slice(startIdx, endIdx);

        fallingBody.innerHTML = pageItems.map(function(d, i) {
            var idx = startIdx + i;
            var remainStr = d.bSales > 0 ? formatCompRatio(d.cSales / d.bSales * 100) : '-';
            return '<tr>' +
                '<td style=\"text-align:center;\">' + (idx + 1) + '</td>' +
                '<td style=\"font-weight:500;\">' + escHtml(d.name) + '</td>' +
                '<td class=\"text-right\">' + formatYen(d.bSales) + '</td>' +
                '<td class=\"text-right\">' + formatYen(d.cSales) + '</td>' +
                '<td class=\"text-right\" style=\"white-space:nowrap;\">' + formatDiffYen(d.diff) + '</td>' +
                '<td class=\"text-right\">' + remainStr + '</td>' +
                '</tr>';
        }).join('');

        if (paginationDiv) {
            renderPagination(totalPages, page, 'pagination-falling', 'window.renderRankTableFalling');
        }
    };

    ''' + anchor
    
    content = content.replace(anchor, functions)
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print('Replaced and wrote app.js')
