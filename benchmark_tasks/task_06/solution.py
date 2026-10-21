def parse_version(v_str):
    parts = [int(p) for p in v_str.split(".")]
    return parts

def compare_versions(v1, v2):
    p1 = parse_version(v1)
    p2 = parse_version(v2)
    if p1 > p2:
        return 1
    elif p1 < p2:
        return -1
    return 0
