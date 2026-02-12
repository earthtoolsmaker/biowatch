"""Unit tests for detection utility functions.

Tests for to_detection_record, select_best_animal_detection,
to_classifications_record, and propagate_extra_fields.
"""

from detection_utils import (
    propagate_extra_fields,
    select_best_animal_detection,
    to_classifications_record,
    to_detection_record,
)


class TestToDetectionRecord:
    """Tests for the to_detection_record function."""

    def test_builds_record_with_valid_inputs(self):
        """Test that a record is built with all expected keys and values."""
        class_label_mapping = {0: "animal", 1: "person", 2: "vehicle"}
        result = to_detection_record(
            conf=0.95,
            class_instance=0,
            xywhn=[0.5, 0.5, 0.2, 0.3],
            xyxy=[100, 120, 300, 420],
            class_label_mapping=class_label_mapping,
        )
        assert result == {
            "class": 0,
            "label": "animal",
            "conf": 0.95,
            "xyxy": [100, 120, 300, 420],
            "xywhn": [0.5, 0.5, 0.2, 0.3],
        }

    def test_label_is_looked_up_from_mapping(self):
        """Test that the label comes from class_label_mapping, not the index."""
        class_label_mapping = {0: "animal", 1: "person", 2: "vehicle"}
        result = to_detection_record(
            conf=0.80,
            class_instance=2,
            xywhn=[0.1, 0.2, 0.3, 0.4],
            xyxy=[10, 20, 30, 40],
            class_label_mapping=class_label_mapping,
        )
        assert result["class"] == 2
        assert result["label"] == "vehicle"


class TestSelectBestAnimalDetection:
    """Tests for the select_best_animal_detection function."""

    def test_empty_list_returns_none(self):
        """Test that an empty list of records returns None."""
        assert select_best_animal_detection([]) is None

    def test_single_animal_record_returns_it(self):
        """Test that a single animal record is returned as-is."""
        record = {"label": "animal", "conf": 0.9, "class": 0}
        assert select_best_animal_detection([record]) == record

    def test_multiple_animal_records_returns_highest_confidence(self):
        """Test that the animal record with the highest confidence is returned."""
        records = [
            {"label": "animal", "conf": 0.7, "class": 0},
            {"label": "animal", "conf": 0.95, "class": 0},
            {"label": "animal", "conf": 0.85, "class": 0},
        ]
        result = select_best_animal_detection(records)
        assert result["conf"] == 0.95

    def test_non_animal_records_only_returns_none(self):
        """Test that only non-animal records (e.g. vehicle) returns None."""
        records = [
            {"label": "vehicle", "conf": 0.99, "class": 2},
            {"label": "person", "conf": 0.85, "class": 1},
        ]
        assert select_best_animal_detection(records) is None

    def test_mix_of_animal_and_non_animal_returns_best_animal(self):
        """Test that a mix of labels returns the best animal detection."""
        records = [
            {"label": "vehicle", "conf": 0.99, "class": 2},
            {"label": "animal", "conf": 0.80, "class": 0},
            {"label": "person", "conf": 0.95, "class": 1},
            {"label": "animal", "conf": 0.60, "class": 0},
        ]
        result = select_best_animal_detection(records)
        assert result["label"] == "animal"
        assert result["conf"] == 0.80


class TestToClassificationsRecord:
    """Tests for the to_classifications_record function."""

    def test_returns_top_5_by_default_sorted_descending(self):
        """Test that top-5 labels/scores are returned sorted by score descending."""
        class_label_mapping = {
            0: "badger",
            1: "fox",
            2: "chamois",
            3: "deer",
            4: "hedgehog",
            5: "marten",
            6: "squirrel",
        }
        scores = [0.05, 0.30, 0.10, 0.40, 0.02, 0.08, 0.05]
        result = to_classifications_record(scores, class_label_mapping)

        assert len(result["labels"]) == 5
        assert len(result["scores"]) == 5
        assert result["labels"] == ["deer", "fox", "chamois", "marten", "badger"]
        assert result["scores"] == [0.40, 0.30, 0.10, 0.08, 0.05]

    def test_custom_k_parameter(self):
        """Test that k=3 returns only 3 results."""
        class_label_mapping = {0: "a", 1: "b", 2: "c", 3: "d", 4: "e"}
        scores = [0.1, 0.5, 0.2, 0.15, 0.05]
        result = to_classifications_record(scores, class_label_mapping, k=3)

        assert len(result["labels"]) == 3
        assert len(result["scores"]) == 3
        assert result["labels"] == ["b", "c", "d"]
        assert result["scores"] == [0.5, 0.2, 0.15]

    def test_k_larger_than_number_of_classes(self):
        """Test that k larger than the number of classes returns all classes."""
        class_label_mapping = {0: "fox", 1: "badger", 2: "deer"}
        scores = [0.6, 0.3, 0.1]
        result = to_classifications_record(scores, class_label_mapping, k=10)

        assert len(result["labels"]) == 3
        assert len(result["scores"]) == 3
        assert result["labels"] == ["fox", "badger", "deer"]
        assert result["scores"] == [0.6, 0.3, 0.1]

    def test_scores_of_zero_handled_correctly(self):
        """Test that scores of 0.0 are included and handled correctly."""
        class_label_mapping = {0: "a", 1: "b", 2: "c"}
        scores = [0.0, 0.5, 0.0]
        result = to_classifications_record(scores, class_label_mapping, k=3)

        assert result["labels"] == ["b", "a", "c"]
        assert result["scores"] == [0.5, 0.0, 0.0]


class TestPropagateExtraFields:
    """Tests for the propagate_extra_fields function."""

    def test_empty_extra_fields_returns_predictions_unchanged(self):
        """Test that an empty extra_fields list returns predictions as-is."""
        predictions_dict = {"predictions": [{"filepath": "img1.jpg", "label": "fox"}]}
        instances_dict = {"instances": [{"filepath": "img1.jpg", "camera_id": "cam1"}]}
        result = propagate_extra_fields([], instances_dict, predictions_dict)
        assert result == {"predictions": [{"filepath": "img1.jpg", "label": "fox"}]}

    def test_single_extra_field_is_propagated(self):
        """Test that a single extra field is copied from instance to prediction."""
        instances_dict = {"instances": [{"filepath": "img1.jpg", "camera_id": "cam1"}]}
        predictions_dict = {"predictions": [{"filepath": "img1.jpg", "label": "fox"}]}
        result = propagate_extra_fields(["camera_id"], instances_dict, predictions_dict)
        assert result["predictions"][0]["camera_id"] == "cam1"
        assert result["predictions"][0]["label"] == "fox"

    def test_multiple_extra_fields_are_propagated(self):
        """Test that multiple extra fields are propagated."""
        instances_dict = {"instances": [{"filepath": "img1.jpg", "camera_id": "cam1", "location": "forest"}]}
        predictions_dict = {"predictions": [{"filepath": "img1.jpg", "label": "fox"}]}
        result = propagate_extra_fields(["camera_id", "location"], instances_dict, predictions_dict)
        pred = result["predictions"][0]
        assert pred["camera_id"] == "cam1"
        assert pred["location"] == "forest"

    def test_missing_field_in_instance_is_skipped(self):
        """Test that a missing field in instance does not raise KeyError."""
        instances_dict = {"instances": [{"filepath": "img1.jpg"}]}
        predictions_dict = {"predictions": [{"filepath": "img1.jpg", "label": "fox"}]}
        result = propagate_extra_fields(["nonexistent_field"], instances_dict, predictions_dict)
        assert "nonexistent_field" not in result["predictions"][0]
        assert result["predictions"][0]["label"] == "fox"

    def test_multiple_instances_get_their_own_extra_fields(self):
        """Test that each instance propagates its own extra fields."""
        instances_dict = {
            "instances": [
                {"filepath": "img1.jpg", "camera_id": "cam1"},
                {"filepath": "img2.jpg", "camera_id": "cam2"},
            ]
        }
        predictions_dict = {
            "predictions": [
                {"filepath": "img1.jpg", "label": "fox"},
                {"filepath": "img2.jpg", "label": "badger"},
            ]
        }
        result = propagate_extra_fields(["camera_id"], instances_dict, predictions_dict)
        preds = {p["filepath"]: p for p in result["predictions"]}
        assert preds["img1.jpg"]["camera_id"] == "cam1"
        assert preds["img2.jpg"]["camera_id"] == "cam2"
