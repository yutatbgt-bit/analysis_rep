import re

with open('tmp_dashboard.html', 'r', encoding='utf-8') as f:
    html = f.read()

code_match = re.search(r'const CONFIG_CATEGORY_MAP_CODE\s*=\s*(\{.*?\});', html, re.DOTALL)
name_match = re.search(r'const CONFIG_CATEGORY_MAP_NAME\s*=\s*(\{.*?\});', html, re.DOTALL)

if code_match and name_match:
    code_str = code_match.group(1)
    name_str = name_match.group(1)
    
    new_js = f"""
// 自動抽出されたマスタデータ
window.CONFIG_CATEGORY_MAP_CODE = {code_str};
window.CONFIG_CATEGORY_MAP_NAME = {name_str};

window.classifyProduct = function(name, code) {{
    const c = String(code || '').trim();
    if (c && window.CONFIG_CATEGORY_MAP_CODE[c]) {{
        return window.CONFIG_CATEGORY_MAP_CODE[c];
    }}
    const n = String(name || '').trim();
    if (n && window.CONFIG_CATEGORY_MAP_NAME[n]) {{
        return window.CONFIG_CATEGORY_MAP_NAME[n];
    }}
    return 'その他';
}};

// 互換性のため
window.getProductCategory = window.classifyProduct;
"""
    with open('js/category_map.js', 'w', encoding='utf-8') as out:
        out.write(new_js)
    print("Done!")
else:
    print("Match not found")
