"""Small dependency-free checks for configurable VOD title cleanup."""

import unittest

from apps.vod.title_cleanup import (
    clean_lookup_title,
    extract_year_from_title,
    normalize_group_title_cleanup,
    normalize_title_rules,
    normalize_year_rules,
)


class VODTitleCleanupTests(unittest.TestCase):
    def test_global_cleanup_precedes_category_removal(self):
        title = "(DE-) -1- Die Verurteilten - 1994"
        self.assertEqual(
            clean_lookup_title(
                title,
                rules=["(DE-)"],
                group_rule={"pattern": r"-\d+-"},
            ),
            "Die Verurteilten",
        )
        self.assertEqual(extract_year_from_title(title), 1994)

    def test_category_rule_can_remove_quality_without_changing_year(self):
        self.assertEqual(
            clean_lookup_title(
                "(DE-) (Pri)sons 4K - 2024",
                rules=["(DE-)"],
                group_rule={"pattern": r"\b4K\b"},
            ),
            "(Pri)sons",
        )
        self.assertEqual(extract_year_from_title("(DE-) (Pri)sons 4K - 2024"), 2024)

    def test_invalid_rules_are_rejected(self):
        with self.assertRaises(ValueError):
            normalize_group_title_cleanup({"pattern": "("})
        with self.assertRaises(ValueError):
            normalize_title_rules([""])
        with self.assertRaises(ValueError):
            normalize_year_rules(["YYYY YYYY"])

    def test_year_requires_configured_format(self):
        self.assertIsNone(
            extract_year_from_title(
                "Title [2024]", [{"value": "(YYYY)", "position": "end"}]
            )
        )


if __name__ == "__main__":
    unittest.main()
