// ==========================================================================
// ウィンドウレベルのドラッグ&ドロップ制御
// Edge/Chrome では http:// ページへのファイルドロップ時、
// デフォルト動作（ファイルへのナビゲーション）を阻止しないと
// DOM の drop イベントが発火しない。
// ==========================================================================
(function() {
    // dragover: ブラウザデフォルトの「ファイルに移動」を全画面で阻止
    window.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
    }, false);

    // drop: ドロップゾーン外へのドロップでナビゲーションしないよう阻止
    window.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
    }, false);
})();
// ==========================================================================
// トースト通知ユーティリティ
// ==========================================================================
function showToast(message, type) {
    type = type || 'info';
    var toast = document.getElementById('dashboard-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dashboard-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);opacity:0;transform:translateY(10px);pointer-events:none;';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    if (type === 'success') {
        toast.style.background = '#10b981';
        toast.style.color = '#ffffff';
        toast.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.4)';
    } else if (type === 'warning') {
        toast.style.background = '#f59e0b';
        toast.style.color = '#ffffff';
        toast.style.boxShadow = '0 4px 14px rgba(245, 158, 11, 0.4)';
    } else {
        toast.style.background = '#334155';
        toast.style.color = '#ffffff';
        toast.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.25)';
    }

    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
    }, 2500);
}

// データリセット状態の追跡フラグ
var isDashboardCleared = false;

// ==========================================================================
// 全グラフ・カード数値・テーブル初期化ロジック (ブランク・未読込表示)
// ==========================================================================
function resetUploadData() {
    if (isDashboardCleared) {
        showToast('既に全データは初期化（未読込表示）されています。', 'info');
        return;
    }

    // 1. アップロードファイル入力・ピル・ドロップゾーンのリセット
    var inputBase = document.getElementById('file-input-base');
    var inputCompare = document.getElementById('file-input-compare');
    var pillBase = document.getElementById('file-name-base');
    var pillCompare = document.getElementById('file-name-compare');

    if (inputBase) inputBase.value = '';
    if (inputCompare) inputCompare.value = '';

    if (pillBase) {
        pillBase.textContent = '基準: 未読込';
        pillBase.title = '';
        pillBase.classList.add('hidden');
    }
    if (pillCompare) {
        pillCompare.textContent = '比較: 未読込';
        pillCompare.title = '';
        pillCompare.classList.add('hidden');
    }

    var dropBase = document.getElementById('drop-zone-base');
    var dropCompare = document.getElementById('drop-zone-compare');
    if (dropBase) dropBase.classList.remove('drag-over');
    if (dropCompare) dropCompare.classList.remove('drag-over');

    // 2. 主要サマリーカード指標のブランク初期化
    var cardWeek = document.getElementById('card-week-avg');
    if (cardWeek) {
        var val = cardWeek.querySelector('.card-value');
        var sub = cardWeek.querySelector('.card-subtext');
        if (val) val.textContent = '¥ -';
        if (sub) sub.textContent = '基準データ未読込';
    }

    var cardDay = document.getElementById('card-day-sales');
    if (cardDay) {
        var val = cardDay.querySelector('.card-value');
        var sub = cardDay.querySelector('.card-subtext');
        if (val) val.textContent = '¥ -';
        if (sub) sub.textContent = '比較データ未読込';
    }

    var cardComp = document.getElementById('card-comparison');
    if (cardComp) {
        var val = cardComp.querySelector('.card-value');
        var sub = cardComp.querySelector('.card-subtext');
        if (val) {
            val.textContent = '- %';
            val.style.color = 'var(--text-muted)';
        }
        if (sub) sub.textContent = '差額: -';
    }

    // 3. チャートの破棄・プレースホルダー表示
    if (typeof Chart !== 'undefined') {
        var barChartInstance = Chart.getChart('categoryBarChart');
        if (barChartInstance) {
            barChartInstance.destroy();
        }
        var pieChartInstance = Chart.getChart('categoryPieChart');
        if (pieChartInstance) {
            pieChartInstance.destroy();
        }
    }

    var barCanvas = document.getElementById('categoryBarChart');
    if (barCanvas && barCanvas.parentElement) {
        barCanvas.style.display = 'none';
        var barPlaceholder = document.getElementById('placeholder-bar-chart');
        if (!barPlaceholder) {
            barPlaceholder = document.createElement('div');
            barPlaceholder.id = 'placeholder-bar-chart';
            barPlaceholder.style.cssText = 'height: 380px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted); font-size: 14px;';
            barPlaceholder.textContent = '📊 比較基準および比較対象データが未読込です';
            barCanvas.parentElement.appendChild(barPlaceholder);
        } else {
            barPlaceholder.style.display = 'flex';
        }
    }

    var pieCanvas = document.getElementById('categoryPieChart');
    if (pieCanvas && pieCanvas.parentElement) {
        pieCanvas.style.display = 'none';
        var piePlaceholder = document.getElementById('placeholder-pie-chart');
        if (!piePlaceholder) {
            piePlaceholder = document.createElement('div');
            piePlaceholder.id = 'placeholder-pie-chart';
            piePlaceholder.style.cssText = 'height: 280px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted); font-size: 13px;';
            piePlaceholder.textContent = '構成比データ未読込';
            pieCanvas.parentElement.appendChild(piePlaceholder);
        } else {
            piePlaceholder.style.display = 'flex';
        }
    }

    // 4. 分析コメントの初期化
    var commentaryItems = document.querySelectorAll('.commentary-item');
    commentaryItems.forEach(function(item) {
        item.textContent = 'データが未読込です。基準データと比較データをアップロードしてください。';
        item.style.color = 'var(--text-muted)';
    });

    // 5. 各種テーブルボディのブランク表示
    var tables = document.querySelectorAll('table tbody');
    tables.forEach(function(tbody) {
        var colCount = 6;
        var parentTable = tbody.closest('table');
        if (parentTable) {
            var ths = parentTable.querySelectorAll('thead th');
            if (ths && ths.length > 0) colCount = ths.length;
        }
        tbody.innerHTML = '<tr><td colspan="' + colCount + '" style="text-align: center; padding: 36px 16px; color: var(--text-muted); font-size: 13px;">データが読み込まれていません</td></tr>';
    });

    uploadedBaseData = null;
    uploadedCompareData = null;
    isDashboardCleared = true;
    showToast('画面上の全グラフ・数値を初期化（未読込表示）しました。', 'success');
}

        // 全画面表示ロジック (アイコンのみ対応)
        function toggleFullScreen() {
            const btn = document.getElementById('fullscreen-btn');
            const iconMax = btn ? btn.querySelector('.icon-maximize') : null;
            const iconMin = btn ? btn.querySelector('.icon-minimize') : null;

            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(function(err) {
                    console.error('全画面表示エラー:', err);
                });
                if (btn) {
                    btn.setAttribute('title', '全画面表示を終了します');
                    btn.setAttribute('aria-label', '全画面表示を終了');
                    btn.setAttribute('aria-pressed', 'true');
                }
                if (iconMax) iconMax.style.display = 'none';
                if (iconMin) iconMin.style.display = 'block';
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
                if (btn) {
                    btn.setAttribute('title', '全画面表示に切り替えます');
                    btn.setAttribute('aria-label', '全画面表示に切り替え');
                    btn.setAttribute('aria-pressed', 'false');
                }
                if (iconMax) iconMax.style.display = 'block';
                if (iconMin) iconMin.style.display = 'none';
            }
        }

        document.addEventListener('fullscreenchange', function() {
            const btn = document.getElementById('fullscreen-btn');
            const iconMax = btn ? btn.querySelector('.icon-maximize') : null;
            const iconMin = btn ? btn.querySelector('.icon-minimize') : null;
            if (!document.fullscreenElement) {
                if (btn) {
                    btn.setAttribute('title', '全画面表示に切り替えます');
                    btn.setAttribute('aria-label', '全画面表示に切り替え');
                    btn.setAttribute('aria-pressed', 'false');
                }
                if (iconMax) iconMax.style.display = 'block';
                if (iconMin) iconMin.style.display = 'none';
            } else {
                if (btn) {
                    btn.setAttribute('title', '全画面表示を終了します');
                    btn.setAttribute('aria-label', '全画面表示を終了');
                    btn.setAttribute('aria-pressed', 'true');
                }
                if (iconMax) iconMax.style.display = 'none';
                if (iconMin) iconMin.style.display = 'block';
            }
        });

        // テーマ切り替え (ダーク / ライト)
        function applyTheme(theme) {
            const currentTheme = theme === 'light' ? 'light' : 'dark';
            if (currentTheme === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }

            const themeBtn = document.getElementById('btn-theme-toggle');
            if (themeBtn) {
                if (currentTheme === 'light') {
                    themeBtn.setAttribute('title', 'ダークモードに切り替えます');
                    themeBtn.setAttribute('aria-label', 'ダークモードに切り替え');
                    themeBtn.setAttribute('aria-pressed', 'true');
                } else {
                    themeBtn.setAttribute('title', 'ライトモードに切り替えます');
                    themeBtn.setAttribute('aria-label', 'ライトモードに切り替え');
                    themeBtn.setAttribute('aria-pressed', 'false');
                }
            }

            try {
                localStorage.setItem('sales_analysis_theme', currentTheme);
            } catch (e) {}

            updateChartTheme(currentTheme);
        }

        function toggleTheme() {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            applyTheme(isLight ? 'dark' : 'light');
        }

        function updateChartTheme(theme) {
            if (typeof Chart === 'undefined') return;
            const textMuted = theme === 'light' ? '#64748b' : '#94a3b8';
            const gridColor = theme === 'light' ? 'rgba(0, 0, 0, 0.06)' : '#2d3348';

            if (Chart.instances) {
                Object.values(Chart.instances).forEach(function(chart) {
                    if (chart && chart.options && chart.options.scales) {
                        if (chart.options.scales.x) {
                            if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = textMuted;
                            if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = gridColor;
                        }
                        if (chart.options.scales.y) {
                            if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = textMuted;
                            if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = gridColor;
                        }
                        if (chart.options.scales.y1) {
                            if (chart.options.scales.y1.ticks) chart.options.scales.y1.ticks.color = textMuted;
                            if (chart.options.scales.y1.grid) chart.options.scales.y1.grid.color = gridColor;
                        }
                        chart.update();
                    }
                });
            }
        }

        // 初期ロード時に保存テーマを反映
        try {
            const savedTheme = localStorage.getItem('sales_analysis_theme');
            if (savedTheme === 'light') {
                applyTheme('light');
            }
        } catch (e) {}

        // タブ切替ロジック
        function switchTab(tab) {
            const btnWeek = document.getElementById('tab-btn-week');
            const btnDay = document.getElementById('tab-btn-day');
            const tblWeek = document.getElementById('table-week');
            const tblDay = document.getElementById('table-day');

            if (tab === 'week') {
                btnWeek.classList.add('active');
                btnWeek.setAttribute('aria-selected', 'true');
                btnDay.classList.remove('active');
                btnDay.setAttribute('aria-selected', 'false');
                tblWeek.style.display = 'block';
                tblDay.style.display = 'none';
            } else {
                btnDay.classList.add('active');
                btnDay.setAttribute('aria-selected', 'true');
                btnWeek.classList.remove('active');
                btnWeek.setAttribute('aria-selected', 'false');
                tblDay.style.display = 'block';
                tblWeek.style.display = 'none';
            }
        }



        // DOMContentLoaded: 初期ブランク表示（参照実装と同一パターン）
        document.addEventListener('DOMContentLoaded', function() {
            initBlankCharts();
        });




        
// ==========================================================================
// ==========================================================================
// ファイルピル（アップロード済み表示）更新ユーティリティ
// ==========================================================================
function updateFilePill(pillId, fileName, prefix) {
    var pill = document.getElementById(pillId);
    if (!pill) return;
    var shortName = fileName.length > 22 ? fileName.substring(0, 20) + '…' : fileName;
    pill.textContent = prefix + ': ' + shortName;
    pill.title = fileName;
    pill.classList.remove('hidden');
}

// ==========================================================================
// 初期ブランクチャート表示（Canvas をプレースホルダーで覆う）
// ==========================================================================
function initBlankCharts() {
    var barCanvas = document.getElementById('categoryBarChart');
    var pieCanvas = document.getElementById('categoryPieChart');

    if (barCanvas) {
        barCanvas.style.display = 'none';
        var barPh = document.getElementById('placeholder-bar-chart');
        if (!barPh) {
            barPh = document.createElement('div');
            barPh.id = 'placeholder-bar-chart';
            barPh.style.cssText = 'height:380px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-muted);font-size:14px;';
            barPh.textContent = '📊 データをアップロードするとグラフが表示されます';
            barCanvas.parentElement.appendChild(barPh);
        } else {
            barPh.style.display = 'flex';
        }
    }

    if (pieCanvas) {
        pieCanvas.style.display = 'none';
        var piePh = document.getElementById('placeholder-pie-chart');
        if (!piePh) {
            piePh = document.createElement('div');
            piePh.id = 'placeholder-pie-chart';
            piePh.style.cssText = 'height:280px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-muted);font-size:13px;';
            piePh.textContent = '構成比データ未読込';
            pieCanvas.parentElement.appendChild(piePh);
        } else {
            piePh.style.display = 'flex';
        }
    }
}
// アップロードデータの動的解析＆ダッシュボード再描画エンジン
// ==========================================================================
var uploadedBaseData = null;
var uploadedCompareData = null;

function formatYen(val) {
    if (val === null || val === undefined || isNaN(val)) return '¥ -';
    return '¥' + Math.round(val).toLocaleString('ja-JP');
}

function renderDashboard() {
    isDashboardCleared = false;

    // 1. サマリーカードの更新
    if (uploadedBaseData) {
        var cardWeek = document.getElementById('card-week-avg');
        if (cardWeek) {
            var val = cardWeek.querySelector('.card-value');
            var sub = cardWeek.querySelector('.card-subtext');
            if (val) val.textContent = formatYen(uploadedBaseData.totalDailySales);
            if (sub) sub.textContent = uploadedBaseData.periodStr || '期間未定';
        }
    }

    if (uploadedCompareData) {
        var cardDay = document.getElementById('card-day-sales');
        if (cardDay) {
            var val = cardDay.querySelector('.card-value');
            var sub = cardDay.querySelector('.card-subtext');
            if (val) val.textContent = formatYen(uploadedCompareData.totalDailySales);
            if (sub) sub.textContent = uploadedCompareData.periodStr || '期間未定';
        }
    }

    if (uploadedBaseData && uploadedCompareData) {
        var cardComp = document.getElementById('card-comparison');
        if (cardComp) {
            var val = cardComp.querySelector('.card-value');
            var sub = cardComp.querySelector('.card-subtext');
            var bSales = uploadedBaseData.totalDailySales;
            var cSales = uploadedCompareData.totalDailySales;
            var ratio = bSales > 0 ? (cSales / bSales * 100) : 0;
            var diff = cSales - bSales;

            if (val) {
                val.textContent = ratio.toFixed(2) + '%';
                val.style.color = ratio >= 100 ? 'var(--accent-green)' : 'var(--accent-red)';
            }
            if (sub) {
                var badgeClass = diff >= 0 ? 'badge-up' : 'badge-down';
                var sign = diff >= 0 ? '+' : '-';
                sub.innerHTML = '差額: <span class="' + badgeClass + '">' + sign + formatYen(Math.abs(diff)) + '</span>';
            }
        }
    }

    // 2. グラフの更新
    renderCharts();

    // 3. テーブルの更新
    renderTables();

    // 4. 分析コメントの更新
    renderCommentary();
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;

    // プレースホルダーを隠してCanvasを表示
    var barCanvas = document.getElementById('categoryBarChart');
    var barPlaceholder = document.getElementById('placeholder-bar-chart');
    if (barCanvas) barCanvas.style.display = 'block';
    if (barPlaceholder) barPlaceholder.style.display = 'none';

    var pieCanvas = document.getElementById('categoryPieChart');
    var piePlaceholder = document.getElementById('placeholder-pie-chart');
    if (pieCanvas) pieCanvas.style.display = 'block';
    if (piePlaceholder) piePlaceholder.style.display = 'none';

    // 既存インスタンスの破棄
    var oldBar = Chart.getChart('categoryBarChart');
    if (oldBar) oldBar.destroy();
    var oldPie = Chart.getChart('categoryPieChart');
    if (oldPie) oldPie.destroy();

    var activeData = uploadedCompareData || uploadedBaseData;
    if (!activeData || !activeData.categories || activeData.categories.length === 0) return;

    var topCats = activeData.categories.slice(0, 12);
    var labels = topCats.map(function(c) { return c.name; });
    var compSalesData = topCats.map(function(c) { return c.sales; });

    var baseSalesMap = {};
    if (uploadedBaseData && uploadedBaseData.categories) {
        uploadedBaseData.categories.forEach(function(c) {
            baseSalesMap[c.name] = c.sales;
        });
    }
    var baseSalesData = labels.map(function(name) { return baseSalesMap[name] || 0; });
    var ratioData = labels.map(function(name, i) {
        var b = baseSalesData[i];
        var c = compSalesData[i];
        if (b > 0 && c > 0) return parseFloat((c / b * 100).toFixed(1));
        return 100.0;
    });

    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var textMuted = isLight ? '#64748b' : '#94a3b8';
    var gridColor = isLight ? 'rgba(0,0,0,0.06)' : '#2d3348';

    // 棒グラフ作成
    if (barCanvas) {
        var barCtx = barCanvas.getContext('2d');
        new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '対比 (%)',
                        type: 'line',
                        data: ratioData,
                        backgroundColor: '#fbbf24',
                        borderColor: '#fbbf24',
                        borderWidth: 2,
                        yAxisID: 'y1',
                        tension: 0.1
                    },
                    {
                        label: '比較基準',
                        type: 'bar',
                        data: baseSalesData,
                        backgroundColor: '#475569',
                        borderColor: '#64748b',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: '比較対象',
                        type: 'bar',
                        data: compSalesData,
                        backgroundColor: '#60a5fa',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: textMuted, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
                    y: { ticks: { color: textMuted }, grid: { color: gridColor } },
                    y1: { position: 'right', grid: { display: false }, ticks: { color: textMuted } }
                }
            }
        });
    }

    // 円グラフ作成
    if (pieCanvas) {
        var pieCtx = pieCanvas.getContext('2d');
        var pieLabels = topCats.slice(0, 8).map(function(c) { return c.name; });
        var pieValues = topCats.slice(0, 8).map(function(c) { return parseFloat(c.ratio.toFixed(1)); });
        var pieColors = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"];

        new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: pieLabels,
                datasets: [{
                    data: pieValues,
                    backgroundColor: pieColors,
                    borderColor: isLight ? '#ffffff' : '#1a1d27',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: textMuted, font: { size: 11 } } }
                }
            }
        });
    }
}

function renderTables() {
    var BLANK_MSG_5 = '<tr><td colspan="5" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';
    var BLANK_MSG_6 = '<tr><td colspan="6" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';
    var BLANK_MSG_7 = '<tr><td colspan="7" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';

    // 1. カテゴリ別売上テーブル (5列)
    var catBody = document.getElementById('tbody-category');
    if (catBody) {
        var bCatMap = {};
        if (uploadedBaseData && uploadedBaseData.categories) {
            uploadedBaseData.categories.forEach(function(c) { bCatMap[c.name] = c.sales; });
        }
        var catSrc = uploadedCompareData || uploadedBaseData;
        if (catSrc && catSrc.categories && catSrc.categories.length > 0) {
            catBody.innerHTML = catSrc.categories.slice(0, 15).map(function(cat) {
                var bSale = bCatMap[cat.name] || 0;
                var cSale = cat.sales;
                var compRatioStr = bSale > 0 ? (cSale / bSale * 100).toFixed(1) + '%' : '-';
                return '<tr>' +
                    '<td style="font-weight:500;">' + escHtml(cat.name) + '</td>' +
                    '<td class="text-right">' + formatYen(bSale) + '</td>' +
                    '<td class="text-right">' + formatYen(cSale) + '</td>' +
                    '<td class="text-right">' + cat.ratio.toFixed(2) + '%</td>' +
                    '<td class="text-right">' + compRatioStr + '</td>' +
                    '</tr>';
            }).join('');
        } else { catBody.innerHTML = BLANK_MSG_5; }
    }

    // 2. 急上昇・急下落テーブル (6列)
    var risingBody  = document.getElementById('tbody-rising');
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
        var rising  = diffs.filter(function(d) { return d.diff > 0; }).sort(function(a,b){return b.diff-a.diff;}).slice(0,10);
        var falling = diffs.filter(function(d) { return d.diff < 0; }).sort(function(a,b){return a.diff-b.diff;}).slice(0,10);

        if (risingBody) {
            risingBody.innerHTML = rising.length > 0
                ? rising.map(function(d, i) {
                    var growthStr = d.bSales > 0 ? (d.cSales / d.bSales * 100).toFixed(1) + '%' : '新規';
                    return '<tr>' +
                        '<td style="text-align:center;">' + (i+1) + '</td>' +
                        '<td style="font-weight:500;">' + escHtml(d.name) + '</td>' +
                        '<td class="text-right">' + formatYen(d.bSales) + '</td>' +
                        '<td class="text-right">' + formatYen(d.cSales) + '</td>' +
                        '<td class="text-right" style="color:var(--accent-green)">+' + formatYen(d.diff).replace('¥','' ) + '</td>' +
                        '<td class="text-right">' + growthStr + '</td>' +
                        '</tr>';
                }).join('')
                : BLANK_MSG_6;
        }
        if (fallingBody) {
            fallingBody.innerHTML = falling.length > 0
                ? falling.map(function(d, i) {
                    var remainStr = d.bSales > 0 ? (d.cSales / d.bSales * 100).toFixed(1) + '%' : '-';
                    return '<tr>' +
                        '<td style="text-align:center;">' + (i+1) + '</td>' +
                        '<td style="font-weight:500;">' + escHtml(d.name) + '</td>' +
                        '<td class="text-right">' + formatYen(d.bSales) + '</td>' +
                        '<td class="text-right">' + formatYen(d.cSales) + '</td>' +
                        '<td class="text-right" style="color:var(--accent-red)">' + formatYen(d.diff) + '</td>' +
                        '<td class="text-right">' + remainStr + '</td>' +
                        '</tr>';
                }).join('')
                : BLANK_MSG_6;
        }
    } else {
        if (risingBody)  risingBody.innerHTML  = BLANK_MSG_6;
        if (fallingBody) fallingBody.innerHTML = BLANK_MSG_6;
    }

    // 3. 単品ランキングテーブル Best15
    // 基準 (6列: 順位/商品名/商品コード/日商/構成比/前年比)
    var weekBody = document.getElementById('tbody-week');
    if (weekBody) {
        var weekData = uploadedBaseData;
        weekBody.innerHTML = (weekData && weekData.topItems && weekData.topItems.length > 0)
            ? weekData.topItems.slice(0, 15).map(function(item, idx) {
                return '<tr>' +
                    '<td style="text-align:center;">' + (idx+1) + '</td>' +
                    '<td style="font-weight:500;">' + escHtml(item.name) + '</td>' +
                    '<td style="color:var(--text-muted);font-size:12px;">' + escHtml(item.code || '-') + '</td>' +
                    '<td class="text-right">' + formatYen(item.dailySales) + '</td>' +
                    '<td class="text-right">' + (item.ratio ? item.ratio.toFixed(2) + '%' : '-') + '</td>' +
                    '<td class="text-right">' + (item.compRatio ? item.compRatio.toFixed(1) + '%' : '-') + '</td>' +
                    '</tr>';
            }).join('')
            : BLANK_MSG_6;
    }

    // 比較対象 (7列: 順位/商品名/商品コード/日商/構成比/基準順位/前年比)
    var dayBody = document.getElementById('tbody-day');
    if (dayBody) {
        var dayData = uploadedCompareData;
        var baseRankMap = {};
        if (uploadedBaseData && uploadedBaseData.topItems) {
            uploadedBaseData.topItems.forEach(function(it, i) { baseRankMap[it.name] = i + 1; });
        }
        dayBody.innerHTML = (dayData && dayData.topItems && dayData.topItems.length > 0)
            ? dayData.topItems.slice(0, 15).map(function(item, idx) {
                var baseRank = baseRankMap[item.name];
                var rankDisplay = baseRank ? baseRank + '位' : '圏外';
                return '<tr>' +
                    '<td style="text-align:center;">' + (idx+1) + '</td>' +
                    '<td style="font-weight:500;">' + escHtml(item.name) + '</td>' +
                    '<td style="color:var(--text-muted);font-size:12px;">' + escHtml(item.code || '-') + '</td>' +
                    '<td class="text-right">' + formatYen(item.dailySales) + '</td>' +
                    '<td class="text-right">' + (item.ratio ? item.ratio.toFixed(2) + '%' : '-') + '</td>' +
                    '<td style="text-align:center;">' + rankDisplay + '</td>' +
                    '<td class="text-right">' + (item.compRatio ? item.compRatio.toFixed(1) + '%' : '-') + '</td>' +
                    '</tr>';
            }).join('')
            : BLANK_MSG_7;
    }
}

// XSS対策: HTMLエスケープユーティリティ
function escHtml(str) {
    if (!str) return '-';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderCommentary() {
    var el = function(id) { return document.getElementById(id); };

    if (uploadedBaseData && uploadedCompareData) {
        var bSales = uploadedBaseData.totalDailySales;
        var cSales = uploadedCompareData.totalDailySales;
        var diff   = cSales - bSales;
        var pct    = bSales > 0 ? ((diff / bSales) * 100).toFixed(1) : 0;
        var bPeriod = uploadedBaseData.periodStr || '前期';
        var cPeriod = uploadedCompareData.periodStr || '今期';

        var c1 = el('commentary-overview-1');
        if (c1) c1.innerHTML = '<strong>日商の推移:</strong> 比較対象（' + escHtml(cPeriod) + '）の日商 ' + formatYen(cSales) + ' は、比較基準（' + escHtml(bPeriod) + '）の日商 ' + formatYen(bSales) + ' と比べて <strong>約' + Math.abs(pct) + '% ' + (diff >= 0 ? '増加' : '減少') + '</strong> しています。';
        var c2 = el('commentary-overview-2');
        if (c2) c2.innerHTML = '';
    } else if (uploadedBaseData || uploadedCompareData) {
        var active = uploadedCompareData || uploadedBaseData;
        var c1 = el('commentary-overview-1');
        if (c1) c1.innerHTML = '<strong>日商サマリー:</strong> 読み込み済みデータ（' + escHtml(active.periodStr || '対象期間') + '）の日商は <strong>' + formatYen(active.totalDailySales) + '</strong> です。もう一方のデータをアップロードすると対比分析が行われます。';
    }
}

// ==========================================================================
// インライン ondrop ハンドラ（HTML属性から直接呼び出し）
// 引数を type のみにしてHTML属性内の日本語文字列を排除
// ==========================================================================
function handleInlineDrop(event, type) {
    var dt = event.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) {
        console.warn('[handleInlineDrop] dataTransfer.files が空です');
        return;
    }
    var file = dt.files[0];
    console.log('[handleInlineDrop] ファイルドロップ検出:', file.name, 'type:', type);
    var pillId  = type === 'base' ? 'file-name-base' : 'file-name-compare';
    var prefix  = type === 'base' ? '基準' : '比較';
    updateFilePill(pillId, file.name, prefix);
    handleFileUpload(file, type);
}

function handleFileUpload(file, type) {
    if (!file) return;

    if (!window.SalesParser || typeof window.SalesParser.parseSalesFile !== 'function') {
        showToast('パーサーモジュールが読み込まれていません。', 'warning');
        return;
    }

    SalesParser.parseSalesFile(file).then(function(parsedData) {
        if (type === 'base') {
            uploadedBaseData = parsedData;
        } else {
            uploadedCompareData = parsedData;
        }

        renderDashboard();
        showToast((type === 'base' ? '基準' : '比較') + 'データ（' + parsedData.itemCount + '件）を読み込みました。', 'success');
    }).catch(function(err) {
        console.error('ファイル解析エラー:', err);
        showToast('ファイルの解析に失敗しました: ' + err.message, 'warning');
    });
}

// ==========================================================================
// ドロップゾーン初期化（参照実装と同一ロジック）
// ==========================================================================
function setupDropZone(dropZoneId, fileInputId, pillId, prefix, type) {
    var dropZone = document.getElementById(dropZoneId);
    var fileInput = document.getElementById(fileInputId);

    // ファイル選択（input[change]）
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            if (file) {
                updateFilePill(pillId, file.name, prefix);
                handleFileUpload(file, type);
                fileInput.value = ''; // 同じファイルを再選択可能に
            }
        });
    }

    // ドラッグ&ドロップ
    if (dropZone) {
        // dragenter / dragover: ドロップ許可（preventDefault 必須）
        ['dragenter', 'dragover'].forEach(function(eventName) {
            dropZone.addEventListener(eventName, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            });
        });

        // dragleave / drop: ハイライト解除
        ['dragleave', 'drop'].forEach(function(eventName) {
            dropZone.addEventListener(eventName, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            });
        });

        // drop: ファイル取得・処理
        dropZone.addEventListener('drop', function(e) {
            var dt = e.dataTransfer;
            var file = dt && dt.files && dt.files[0];
            if (file) {
                updateFilePill(pillId, file.name, prefix);
                handleFileUpload(file, type);
            }
        });

        // キーボードアクセシビリティ（Enter / Space でダイアログ起動）
        dropZone.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (fileInput) fileInput.click();
            }
        });
    }
}

// DOMContentLoaded でドロップゾーンを初期化
document.addEventListener('DOMContentLoaded', function() {
    setupDropZone('drop-zone-base',    'file-input-base',    'file-name-base',    '基準', 'base');
    setupDropZone('drop-zone-compare', 'file-input-compare', 'file-name-compare', '比較', 'compare');
});
