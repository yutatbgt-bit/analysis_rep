// ==========================================================================
// グローバル変数・設定
// ==========================================================================
window.rankItemsPerPage = 20;
window.currentRankPageWeek = 1;
window.currentRankPageDay = 1;


// ==========================================================================
// 堅牢なハイブリッド・ストレージマネージャー (IndexedDB + localStorage フォールバック)
// ==========================================================================
var StorageManager = (function() {
    var DB_NAME = 'SalesAnalysisReportDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'analysis_store';

    function openDB() {
        return new Promise(function(resolve, reject) {
            if (!window.indexedDB) {
                return reject(new Error('IndexedDB not supported'));
            }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error); };
        });
    }

    return {
        get: function(key) {
            return openDB().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var store = tx.objectStore(STORE_NAME);
                    var req = store.get(key);
                    req.onsuccess = function() { resolve(req.result); };
                    req.onerror = function() { reject(req.error); };
                });
            }).catch(function() {
                try {
                    var raw = localStorage.getItem('sa_rep_' + key);
                    return raw ? JSON.parse(raw) : null;
                } catch (e) {
                    return null;
                }
            });
        },
        set: function(key, val) {
            return openDB().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    var store = tx.objectStore(STORE_NAME);
                    var req = store.put(val, key);
                    req.onsuccess = function() { resolve(); };
                    req.onerror = function() { reject(req.error); };
                });
            }).catch(function() {
                try {
                    localStorage.setItem('sa_rep_' + key, JSON.stringify(val));
                } catch (e) {
                    console.warn('[StorageManager] localStorage set failed:', e);
                }
            });
        },
        clearAll: function() {
            return openDB().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    var store = tx.objectStore(STORE_NAME);
                    var req = store.clear();
                    req.onsuccess = function() { resolve(); };
                    req.onerror = function() { reject(req.error); };
                });
            }).catch(function() {
                try {
                    localStorage.removeItem('sa_rep_base_data');
                    localStorage.removeItem('sa_rep_compare_data');
                } catch (e) {}
            });
        }
    };
})();

// XSS対策: HTMLエスケープユーティリティ
function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


// 数値・差分色分けフォーマットユーティリティ
function formatDiffYen(diff) {
    if (diff === null || diff === undefined || isNaN(diff)) return '-';
    var rounded = Math.round(diff);
    if (rounded > 0) {
        return '<span class="diff-plus">+¥' + rounded.toLocaleString() + '</span>';
    } else if (rounded < 0) {
        return '<span class="diff-minus">-¥' + Math.abs(rounded).toLocaleString() + '</span>';
    } else {
        return '<span class="diff-zero">±¥0</span>';
    }
}

function formatDiffRatio(diff) {
    if (diff === null || diff === undefined || isNaN(diff)) return '-';
    if (diff > 0.001) {
        return '<span class="diff-plus">+' + diff.toFixed(2) + '%</span>';
    } else if (diff < -0.001) {
        return '<span class="diff-minus">' + diff.toFixed(2) + '%</span>';
    } else {
        return '<span class="diff-zero">±0.00%</span>';
    }
}

function formatRankDiff(fromRank, toRank) {
    if (!fromRank) {
        return '<span class="diff-new">New</span>';
    }
    if (!toRank) {
        return '<span class="diff-minus">-</span>';
    }
    var diff = fromRank - toRank; // 例: 3位から1位なら +2
    if (diff > 0) {
        return '<span class="diff-plus">+' + diff + ' ↑</span>';
    } else if (diff < 0) {
        return '<span class="diff-minus">' + diff + ' ↓</span>';
    } else {
        return '<span class="diff-zero">±0</span>';
    }
}

function formatCompRatio(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    var str = val.toFixed(1) + '%';
    if (val >= 100.0) {
        return '<span class="diff-plus">' + str + '</span>';
    } else {
        return '<span class="diff-minus">' + str + '</span>';
    }
}

﻿// ==========================================================================
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

    // ストレージから永続化データを完全消去
    StorageManager.clearAll();

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

            var pageWeek = document.getElementById('pagination-week');
            var pageDay = document.getElementById('pagination-day');
            
            if (tab === 'week') {
                btnWeek.classList.add('active');
                btnWeek.setAttribute('aria-selected', 'true');
                btnDay.classList.remove('active');
                btnDay.setAttribute('aria-selected', 'false');
                tblWeek.style.display = 'block';
                tblDay.style.display = 'none';
                if (pageWeek) pageWeek.style.display = 'flex';
                if (pageDay) pageDay.style.display = 'none';
            } else {
                btnDay.classList.add('active');
                btnDay.setAttribute('aria-selected', 'true');
                btnWeek.classList.remove('active');
                btnWeek.setAttribute('aria-selected', 'false');
                tblDay.style.display = 'block';
                tblWeek.style.display = 'none';
                if (pageWeek) pageWeek.style.display = 'none';
                if (pageDay) pageDay.style.display = 'flex';
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

// ==========================================================================
// カテゴリ統合ヘルパー（基準と比較の全カテゴリをマージ＆対比計算）
// ==========================================================================
function getIntegratedCategories() {
    var bCats = (uploadedBaseData && uploadedBaseData.categories) ? uploadedBaseData.categories : [];
    var cCats = (uploadedCompareData && uploadedCompareData.categories) ? uploadedCompareData.categories : [];

    var map = {};
    bCats.forEach(function(c) {
        map[c.name] = { name: c.name, bSales: c.sales, cSales: 0, bRatio: c.ratio, cRatio: 0 };
    });
    cCats.forEach(function(c) {
        if (!map[c.name]) {
            map[c.name] = { name: c.name, bSales: 0, cSales: c.sales, bRatio: 0, cRatio: c.ratio };
        } else {
            map[c.name].cSales = c.sales;
            map[c.name].cRatio = c.ratio;
        }
    });

    var list = [];
    for (var k in map) {
        var item = map[k];
        item.salesDiff = item.cSales - item.bSales;
        item.ratioDiff = item.cRatio - item.bRatio;
        item.displaySales = item.cSales > 0 ? item.cSales : item.bSales;
        if (item.bSales > 0 && item.cSales > 0) {
            item.compRatio = (item.cSales / item.bSales * 100);
        } else {
            item.compRatio = null;
        }
        list.push(item);
    }

    list.sort(function(a, b) { return b.displaySales - a.displaySales; });
    return list;
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;

    var barCanvas = document.getElementById('categoryBarChart');
    var barPlaceholder = document.getElementById('placeholder-bar-chart');
    if (barCanvas) barCanvas.style.display = 'block';
    if (barPlaceholder) barPlaceholder.style.display = 'none';

    var pieCanvas = document.getElementById('categoryPieChart');
    var piePlaceholder = document.getElementById('placeholder-pie-chart');
    if (pieCanvas) pieCanvas.style.display = 'block';
    if (piePlaceholder) piePlaceholder.style.display = 'none';

    var oldBar = Chart.getChart('categoryBarChart');
    if (oldBar) oldBar.destroy();
    var oldPie = Chart.getChart('categoryPieChart');
    if (oldPie) oldPie.destroy();

    var integratedCats = getIntegratedCategories();
    if (integratedCats.length === 0) return;

    var topCats = integratedCats.slice(0, 12);
    var labels = topCats.map(function(c) { return c.name; });

    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var textMuted = isLight ? '#64748b' : '#94a3b8';
    var gridColor = isLight ? 'rgba(0,0,0,0.06)' : '#2d3348';

    // 1. カテゴリ別棒グラフ（比較対比）
    if (barCanvas) {
        var barCtx = barCanvas.getContext('2d');
        var datasets = [];

        if (uploadedBaseData && uploadedCompareData) {
            var ratioData = topCats.map(function(c) {
                return c.compRatio !== null ? parseFloat(c.compRatio.toFixed(1)) : 100.0;
            });
            var bSalesData = topCats.map(function(c) { return c.bSales; });
            var cSalesData = topCats.map(function(c) { return c.cSales; });

            datasets.push({
                label: '対比 (%)',
                type: 'line',
                data: ratioData,
                backgroundColor: '#fbbf24',
                borderColor: '#fbbf24',
                borderWidth: 2,
                pointRadius: 4,
                yAxisID: 'y1',
                tension: 0.1
            });
            datasets.push({
                label: '比較基準 日商',
                type: 'bar',
                data: bSalesData,
                backgroundColor: '#475569',
                borderColor: '#64748b',
                borderWidth: 1,
                yAxisID: 'y'
            });
            datasets.push({
                label: '比較対象 日商',
                type: 'bar',
                data: cSalesData,
                backgroundColor: '#60a5fa',
                borderColor: '#3b82f6',
                borderWidth: 1,
                yAxisID: 'y'
            });
        } else if (uploadedBaseData) {
            var bSalesOnly = topCats.map(function(c) { return c.bSales; });
            datasets.push({
                label: '比較基準 日商',
                type: 'bar',
                data: bSalesOnly,
                backgroundColor: '#475569',
                borderColor: '#64748b',
                borderWidth: 1,
                yAxisID: 'y'
            });
        } else if (uploadedCompareData) {
            var cSalesOnly = topCats.map(function(c) { return c.cSales; });
            datasets.push({
                label: '比較対象 日商',
                type: 'bar',
                data: cSalesOnly,
                backgroundColor: '#60a5fa',
                borderColor: '#3b82f6',
                borderWidth: 1,
                yAxisID: 'y'
            });
        }

        new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: textMuted, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
                    y: {
                        ticks: {
                            color: textMuted,
                            callback: function(v) { return '¥' + (v >= 10000 ? (v / 10000).toFixed(0) + '万' : v.toLocaleString()); }
                        },
                        grid: { color: gridColor }
                    },
                    y1: {
                        position: 'right',
                        display: (uploadedBaseData && uploadedCompareData) ? true : false,
                        grid: { display: false },
                        ticks: { color: textMuted, callback: function(v) { return v + '%'; } }
                    }
                }
            }
        });
    }

    // 2. カテゴリ円グラフ（構成比ドーナツチャート）
    if (pieCanvas) {
        var pieCtx = pieCanvas.getContext('2d');
        var pieTop = topCats.slice(0, 8);
        var pieLabels = pieTop.map(function(c) { return c.name; });
        var pieValues = pieTop.map(function(c) {
            var r = uploadedCompareData ? c.cRatio : c.bRatio;
            return parseFloat(r.toFixed(1));
        });
        var pieColors = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"];

        new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: pieLabels,
                datasets: [{
                    data: pieValues,
                    backgroundColor: pieColors,
                    borderColor: isLight ? '#ffffff' : '#1a1d27',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: textMuted, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) { return ' ' + ctx.label + ': ' + ctx.parsed + '%'; }
                        }
                    }
                }
            }
        });
    }
}

function renderTables() {
    var BLANK_MSG_8 = '<tr><td colspan="8" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';
    var BLANK_MSG_9 = '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';

    // 1. カテゴリ別売上テーブル (8列: カテゴリ/基準 日商/基準 構成比/比較対象 日商/日商差分/比較対象 構成比/構成比差分/対比 %)
    var catBody = document.getElementById('tbody-category');
    if (catBody) {
        var integratedCats = getIntegratedCategories();
        if (integratedCats.length > 0) {
            catBody.innerHTML = integratedCats.slice(0, 15).map(function(item) {
                var bDisplay = uploadedBaseData ? formatYen(item.bSales) : '-';
                var bRatioDisplay = uploadedBaseData ? item.bRatio.toFixed(2) + '%' : '-';
                var cDisplay = uploadedCompareData ? formatYen(item.cSales) : '-';
                var cRatioDisplay = uploadedCompareData ? item.cRatio.toFixed(2) + '%' : '-';

                var salesDiffHtml = (uploadedBaseData && uploadedCompareData)
                    ? formatDiffYen(item.cSales - item.bSales)
                    : '-';
                var ratioDiffHtml = (uploadedBaseData && uploadedCompareData)
                    ? formatDiffRatio(item.cRatio - item.bRatio)
                    : '-';
                var compRatioHtml = (uploadedBaseData && uploadedCompareData && item.compRatio !== null)
                    ? formatCompRatio(item.compRatio)
                    : '-';

                return '<tr>' +
                      '<td class="col-cat-name">' + escHtml(item.name) + '</td>' +
                      '<td class="col-cat-sales text-right">' + bDisplay + '</td>' +
                      '<td class="col-cat-sales text-right">' + cDisplay + '</td>' +
                      '<td class="col-cat-diff text-right">' + salesDiffHtml + '</td>' +
                      '<td class="col-cat-ratio text-right">' + bRatioDisplay + '</td>' +
                      '<td class="col-cat-ratio text-right">' + cRatioDisplay + '</td>' +
                      '<td class="col-cat-diff text-right">' + ratioDiffHtml + '</td>' +
                      '<td class="col-cat-ratio text-right">' + compRatioHtml + '</td>' +
                      '</tr>';
            }).join('');
        } else {
            catBody.innerHTML = BLANK_MSG_8;
        }
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
                    var growthStr = d.bSales > 0 ? formatCompRatio(d.cSales / d.bSales * 100) : '-';
                    return '<tr>' +
                        '<td style="text-align:center;">' + (i+1) + '</td>' +
                        '<td style="font-weight:500;">' + escHtml(d.name) + '</td>' +
                        '<td class="text-right">' + formatYen(d.bSales) + '</td>' +
                        '<td class="text-right">' + formatYen(d.cSales) + '</td>' +
                        '<td class="text-right" style="white-space:nowrap;">' + formatDiffYen(d.diff) + '</td>' +
                        '<td class="text-right">' + growthStr + '</td>' +
                        '</tr>';
                }).join('')
                : BLANK_MSG_6;
        }
        if (fallingBody) {
            fallingBody.innerHTML = falling.length > 0
                ? falling.map(function(d, i) {
                    var remainStr = d.bSales > 0 ? formatCompRatio(d.cSales / d.bSales * 100) : '-';
                    return '<tr>' +
                        '<td style="text-align:center;">' + (i+1) + '</td>' +
                        '<td style="font-weight:500;">' + escHtml(d.name) + '</td>' +
                        '<td class="text-right">' + formatYen(d.bSales) + '</td>' +
                        '<td class="text-right">' + formatYen(d.cSales) + '</td>' +
                        '<td class="text-right" style="white-space:nowrap;">' + formatDiffYen(d.diff) + '</td>' +
                        '<td class="text-right">' + remainStr + '</td>' +
                        '</tr>';
                }).join('')
                : BLANK_MSG_6;
        }
    } else {
        if (risingBody)  risingBody.innerHTML  = BLANK_MSG_6;
        if (fallingBody) fallingBody.innerHTML = BLANK_MSG_6;
    }

    // 3. 単品ランキングテーブル Best50 (日商ベース)
    // 基準データおよび比較対象データの商品順位・日商マップを作成
          var baseRankMap = {};
      var baseSalesMap = {};
      if (uploadedBaseData) {
          var bItems = uploadedBaseData.allItems || uploadedBaseData.topItems;
          if (bItems) {
              bItems.forEach(function(it, i) {
                  baseRankMap[it.name] = i + 1;
                  baseSalesMap[it.name] = it.dailySales;
              });
          }
      }

      var compareRankMap = {};
      var compareSalesMap = {};
      if (uploadedCompareData) {
          var cItems = uploadedCompareData.allItems || uploadedCompareData.topItems;
          if (cItems) {
              cItems.forEach(function(it, i) {
                  compareRankMap[it.name] = i + 1;
                  compareSalesMap[it.name] = it.dailySales;
              });
          }
      }

          // 比較基準テーブル (9列: 順位/商品名/商品コード/日商/構成比/比較順位/順位変動/日商差分/前年比)
      window.renderRankTableWeek = function(page) {
          var weekBody = document.getElementById('tbody-week');
          var paginationDiv = document.getElementById('pagination-week');
          if (!weekBody) return;
          var weekData = uploadedBaseData;
          if (!weekData || !weekData.topItems || weekData.topItems.length === 0) {
              weekBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';
              if (paginationDiv) paginationDiv.innerHTML = '';
              return;
          }

          var items = weekData.topItems.slice(0, 50);
          var totalPages = Math.ceil(items.length / window.rankItemsPerPage);
          if (page < 1) page = 1;
          if (page > totalPages) page = totalPages;
          window.currentRankPageWeek = page;

          var startIdx = (page - 1) * window.rankItemsPerPage;
          var endIdx = startIdx + window.rankItemsPerPage;
          var pageItems = items.slice(startIdx, endIdx);

          weekBody.innerHTML = pageItems.map(function(item, i) {
              var idx = startIdx + i;
              var currentRank = idx + 1;
              var dailySalesStr = formatYen(item.dailySales);
              var ratioNum = (item.ratio !== null && item.ratio !== undefined && !isNaN(item.ratio))
                  ? item.ratio
                  : (weekData.totalDailySales > 0 ? (item.dailySales / weekData.totalDailySales * 100) : null);
              var ratioStr = (ratioNum !== null && !isNaN(ratioNum)) ? ratioNum.toFixed(2) + '%' : '-';

              var compRank = compareRankMap[item.name];
              var compRankDisplay = uploadedCompareData ? (compRank ? compRank + '位' : '-') : '-';
              var rankDiffHtml = uploadedCompareData ? formatRankDiff(currentRank, compRank) : '-';

              var cSales = compareSalesMap[item.name] || 0;
              var salesDiffHtml = uploadedCompareData ? formatDiffYen(cSales - item.dailySales) : '-';

              // 前年比（比較対象 / 基準）
              var compRatioVal = null;
              if (item.compRatio !== null && item.compRatio !== undefined && !isNaN(item.compRatio)) {
                  compRatioVal = item.compRatio;
              } else if (item.dailySales > 0 && cSales > 0) {
                  compRatioVal = (cSales / item.dailySales * 100);
              }
              var compRatioHtml = compRatioVal !== null ? formatCompRatio(compRatioVal) : '-';

              return '<tr>' +
                  '<td class="text-center">' + currentRank + '</td>' +
                  '<td class="font-medium">' + escHtml(item.name) + '</td>' +
                  '<td>' + (item.code || '') + '</td>' +
                  '<td class="text-right">' + dailySalesStr + '</td>' +
                  '<td class="text-right">' + ratioStr + '</td>' +
                  '<td class="text-center">' + compRankDisplay + '</td>' +
                  '<td class="text-center">' + rankDiffHtml + '</td>' +
                  '<td class="text-right">' + salesDiffHtml + '</td>' +
                  '<td class="text-right">' + compRatioHtml + '</td>' +
                  '</tr>';
          }).join('');

          renderPagination(totalPages, page, 'pagination-week', function(newPage) {
              window.renderRankTableWeek(newPage);
          });
      };
      window.renderRankTableWeek(window.currentRankPageWeek);
      // 比較対象テーブル (9列: 順位/商品名/商品コード/日商/構成比/基準順位/順位変動/日商差分/前年比)
      window.renderRankTableDay = function(page) {
          var dayBody = document.getElementById('tbody-day');
          var paginationDiv = document.getElementById('pagination-day');
          if (!dayBody) return;
          var dayData = uploadedCompareData;
          if (!dayData || !dayData.topItems || dayData.topItems.length === 0) {
              dayBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px 16px;color:var(--text-muted);font-size:13px;">データが読み込まれていません</td></tr>';
              if (paginationDiv) paginationDiv.innerHTML = '';
              return;
          }

          var items = dayData.topItems.slice(0, 50);
          var totalPages = Math.ceil(items.length / window.rankItemsPerPage);
          if (page < 1) page = 1;
          if (page > totalPages) page = totalPages;
          window.currentRankPageDay = page;

          var startIdx = (page - 1) * window.rankItemsPerPage;
          var endIdx = startIdx + window.rankItemsPerPage;
          var pageItems = items.slice(startIdx, endIdx);

          dayBody.innerHTML = pageItems.map(function(item, i) {
              var idx = startIdx + i;
              var currentRank = idx + 1;
              var baseRank = baseRankMap[item.name];
              var baseRankDisplay = uploadedBaseData ? (baseRank ? baseRank + '位' : '-') : '-';
              var rankDiffHtml = uploadedBaseData ? formatRankDiff(baseRank, currentRank) : '-';

              var dailySalesStr = formatYen(item.dailySales);
              var ratioNum = (item.ratio !== null && item.ratio !== undefined && !isNaN(item.ratio))
                  ? item.ratio
                  : (dayData.totalDailySales > 0 ? (item.dailySales / dayData.totalDailySales * 100) : null);
              var ratioStr = (ratioNum !== null && !isNaN(ratioNum)) ? ratioNum.toFixed(2) + '%' : '-';

              var bSales = baseSalesMap[item.name] || 0;
              var salesDiffHtml = uploadedBaseData ? formatDiffYen(item.dailySales - bSales) : '-';

              // 前年比（売上高の比較日比）
              var compRatioVal = null;
              if (item.compRatio !== null && item.compRatio !== undefined && !isNaN(item.compRatio)) {
                  compRatioVal = item.compRatio;
              } else if (bSales > 0) {
                  compRatioVal = (item.dailySales / bSales * 100);
              }
              var compRatioHtml = compRatioVal !== null ? formatCompRatio(compRatioVal) : '-';

              return '<tr>' +
                  '<td class="text-center">' + currentRank + '</td>' +
                  '<td class="font-medium">' + escHtml(item.name) + '</td>' +
                  '<td>' + (item.code || '') + '</td>' +
                  '<td class="text-right">' + dailySalesStr + '</td>' +
                  '<td class="text-right">' + ratioStr + '</td>' +
                  '<td class="text-center">' + baseRankDisplay + '</td>' +
                  '<td class="text-center">' + rankDiffHtml + '</td>' +
                  '<td class="text-right">' + salesDiffHtml + '</td>' +
                  '<td class="text-right">' + compRatioHtml + '</td>' +
                  '</tr>';
          }).join('');

          renderPagination(totalPages, page, 'pagination-day', function(newPage) {
              window.renderRankTableDay(newPage);
          });
      };
      window.renderRankTableDay(window.currentRankPageDay);
}

// ==========================================================================
// 動的レポート生成（全体対比・カテゴリ分析・ランキング傾向）
// ==========================================================================
function renderCommentary() {
    var el = function(id) { return document.getElementById(id); };

    // 1. 全体対比コメント
    var cOver1 = el('commentary-overview-1');
    var cOver2 = el('commentary-overview-2');
    if (uploadedBaseData && uploadedCompareData) {
        var bSales = uploadedBaseData.totalDailySales;
        var cSales = uploadedCompareData.totalDailySales;
        var diff = cSales - bSales;
        var pct = bSales > 0 ? ((diff / bSales) * 100).toFixed(1) : 0;
        var bPeriod = uploadedBaseData.periodStr || '比較基準期間';
        var cPeriod = uploadedCompareData.periodStr || '比較対象期間';

        if (cOver1) {
            cOver1.innerHTML = '<strong>日商の推移:</strong> 比較対象（' + escHtml(cPeriod) + '）の日商 <strong>' + formatYen(cSales) + '</strong> は、比較基準（' + escHtml(bPeriod) + '）の日商 ' + formatYen(bSales) + ' と比べて <strong>約' + Math.abs(pct) + '% ' + (diff >= 0 ? '増加（+' : '減少（-') + formatYen(Math.abs(diff)).replace('¥','') + '）</strong> しています。';
            cOver1.style.color = '';
        }
        if (cOver2) {
            cOver2.innerHTML = '<strong>全体動向:</strong> スケールを1日あたり（日商ベース）に揃えた対比分析により、曜日要因や日数差に左右されない実質的な販売推移を的確に把握できます。';
            cOver2.style.color = '';
        }
    } else if (uploadedBaseData || uploadedCompareData) {
        var active = uploadedCompareData || uploadedBaseData;
        var activeLabel = uploadedCompareData ? '比較対象' : '比較基準';
        if (cOver1) {
            cOver1.innerHTML = '<strong>日商サマリー:</strong> 読み込み済み（' + activeLabel + '：' + escHtml(active.periodStr || '対象期間') + '）の日商は <strong>' + formatYen(active.totalDailySales) + '</strong>（品目数: ' + active.itemCount + '件）です。もう一方のデータをアップロードすると対比分析が行われます。';
            cOver1.style.color = '';
        }
        if (cOver2) cOver2.innerHTML = '';
    }

    // 2. カテゴリ分析のまとめレポート
    var cCat1 = el('commentary-category-1');
    var cCat2 = el('commentary-category-2');
    var cCat3 = el('commentary-category-3');
    var cCat4 = el('commentary-category-4');

    var integratedCats = getIntegratedCategories();

    if (uploadedBaseData && uploadedCompareData && integratedCats.length > 0) {
        // (1) 日商が上昇したカテゴリ
        var risingSales = integratedCats.filter(function(c) { return c.salesDiff > 0; })
            .sort(function(a, b) { return b.salesDiff - a.salesDiff; });
        if (cCat1) {
            if (risingSales.length > 0) {
                var rParts = risingSales.slice(0, 3).map(function(c) {
                    return '「' + escHtml(c.name) + '」（<strong>+' + formatYen(c.salesDiff).replace('¥','') + '</strong>）';
                });
                cCat1.innerHTML = '<strong>日商が上昇したカテゴリ:</strong> ' + rParts.join('、') + ' が比較対象で日商を伸ばしています。';
            } else {
                cCat1.innerHTML = '<strong>日商が上昇したカテゴリ:</strong> 日商を伸ばしたカテゴリは見られませんでした。';
            }
            cCat1.style.color = '';
        }

        // (2) 日商が下降したカテゴリ
        var fallingSales = integratedCats.filter(function(c) { return c.salesDiff < 0; })
            .sort(function(a, b) { return a.salesDiff - b.salesDiff; });
        if (cCat2) {
            if (fallingSales.length > 0) {
                var fParts = fallingSales.slice(0, 3).map(function(c) {
                    return '「' + escHtml(c.name) + '」（<strong>' + formatYen(c.salesDiff) + '</strong>）';
                });
                cCat2.innerHTML = '<strong>日商が下降したカテゴリ:</strong> ' + fParts.join('、') + ' が比較対象で日商を落としています。';
            } else {
                cCat2.innerHTML = '<strong>日商が下降したカテゴリ:</strong> 日商を落としたカテゴリは見られませんでした。';
            }
            cCat2.style.color = '';
        }

        // (3) 構成比が上昇したカテゴリ
        var risingRatio = integratedCats.filter(function(c) { return c.ratioDiff > 0.05; })
            .sort(function(a, b) { return b.ratioDiff - a.ratioDiff; });
        if (cCat3) {
            if (risingRatio.length > 0) {
                var rrParts = risingRatio.slice(0, 3).map(function(c) {
                    return '「' + escHtml(c.name) + '」（<strong>+' + c.ratioDiff.toFixed(2) + '%</strong>）';
                });
                cCat3.innerHTML = '<strong>構成比が上昇したカテゴリ:</strong> ' + rrParts.join('、') + ' が比較対象で売上シェアを拡大しています。';
            } else {
                cCat3.innerHTML = '<strong>構成比が上昇したカテゴリ:</strong> 有意にシェアを拡大したカテゴリはありません。';
            }
            cCat3.style.color = '';
        }

        // (4) 構成比が下降したカテゴリ
        var fallingRatio = integratedCats.filter(function(c) { return c.ratioDiff < -0.05; })
            .sort(function(a, b) { return a.ratioDiff - b.ratioDiff; });
        if (cCat4) {
            if (fallingRatio.length > 0) {
                var frParts = fallingRatio.slice(0, 3).map(function(c) {
                    return '「' + escHtml(c.name) + '」（<strong>' + c.ratioDiff.toFixed(2) + '%</strong>）';
                });
                cCat4.innerHTML = '<strong>構成比が下降したカテゴリ:</strong> ' + frParts.join('、') + ' が比較対象で売上シェアを縮小させています。';
            } else {
                cCat4.innerHTML = '<strong>構成比が下降したカテゴリ:</strong> 有意にシェアを縮小させたカテゴリはありません。';
            }
            cCat4.style.color = '';
        }
    } else if ((uploadedBaseData || uploadedCompareData) && integratedCats.length > 0) {
        var top3 = integratedCats.slice(0, 3);
        if (cCat1) {
            var catParts = top3.map(function(c) {
                var s = c.cSales > 0 ? c.cSales : c.bSales;
                var r = c.cSales > 0 ? c.cRatio : c.bRatio;
                return '「' + escHtml(c.name) + '」（構成比 <strong>' + r.toFixed(1) + '%</strong>, ' + formatYen(s) + '）';
            });
            cCat1.innerHTML = '<strong>主要構成カテゴリ:</strong> 売上上位は ' + catParts.join('、') + ' となっており、全体の売上の中心を担っています。もう一方のデータをアップロードするとカテゴリ間のシフト分析が行われます。';
            cCat1.style.color = '';
        }
        if (cCat2) cCat2.innerHTML = '';
        if (cCat3) cCat3.innerHTML = '';
        if (cCat4) cCat4.innerHTML = '';
    }

    // 3. ランキング傾向レポート
    var cRank1 = el('commentary-ranking-1');
    var cRank2 = el('commentary-ranking-2');
    var cRank3 = el('commentary-ranking-3');

    if (uploadedBaseData && uploadedCompareData &&
        uploadedBaseData.topItems && uploadedCompareData.topItems) {
        
        var baseItems = uploadedBaseData.topItems;
        var compItems = uploadedCompareData.topItems;

        var baseRankMap = {};
        baseItems.forEach(function(it, idx) { baseRankMap[it.name] = idx + 1; });
        var compRankMap = {};
        compItems.forEach(function(it, idx) { compRankMap[it.name] = idx + 1; });

        // (1) 安定首位・上位定番商品の分析
        if (cRank1) {
            if (baseItems.length > 0 && compItems.length > 0) {
                var bTop1 = baseItems[0];
                var cTop1 = compItems[0];
                if (bTop1.name === cTop1.name) {
                    var chg = bTop1.dailySales > 0 ? ((cTop1.dailySales / bTop1.dailySales) * 100).toFixed(0) : 100;
                    cRank1.innerHTML = '<strong>「' + escHtml(bTop1.name) + '」の安定した需要:</strong> 両期間ともに堂々の1位（基準: ' + formatYen(bTop1.dailySales) + '、比較: ' + formatYen(cTop1.dailySales) + '、前年比: ' + chg + '%）を堅持しており、不動の柱商品として極めて安定した実績を誇っています。';
                } else {
                    cRank1.innerHTML = '<strong>首位商品の変動:</strong> 比較基準の首位は「' + escHtml(bTop1.name) + '」（' + formatYen(bTop1.dailySales) + '）でしたが、比較対象では「' + escHtml(cTop1.name) + '」（' + formatYen(cTop1.dailySales) + '）が首位に躍り出ました。';
                }
                cRank1.style.color = '';
            }
        }

        // (2) 比較対象で順位が上昇した商品
        if (cRank2) {
            var risingRankItems = [];
            compItems.forEach(function(it) {
                var bR = baseRankMap[it.name];
                var cR = compRankMap[it.name];
                if (bR !== undefined && cR !== undefined && (bR - cR) >= 2) {
                    risingRankItems.push('「' + escHtml(it.name) + '」（' + bR + '位→' + cR + '位）');
                } else if (bR === undefined && cR <= 5) {
                    risingRankItems.push('「' + escHtml(it.name) + '」（-' + cR + '位）');
                }
            });
            if (risingRankItems.length > 0) {
                cRank2.innerHTML = '<strong>比較対象で順位が上昇した商品:</strong> ' + risingRankItems.slice(0, 3).join('、') + ' が大きく順位を伸ばし、売れ筋として急浮上しています。';
            } else {
                cRank2.innerHTML = '<strong>順位上昇商品:</strong> 上位陣の順位変動は比較的安定しており、急激な浮上商品は見られません。';
            }
            cRank2.style.color = '';
        }

        // (3) 比較対象で順位が下降した商品
        if (cRank3) {
            var fallingRankItems = [];
            baseItems.forEach(function(it) {
                var bR = baseRankMap[it.name];
                var cR = compRankMap[it.name];
                if (bR !== undefined && cR !== undefined && (cR - bR) >= 2) {
                    fallingRankItems.push('「' + escHtml(it.name) + '」（' + bR + '位→' + cR + '位）');
                } else if (bR <= 5 && cR === undefined) {
                    fallingRankItems.push('「' + escHtml(it.name) + '」（' + bR + '位-）');
                }
            });
            if (fallingRankItems.length > 0) {
                cRank3.innerHTML = '<strong>比較対象で順位が下降した商品:</strong> ' + fallingRankItems.slice(0, 3).join('、') + ' がランクを落としており、需要の落ち着きや在庫状況の確認が推奨されます。';
            } else {
                cRank3.innerHTML = '<strong>順位下降商品:</strong> 著しくランクダウンした定番商品はなく、堅調に推移しています。';
            }
            cRank3.style.color = '';
        }
    } else if (uploadedBaseData || uploadedCompareData) {
        var activeItems = (uploadedCompareData && uploadedCompareData.topItems) ? uploadedCompareData.topItems : ((uploadedBaseData && uploadedBaseData.topItems) ? uploadedBaseData.topItems : []);
        if (cRank1 && activeItems.length > 0) {
            var t1 = activeItems[0];
            cRank1.innerHTML = '<strong>売上首位商品:</strong> 1位は「' + escHtml(t1.name) + '」（日商 <strong>' + formatYen(t1.dailySales) + '</strong>、構成比 ' + (t1.ratio ? t1.ratio.toFixed(2) + '%' : '-') + '）です。もう一方のデータをアップロードすると順位の変動傾向が分析されます。';
            cRank1.style.color = '';
        }
        if (cRank2) cRank2.innerHTML = '';
        if (cRank3) cRank3.innerHTML = '';
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
        var key = type === 'base' ? 'base_data' : 'compare_data';
        var payload = {
            fileName: file.name,
            data: parsedData,
            savedAt: Date.now()
        };

        if (type === 'base') {
            uploadedBaseData = parsedData;
        } else {
            uploadedCompareData = parsedData;
        }

        // ストレージへ非同期で永続化保存
        StorageManager.set(key, payload);

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
    restorePersistedData();
});


// ==========================================================================
// 起動時の自動復元 (IndexedDB / localStorage から復帰)
// ==========================================================================
function restorePersistedData() {
    Promise.all([
        StorageManager.get('base_data'),
        StorageManager.get('compare_data')
    ]).then(function(results) {
        var basePayload = results[0];
        var compPayload = results[1];
        var restoredAny = false;

        if (basePayload && basePayload.data) {
            uploadedBaseData = basePayload.data;
            updateFilePill('file-name-base', basePayload.fileName || '基準データ', '基準');
            restoredAny = true;
        }

        if (compPayload && compPayload.data) {
            uploadedCompareData = compPayload.data;
            updateFilePill('file-name-compare', compPayload.fileName || '比較データ', '比較');
            restoredAny = true;
        }

        if (restoredAny) {
            isDashboardCleared = false;
            renderDashboard();
            showToast('前回保存されたデータを自動復元しました。', 'info');
        }
    }).catch(function(err) {
        console.warn('[restorePersistedData] 復元エラー:', err);
    });
}

    // --- ページネーション描画共通関数 ---
    function renderPagination(totalPages, currentPage, containerId, onClickCallback) {
        var container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (totalPages <= 1) return;

        // 前へ
        var prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = '前へ';
        prevBtn.disabled = (currentPage === 1);
        prevBtn.onclick = function() { onClickCallback(currentPage - 1); };
        container.appendChild(prevBtn);

        // ページ番号
        for (var i = 1; i <= totalPages; i++) {
            var btn = document.createElement('button');
            btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
            btn.textContent = i;
            (function(pageNum) {
                btn.onclick = function() { onClickCallback(pageNum); };
            })(i);
            container.appendChild(btn);
        }

        // 次へ
        var nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.textContent = '次へ';
        nextBtn.disabled = (currentPage === totalPages);
        nextBtn.onclick = function() { onClickCallback(currentPage + 1); };
        container.appendChild(nextBtn);
    }