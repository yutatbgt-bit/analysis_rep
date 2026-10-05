const fs = require('fs');

const html = fs.readFileSync('tmp_dashboard.html', 'utf8');

const codeStart = html.indexOf('const CONFIG_CATEGORY_MAP_CODE = {');
const codeEnd = html.indexOf('};', codeStart) + 2;
const codeStr = html.substring(codeStart, codeEnd);

const nameStart = html.indexOf('const CONFIG_CATEGORY_MAP_NAME = {', codeEnd);
const nameEnd = html.indexOf('};', nameStart) + 2;
const nameStr = html.substring(nameStart, nameEnd);

let newJs = `
// 自動抽出されたマスタデータ
window.CONFIG_CATEGORY_MAP_CODE = ${codeStr.replace('const CONFIG_CATEGORY_MAP_CODE = ', '')}
window.CONFIG_CATEGORY_MAP_NAME = ${nameStr.replace('const CONFIG_CATEGORY_MAP_NAME = ', '')}

window.classifyProduct = function(name, code) {
    const c = String(code || '').trim();
    if (c && window.CONFIG_CATEGORY_MAP_CODE[c]) {
        return window.CONFIG_CATEGORY_MAP_CODE[c];
    }
    const n = String(name || '').trim();
    if (n && window.CONFIG_CATEGORY_MAP_NAME[n]) {
        return window.CONFIG_CATEGORY_MAP_NAME[n];
    }
    return 'その他';
};

// 互換性のため
window.getProductCategory = window.classifyProduct;
`;

fs.writeFileSync('js/category_map.js', newJs, 'utf8');
console.log('Done!');
