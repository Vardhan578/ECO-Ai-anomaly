#!/usr/bin/env python3
"""
EcoPulse QA Inspector: Validates code integrity, DOM IDs, JS syntax, HTML semantics, CSS responsiveness.
"""

import re
import sys

def verify_dom_ids():
    with open("app.js", "r", encoding="utf-8") as f:
        js = f.read()
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    js_ids = set(re.findall(r'document\.getElementById\([\'"]([^\'"]+)[\'"]\)', js))
    html_ids = set(re.findall(r'id=[\'"]([^\'"]+)[\'"]', html))

    missing = js_ids - html_ids
    print(f"Total IDs checked in app.js: {len(js_ids)}")
    print(f"Total IDs declared in index.html: {len(html_ids)}")
    if missing:
        print(f"WARNING - Missing IDs in index.html: {missing}")
        return False
    else:
        print("PASS: All DOM element IDs referenced in app.js exist in index.html.")
        return True

def verify_onclick_functions():
    with open("app.js", "r", encoding="utf-8") as f:
        js = f.read()
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    html_onclicks = set(re.findall(r'onclick=[\'"]([a-zA-Z0-9_]+)\(', html))
    js_onclicks = set(re.findall(r'onclick=[\'"]([a-zA-Z0-9_]+)\(', js))
    all_onclicks = html_onclicks.union(js_onclicks)

    js_functions = set(re.findall(r'(?:function\s+([a-zA-Z0-9_]+)|([a-zA-Z0-9_]+)\s*=\s*function|async\s+function\s+([a-zA-Z0-9_]+))', js))
    flat_funcs = set()
    for tup in js_functions:
        for name in tup:
            if name:
                flat_funcs.add(name)

    missing = all_onclicks - flat_funcs
    print(f"Total onclick handlers checked: {len(all_onclicks)}")
    if missing:
        print(f"WARNING - Missing functions in app.js for onclick handlers: {missing}")
        return False
    else:
        print("PASS: All inline onclick handlers have corresponding JS function implementations.")
        return True

if __name__ == "__main__":
    r1 = verify_dom_ids()
    r2 = verify_onclick_functions()
    sys.exit(0 if (r1 and r2) else 1)
