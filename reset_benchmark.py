import os
from pathlib import Path

TASKS = {
    "task_01": {
        "impl": """def calculate_discount(price, rate):
    return price + (price * rate)
""",
        "test": """from solution import calculate_discount

def test_calculate_discount():
    assert calculate_discount(100, 0.2) == 80.0
    assert calculate_discount(50, 0.1) == 45.0
""",
    },
    "task_02": {
        "impl": """def reverse_words(sentence):
    return " ".join(sentence.split(" "))
""",
        "test": """from solution import reverse_words

def test_reverse_words():
    assert reverse_words("hello world") == "world hello"
    assert reverse_words("a b c") == "c b a"
""",
    },
    "task_03": {
        "impl": """def filter_active_users(users):
    return [u["name"] for u in users if u["active"]]
""",
        "test": """from solution import filter_active_users

def test_filter_active_users():
    data = [
        {"name": "Alice", "active": True},
        {"name": "Bob"},
        {"name": "Charlie", "active": False},
        {"name": "Dave", "active": True},
    ]
    assert filter_active_users(data) == ["Alice", "Dave"]
""",
    },
    "task_04": {
        "impl": """def run_length_encode(text):
    if not text:
        return ""
    result = []
    count = 1
    for i in range(1, len(text)):
        if text[i] == text[i - 1]:
            count += 1
        else:
            result.append(f"{text[i-1]}{count}")
    return "".join(result)
""",
        "test": """from solution import run_length_encode

def test_run_length_encode():
    assert run_length_encode("AAABBBCC") == "A3B3C2"
    assert run_length_encode("ABCD") == "A1B1C1D1"
    assert run_length_encode("") == ""
""",
    },
    "task_05": {
        "impl": """def flatten_dict(d, parent_key="", sep="."):
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}"
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)
""",
        "test": """from solution import flatten_dict

def test_flatten_dict():
    raw = {"a": 1, "b": {"c": 2, "d": {"e": 3}}}
    expected = {"a": 1, "b.c": 2, "b.d.e": 3}
    assert flatten_dict(raw) == expected
""",
    },
    "task_06": {
        "impl": """def parse_version(v_str):
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
""",
        "test": """from solution import compare_versions

def test_compare_versions():
    assert compare_versions("1.2", "1.2.0") == 0
    assert compare_versions("1.10", "1.2") == 1
    assert compare_versions("2.0.1", "2.1") == -1
    assert compare_versions("1.0.0.0", "1.0") == 0
""",
    },
    "task_07": {
        "impl": """def merge_intervals(intervals):
    if not intervals:
        return []
    intervals.sort(key=lambda x: x[0])
    merged = [intervals[0]]
    for cur in intervals[1:]:
        prev = merged[-1]
        if cur[0] < prev[1]:
            merged[-1] = (prev[0], max(prev[1], cur[1]))
        else:
            merged.append(cur)
    return merged
""",
        "test": """from solution import merge_intervals

def test_merge_intervals():
    assert merge_intervals([(1, 3), (2, 6), (8, 10), (15, 18)]) == [(1, 6), (8, 10), (15, 18)]
    assert merge_intervals([(1, 4), (4, 5)]) == [(1, 5)]
    assert merge_intervals([(1, 4), (0, 4)]) == [(0, 4)]
    assert merge_intervals([]) == []
""",
    },
    "task_08": {
        "impl": """class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = {}

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        return self.cache[key]

    def put(self, key: int, value: int) -> None:
        if len(self.cache) >= self.capacity and key not in self.cache:
            first_key = next(iter(self.cache))
            del self.cache[first_key]
        self.cache[key] = value
""",
        "test": """from solution import LRUCache

def test_lru_cache():
    cache = LRUCache(2)
    cache.put(1, 1)
    cache.put(2, 2)
    assert cache.get(1) == 1
    cache.put(3, 3)
    assert cache.get(2) == -1
    cache.put(4, 4)
    assert cache.get(1) == -1
    assert cache.get(3) == 3
    assert cache.get(4) == 4
""",
    },
    "task_09": {
        "impl": """def find_all_cycles(graph):
    cycles = []
    visited = set()

    def dfs(node, path):
        visited.add(node)
        for neighbor in graph.get(node, []):
            if neighbor in path:
                cycle = path[path.index(neighbor):] + [neighbor]
                cycles.append(cycle)
            elif neighbor not in visited:
                dfs(neighbor, path + [neighbor])

    for start_node in list(graph.keys()):
        dfs(start_node, [start_node])

    return cycles
""",
        "test": """from solution import find_all_cycles

def test_find_all_cycles():
    graph = {
        "A": ["B"],
        "B": ["C"],
        "C": ["A", "D"],
        "D": ["E"],
        "E": ["D"],
    }
    raw_cycles = find_all_cycles(graph)
    norm_cycles = set(tuple(c[:-1]) for c in raw_cycles)
    assert len(norm_cycles) == 2
    assert ("A", "B", "C") in norm_cycles or ("B", "C", "A") in norm_cycles or ("C", "A", "B") in norm_cycles
    assert ("D", "E") in norm_cycles or ("E", "D") in norm_cycles
""",
    },
    "task_10": {
        "impl": """class QueryEngine:
    def __init__(self, records):
        self.records = records

    def execute(self, query):
        results = self.records
        if "filter" in query:
            field, op, val = query["filter"].split(" ", 2)
            if op == "==":
                results = [r for r in results if r.get(field) == val]
            elif op == ">":
                results = [r for r in results if r.get(field) > val]
        if "sort_by" in query:
            results.sort(key=lambda r: r.get(query["sort_by"]))
        if "limit" in query:
            results = results[:query["limit"]]
        return results
""",
        "test": """from solution import QueryEngine

def test_query_engine():
    data = [
        {"id": 1, "score": 85, "dept": "eng"},
        {"id": 2, "score": 92, "dept": "sales"},
        {"id": 3, "score": 78, "dept": "eng"},
        {"id": 4, "score": 95, "dept": "eng"},
        {"id": 5, "score": 88, "dept": "hr"},
    ]
    engine = QueryEngine(data)

    res1 = engine.execute({"filter": "dept == eng", "sort_by": "score"})
    assert [r["id"] for r in res1] == [3, 1, 4]

    res2 = engine.execute({"filter": "score > 85", "sort_by": "score", "limit": 2})
    assert [r["id"] for r in res2] == [5, 2]

    res3 = engine.execute({})
    assert len(res3) == 5
""",
    },
}

def setup_benchmark(base_dir="benchmark_tasks"):
    root = Path(base_dir)
    root.mkdir(parents=True, exist_ok=True)
    for task_name, contents in TASKS.items():
        task_dir = root / task_name
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / "solution.py").write_text(contents["impl"])
        (task_dir / "test_solution.py").write_text(contents["test"])

if __name__ == "__main__":
    setup_benchmark()