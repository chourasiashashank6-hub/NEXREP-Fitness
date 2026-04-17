def compute_discipline_score(workouts_per_week: int, meals_logged: int, activity_logs: int) -> int:
    score = workouts_per_week * 15 + meals_logged * 4 + activity_logs * 3
    return max(0, min(100, score))
