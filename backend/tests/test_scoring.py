from app.fx import to_usd
from app.matching.scoring import CandidateFeatures, JobFeatures, Weights, score_match
from app.skills import normalize_skills


def candidate(**overrides) -> CandidateFeatures:
    values = {
        "skills": frozenset({"python", "react"}),
        "years_experience": 5.0,
        "remote_preference": "remote",
        "utc_offset": 1.0,
        "salary_usd": 90000,
        "embedding": (1.0, 0.0),
    }
    return CandidateFeatures(**{**values, **overrides})


def job(**overrides) -> JobFeatures:
    values = {
        "required_skills": frozenset({"python", "react"}),
        "nice_skills": frozenset(),
        "min_years": 5.0,
        "location_type": "remote",
        "tz_min": -2.0,
        "tz_max": 3.0,
        "salary_usd_max": 100000,
        "embedding": (1.0, 0.0),
    }
    return JobFeatures(**{**values, **overrides})


def test_perfect_match_scores_100():
    assert score_match(candidate(), job()).total == 100


def test_more_required_skills_ranks_higher():
    full = score_match(candidate(), job())
    partial = score_match(candidate(skills=frozenset({"python"})), job())
    none = score_match(candidate(skills=frozenset()), job())
    assert full.total > partial.total > none.total


def test_breakdown_lists_matched_and_missing_skills():
    result = score_match(
        candidate(skills=frozenset({"python", "docker"})),
        job(nice_skills=frozenset({"docker", "aws"})),
    )
    assert result.matched_required == ("python",)
    assert result.missing_required == ("react",)
    assert result.matched_nice == ("docker",)
    assert result.missing_nice == ("aws",)


def test_required_skills_count_more_than_nice_to_have():
    target = job(required_skills=frozenset({"python"}), nice_skills=frozenset({"go"}))
    has_required = score_match(candidate(skills=frozenset({"python"})), target)
    has_nice = score_match(candidate(skills=frozenset({"go"})), target)
    assert has_required.total > has_nice.total


def test_experience_is_proportional_and_capped():
    assert score_match(candidate(years_experience=2.5), job()).experience == 7.5
    assert score_match(candidate(years_experience=20), job()).experience == 15


def test_missing_embedding_scores_zero_similarity():
    assert score_match(candidate(embedding=None), job()).semantic == 0


def test_weights_are_normalized_and_change_ranking():
    specialist = candidate(skills=frozenset({"python", "react"}), years_experience=1)
    veteran = candidate(skills=frozenset(), years_experience=20)
    skills_first = Weights(skills=100, semantic=0, experience=0, logistics=0)
    experience_first = Weights(skills=0, semantic=0, experience=100, logistics=0)
    assert score_match(specialist, job(), skills_first).total == 100
    assert (
        score_match(specialist, job(), skills_first).total
        > score_match(veteran, job(), skills_first).total
    )
    assert (
        score_match(veteran, job(), experience_first).total
        > score_match(specialist, job(), experience_first).total
    )


def test_score_is_deterministic():
    assert score_match(candidate(), job()) == score_match(candidate(), job())


def test_fx_conversion():
    assert to_usd(100000, "EUR") == 108000
    assert to_usd(None, "EUR") is None


def test_skill_aliases_collapse():
    assert normalize_skills(["ReactJS", "react", " Node ", "k8s", ""]) == [
        "react",
        "node.js",
        "kubernetes",
    ]
