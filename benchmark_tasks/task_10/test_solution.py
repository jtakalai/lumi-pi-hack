from solution import QueryEngine

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
