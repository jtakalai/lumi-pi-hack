def parse_fields(line: str) -> list[str]:
    if not line.strip():
        return []
    fields = []
    n = len(line)
    i = 0
    while True:
        if i < n and line[i] == '"':
            # Quoted field: ends at the first '"' not followed by another '"'.
            i += 1
            out = []
            while i < n and not (line[i] == '"' and (i + 1 >= n or line[i + 1] != '"')):
                if line[i] == '"':
                    # Paired quotes inside a quoted field -> one literal quote.
                    out.append('"')
                    i += 2
                else:
                    out.append(line[i])
                    i += 1
            if i < n:
                i += 1  # skip the closing quote
            # Ignore any characters between the closing quote and the next comma.
            while i < n and line[i] != ',':
                i += 1
            fields.append(''.join(out))
        elif i < n:
            # Unquoted field: characters verbatim (quotes are literal data),
            # up to the next comma; strip leading/trailing whitespace.
            j = i
            while j < n and line[j] != ',':
                j += 1
            fields.append(line[i:j].strip())
            i = j
        else:
            # Field after a trailing comma -> empty string.
            fields.append('')
        if i < n:
            i += 1  # consume the separating comma
        else:
            break
    return fields

if __name__ == "__main__":
    import sys
    for line in sys.stdin:
        for field in parse_fields(line):
            print(field)
