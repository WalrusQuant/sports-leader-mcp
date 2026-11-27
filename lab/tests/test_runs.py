"""Run and dataset ids cannot escape the run store."""

import joblib
import pandas as pd
import pytest

from sports_leader_lab.errors import LabError
from sports_leader_lab.runs import load_dataset, load_run, save_dataset, save_run
from sports_leader_lab.store import RunStore


def test_load_run_rejects_traversal_cross_kind_and_garbage(tmp_path):
    store = RunStore(tmp_path / "runs")
    outside = tmp_path / "x"
    outside.mkdir()
    joblib.dump({"loaded": True}, outside / "model.joblib")
    (outside / "meta.json").write_text("{}\n", encoding="utf-8")

    frame = pd.DataFrame({"game_id": [1], "target": [1.0]})
    dataset_id = "dataset_0123456789ab"
    save_dataset(store, dataset_id, frame, {"dataset_id": dataset_id})

    with pytest.raises(LabError, match="illegal"):
        load_run(store, "../../../x")
    with pytest.raises(LabError, match="illegal"):
        load_run(store, f"../datasets/{dataset_id}")
    with pytest.raises(LabError, match="illegal"):
        load_run(store, dataset_id)
    for garbage in ("", "not-an-id", "run_nothexdigits", "run_0123456789a", "run_0123456789ab/extra"):
        with pytest.raises(LabError, match="illegal"):
            load_run(store, garbage)
    with pytest.raises(LabError, match="illegal"):
        load_dataset(store, "run_0123456789ab")
    with pytest.raises(LabError, match="illegal"):
        save_run(store, "../../../x", {"loaded": True}, {}, [], frame)

    loaded, meta = load_dataset(store, dataset_id)
    assert meta["dataset_id"] == dataset_id
    assert loaded["target"].tolist() == [1.0]
    assert not (outside / "folds.json").exists()


def test_a_symlink_id_cannot_unpickle_an_outside_model(tmp_path):
    store = RunStore(tmp_path / "runs")
    store.ensure()
    (store.root / "models").mkdir(exist_ok=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    joblib.dump({"loaded": True}, outside / "model.joblib")
    (outside / "meta.json").write_text("{}\n", encoding="utf-8")
    (store.root / "models" / "run_aaaaaaaaaaaa").symlink_to(outside, target_is_directory=True)
    with pytest.raises(LabError, match="illegal"):
        load_run(store, "run_aaaaaaaaaaaa")
