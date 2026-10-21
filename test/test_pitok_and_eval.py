import importlib.machinery
import importlib.util
import json
from pathlib import Path
import pytest

# Ladataan pitok/pitok -skripti moduulina ilman .py-päätettä
PITOK_PATH = Path(__file__).resolve().parent.parent / "pitok" / "pitok"
loader = importlib.machinery.SourceFileLoader("pitok", str(PITOK_PATH))
spec = importlib.util.spec_from_loader("pitok", loader)
pitok = importlib.util.module_from_spec(spec)
loader.exec_module(pitok)


@pytest.fixture
def mock_handoff_session(tmp_path: Path) -> Path:
    """
    Luo synteettisen pi-istuntotiedoston (.jsonl), jossa:
    - Episodi 1 alkaa CHEAP-mallilla (haiku)
    - Kaksi epäonnistumista kasvattaa riskiä -> eskalointi STRONG-malliin (opus)
    - Episodiraja palauttaa suorituksen CHEAP-malliin
    """
    session_file = tmp_path / "session_handoff_test.jsonl"
    entries = [
        {
            "type": "session",
            "id": "sess-001",
            "cwd": "/workspace/project",
            "timestamp": "2026-10-21T10:00:00Z",
        },
        {
            "type": "session_info",
            "name": "e2e_cascade_test",
            "timestamp": "2026-10-21T10:00:01Z",
        },
        # 1. CHEAP-mallin kutsu (Ep-1)
        {
            "id": "msg-1",
            "parentId": None,
            "type": "message",
            "timestamp": "2026-10-21T10:01:00Z",
            "message": {
                "role": "assistant",
                "provider": "anthropic",
                "model": "anthropic/claude-haiku-4-5",
                "usage": {
                    "input": 1000,
                    "output": 200,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "totalTokens": 1200,
                    "cost": {"total": 0.001},
                },
            },
        },
        # 2. Handoff-tilan tallennus: Eskalointi STRONG_LOCKED-tilaan
        {
            "id": "state-1",
            "parentId": "msg-1",
            "type": "custom",
            "customType": "pi.virtual-model-state",
            "timestamp": "2026-10-21T10:02:00Z",
            "data": {
                "phase": "STRONG_LOCKED",
                "risk": 4,
                "episodeId": "ep-1",
                "escalations": 1,
            },
        },
        # 3. STRONG-mallin kutsu (Ep-1 korjaus)
        {
            "id": "msg-2",
            "parentId": "state-1",
            "type": "message",
            "timestamp": "2026-10-21T10:02:30Z",
            "message": {
                "role": "assistant",
                "provider": "anthropic",
                "model": "anthropic/claude-opus-4-5",
                "usage": {
                    "input": 2500,
                    "output": 500,
                    "cacheRead": 1000,
                    "cacheWrite": 0,
                    "totalTokens": 4000,
                    "cost": {"total": 0.045},
                },
            },
        },
        # 4. Episodiraja (ep-2) ja paluu CHEAP-malliin
        {
            "id": "ep-bound-1",
            "parentId": "msg-2",
            "type": "custom",
            "customType": "pi-episodes:state",
            "timestamp": "2026-10-21T10:03:00Z",
            "data": {"counter": 2, "episodeId": "ep-2", "kind": "marker"},
        },
        {
            "id": "msg-3",
            "parentId": "ep-bound-1",
            "type": "message",
            "timestamp": "2026-10-21T10:03:30Z",
            "message": {
                "role": "assistant",
                "provider": "anthropic",
                "model": "anthropic/claude-haiku-4-5",
                "usage": {
                    "input": 500,
                    "output": 100,
                    "cacheRead": 500,
                    "cacheWrite": 0,
                    "totalTokens": 1100,
                    "cost": {"total": 0.0008},
                },
            },
        },
    ]

    with session_file.open("w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    return session_file


def test_pitok_token_and_cost_attribution(mock_handoff_session: Path):
    """Varmistaa, että pitok erottelee CHEAP- ja STRONG-mallien tokenit ja kustannukset oikein."""
    result = pitok.analyze(str(mock_handoff_session))

    assert result["name"] == "e2e_cascade_test"
    assert result["total"]["requests"] == 3
    assert result["total"]["total"] == 1200 + 4000 + 1100
    assert result["total"]["cost"] == pytest.approx(0.0468)

    by_model = result["by_model"]
    assert "anthropic/claude-haiku-4-5" in by_model
    assert "anthropic/claude-opus-4-5" in by_model

    # Haiku (Cheap): 2 pyyntöä (Ep-1 alku ja Ep-2 paluu)
    haiku = by_model["anthropic/claude-haiku-4-5"]
    assert haiku["requests"] == 2
    assert haiku["total"] == 2300

    # Opus (Strong): 1 pyyntö (vain Ep-1 eskaloinnin jälkeen)
    opus = by_model["anthropic/claude-opus-4-5"]
    assert opus["requests"] == 1
    assert opus["total"] == 4000


def test_pitok_ignores_abandoned_branches(tmp_path: Path):
    """Varmistaa, että /tree-haaroituksessa hylätty haara ei vääristä oletuslaskentaa."""
    session_file = tmp_path / "branched.jsonl"
    entries = [
        {"id": "root", "parentId": None, "type": "message", "timestamp": "2026-10-21T10:00:00Z",
         "message": {"role": "assistant", "model": "cheap", "usage": {"totalTokens": 100}}},
        # Hylätty haara (vanhempi aikaleima)
        {"id": "dead-branch", "parentId": "root", "type": "message", "timestamp": "2026-10-21T10:01:00Z",
         "message": {"role": "assistant", "model": "strong", "usage": {"totalTokens": 9000}}},
        # Aktiivinen haara (tuoreempi aikaleima)
        {"id": "active-leaf", "parentId": "root", "type": "message", "timestamp": "2026-10-21T10:05:00Z",
         "message": {"role": "assistant", "model": "cheap", "usage": {"totalTokens": 200}}},
    ]
    session_file.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    active_only = pitok.analyze(str(session_file), all_branches=False)
    all_branches = pitok.analyze(str(session_file), all_branches=True)

    assert active_only["total"]["total"] == 300
    assert "strong" not in active_only["by_model"]
    assert all_branches["total"]["total"] == 9300