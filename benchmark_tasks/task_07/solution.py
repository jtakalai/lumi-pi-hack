def merge_intervals(intervals):
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
