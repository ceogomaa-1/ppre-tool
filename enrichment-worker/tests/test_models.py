import unittest

from acreline_worker.models import DiscoveryResult


class StructuredOutputSchemaTests(unittest.TestCase):
    def test_every_object_property_is_required_for_openai_strict_mode(self) -> None:
        schema = DiscoveryResult.model_json_schema()
        self.assertEqual(set(schema["required"]), set(schema["properties"]))
        self.assertFalse(schema["additionalProperties"])

        candidate = schema["$defs"]["SourceCandidate"]
        self.assertEqual(set(candidate["required"]), set(candidate["properties"]))
        self.assertFalse(candidate["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
