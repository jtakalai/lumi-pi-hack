class QueryEngine:
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
