#!/usr/bin/env python3
# clean-unicode.py — Replace Unicode comment separators causing TS1127
# Usage: python3 scripts/clean-unicode.py

import sys
import glob
import os

# Characters to replace (character, replacement, name)
REPLACEMENTS = [
    ('\u2500', '-', 'box-dash'),
    ('\u2014', '-', 'em-dash'),
    ('\u2013', '-', 'en-dash'),
    ('\u2501', '-', 'heavy box-dash'),
]

def scan_replace():
    patterns = [
        'clis/zlibrary-app/**/*.js',
        'clis/zlibrary/**/*.js',
    ]
    
    total_replaced = 0
    
    for pattern in patterns:
        for filepath in glob.glob(pattern, recursive=True):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            for bad_char, replacement, name in REPLACEMENTS:
                if bad_char in content:
                    count = content.count(bad_char)
                    content = content.replace(bad_char, replacement)
                    total_replaced += count
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
                print('Fixed ' + filepath + ': ' + str(total_replaced) + ' chars replaced')

# Run scan/replacement
main()