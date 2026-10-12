"""Regression tests for failed, partial, late and DST-day source responses."""
import copy
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import data_utils
import fetch_fx as fx
import fetch_prices as prices
import fetch_tariffs as tariffs
import publish_pages as pages

NOW = datetime(2026, 10, 12, 16, tzinfo=prices.COPENHAGEN)


def records_for(day):
    start = datetime.combine(day, datetime.min.time(), prices.COPENHAGEN).astimezone(timezone.utc)
    stop = datetime.combine(day + timedelta(days=1), datetime.min.time(), prices.COPENHAGEN).astimezone(timezone.utc)
    result = []
    while start < stop:
        for area in prices.AREAS:
            result.append({"PriceArea": area, "TimeUTC": start.isoformat(), "DayAheadPriceDKK": -125.0})
        start += timedelta(minutes=15)
    return result


def full_records(now=NOW):
    return records_for(now.date()) + records_for(now.date() + timedelta(days=1))


def xml(rate="66,76", day="2026-10-12", currency="SEK", reference="DKK"):
    return (f'\ufeff<?xml version="1.0" encoding="utf-8"?>'
            f'<exchangerates refcur="{reference}" refamt="1">'
            f'<dailyrates id="{day}"><currency code="{currency}" rate="{rate}" />'
            '</dailyrates></exchangerates>').encode("utf-8")


class FileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "data.json"
        self.start_patch(patch.dict("os.environ", {"GITHUB_ACTIONS": "false", "GITHUB_STEP_SUMMARY": ""}))
        self.start_patch(redirect_stdout(io.StringIO()))
        self.start_patch(redirect_stderr(io.StringIO()))

    def start_patch(self, manager):
        result = manager.__enter__()
        self.addCleanup(manager.__exit__, None, None, None)
        return result

    def save(self, payload):
        self.out.write_text(json.dumps(payload), encoding="utf-8")
        return self.out.read_bytes()


class PriceTests(FileTest):
    def setUp(self):
        super().setUp()
        self.start_patch(patch.object(prices, "OUT", self.out))

    def test_complete_all_areas_and_negative_price_conversion(self):
        payload = prices.build_payload(full_records(), now=NOW)
        self.assertTrue(payload["coverage"]["today_complete"])
        self.assertTrue(payload["coverage"]["tomorrow_complete"])
        self.assertEqual(payload["coverage"]["tomorrow_counts"], dict.fromkeys(prices.AREAS, 96))
        self.assertEqual(payload["areas"]["SE4"][0]["price_ore_kwh"], -12.5)

    def test_dst_calendar_days_have_exact_utc_coverage(self):
        for day, count in ((date(2026, 3, 29), 92), (date(2026, 10, 25), 100), (date(2026, 10, 13), 96)):
            with self.subTest(day=day):
                self.assertEqual(prices.expected_quarters(day), count)
                now = datetime.combine(day - timedelta(days=1), datetime.min.time(), prices.COPENHAGEN)
                payload = prices.build_payload(full_records(now), now=now)
                self.assertEqual(payload["coverage"]["tomorrow_counts"], dict.fromkeys(prices.AREAS, count))
                self.assertTrue(payload["coverage"]["tomorrow_complete"])

    def test_duplicate_cannot_hide_a_missing_interval(self):
        records = full_records()
        records[-1] = copy.deepcopy(records[-4])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            prices.build_payload(records, now=NOW)

    def test_invalid_numbers_and_malformed_records_are_rejected(self):
        for value in (float("nan"), float("inf"), -float("inf"), True, "not-a-price", None):
            with self.subTest(value=value):
                records = full_records()
                records[0]["DayAheadPriceDKK"] = value
                with self.assertRaises((ValueError, TypeError)):
                    prices.build_payload(records, now=NOW)
        for record in ({}, "bad", {"PriceArea": "NO1"}):
            with self.assertRaises(ValueError):
                prices.build_payload([record], now=NOW)

    def test_off_grid_times_are_rejected_before_formatting(self):
        for stamp in ("2026-10-12T00:01:00Z", "2026-10-12T00:00:01Z", "2026-10-12T00:00:00.1Z"):
            records = full_records()
            records[0]["TimeUTC"] = stamp
            with self.assertRaisesRegex(ValueError, "off-grid"):
                prices.build_payload(records, now=NOW)

    def test_partial_new_day_keeps_complete_cached_day(self):
        existing = prices.build_payload(full_records(), now=NOW)
        payload = prices.build_payload(full_records()[:-1], existing, NOW)
        self.assertTrue(payload["coverage"]["tomorrow_complete"])
        self.assertEqual(payload["areas"], existing["areas"])

    def test_cache_for_other_dates_does_not_satisfy_today(self):
        old_now = NOW - timedelta(days=3)
        existing = prices.build_payload(full_records(old_now), now=old_now)
        payload = prices.build_payload(records_for(NOW.date() + timedelta(days=1)), existing, NOW)
        self.assertFalse(payload["coverage"]["today_complete"])

    def test_corrupt_cached_day_not_treated_as_complete(self):
        existing = prices.build_payload(full_records(), now=NOW)
        existing["areas"]["DK1"][-1] = copy.deepcopy(existing["areas"]["DK1"][-2])
        payload = prices.build_payload(records_for(NOW.date()), existing, NOW)
        self.assertFalse(payload["coverage"]["tomorrow_complete"])

    def test_transport_failure_preserves_file_byte_for_byte(self):
        before = self.save(prices.build_payload(full_records(), now=NOW))
        with patch.object(prices, "fetch_records", side_effect=TimeoutError("unavailable")):
            self.assertEqual(data_utils.run(lambda: prices.update(now=NOW)), 1)
        self.assertEqual(self.out.read_bytes(), before)

    def test_missing_today_preserves_file_byte_for_byte(self):
        old_now = NOW - timedelta(days=3)
        before = self.save(prices.build_payload(full_records(old_now), now=old_now))
        with patch.object(prices, "fetch_records", return_value=records_for(NOW.date() + timedelta(days=1))):
            self.assertEqual(data_utils.run(lambda: prices.update(now=NOW)), 1)
        self.assertEqual(self.out.read_bytes(), before)

    def test_missing_tomorrow_before_deadline_warns(self):
        with patch.object(prices, "fetch_records", return_value=records_for(NOW.date())):
            self.assertEqual(prices.update(now=NOW.replace(hour=14)), 0)
        self.assertFalse(json.loads(self.out.read_text())["coverage"]["tomorrow_complete"])

    def test_missing_tomorrow_after_deadline_fails_but_keeps_valid_today(self):
        with patch.object(prices, "fetch_records", return_value=records_for(NOW.date())):
            self.assertEqual(prices.update(now=NOW.replace(hour=15)), 1)
        payload = json.loads(self.out.read_text())
        self.assertTrue(payload["coverage"]["today_complete"])
        self.assertFalse(payload["coverage"]["tomorrow_complete"])

    def test_publication_retry_succeeds_and_stops_early(self):
        with patch.object(prices, "fetch_records", side_effect=[records_for(NOW.date()), full_records()]) as fetch, patch.object(prices.time, "sleep") as sleep:
            self.assertEqual(prices.update(attempts=3, now=NOW), 0)
        self.assertEqual(fetch.call_count, 2)
        sleep.assert_called_once_with(60)

    def test_morning_does_not_poll_unpublished_tomorrow(self):
        with patch.object(prices, "fetch_records", return_value=records_for(NOW.date())) as fetch, patch.object(prices.time, "sleep") as sleep:
            self.assertEqual(prices.update(attempts=3, now=NOW.replace(hour=7)), 0)
        fetch.assert_called_once()
        sleep.assert_not_called()

    def test_api_response_rejects_empty_missing_and_truncated(self):
        for payload in ({}, {"records": []}, {"records": full_records(), "total": 10000}):
            with patch.object(prices, "request_bytes", return_value=json.dumps(payload).encode()):
                with self.assertRaises(ValueError):
                    prices.fetch_records(NOW)

    def test_api_bounds_are_local_dates_and_exclusive_end(self):
        with patch.object(prices, "request_bytes", return_value=json.dumps({"records": full_records()}).encode()) as request:
            prices.fetch_records(NOW)
        query = prices.urllib.parse.parse_qs(prices.urllib.parse.urlparse(request.call_args.args[0]).query)
        self.assertEqual(query["start"], ["2026-10-11"])
        self.assertEqual(query["end"], ["2026-10-14"])


class FxTests(FileTest):
    def setUp(self):
        super().setUp()
        self.start_patch(patch.object(fx, "OUT", self.out))
        clock = self.start_patch(patch.object(fx, "datetime", wraps=datetime))
        clock.now.return_value = NOW

    def test_documented_xml_units_decimal_comma_and_date(self):
        payload = fx.build_payload(xml(), NOW)
        self.assertEqual(payload["sek_dkk"], 0.6676)
        self.assertEqual(payload["rate_date"], "2026-10-12")
        self.assertTrue(payload["generated_at"].endswith("Z"))

    def test_weekend_accepts_last_published_business_day(self):
        payload = fx.build_payload(xml(day="2026-10-09"), NOW)
        self.assertEqual(payload["rate_date"], "2026-10-09")

    def test_invalid_xml_reference_currency_and_numbers(self):
        invalid = [b"<html>bad", xml(currency="EUR"), xml(reference="EUR")]
        invalid += [xml(rate=rate) for rate in ("NaN", "Infinity", "0", "100", "-60", "bad")]
        invalid += [xml(day=day) for day in ("2026-10-13", "2026-10-04", "invalid")]
        invalid += [xml().replace(b"</dailyrates>", b'<currency code="SEK" rate="66,76" /></dailyrates>')]
        for content in invalid:
            with self.subTest(content=content):
                with self.assertRaises((ValueError, fx.ET.ParseError)):
                    fx.build_payload(content, NOW)

    def test_same_rate_new_date_is_written(self):
        self.save(fx.build_payload(xml(day="2026-10-09"), NOW))
        with patch.object(fx, "request_bytes", return_value=xml()):
            self.assertEqual(fx.main(), 0)
        self.assertEqual(json.loads(self.out.read_text())["rate_date"], "2026-10-12")

    def test_legacy_null_timestamp_is_repaired_even_when_rate_unchanged(self):
        self.save({"generated_at": None, "sek_dkk": 0.6676})
        with patch.object(fx, "request_bytes", return_value=xml()):
            fx.main()
        self.assertIsNotNone(json.loads(self.out.read_text())["generated_at"])

    def test_unchanged_observation_does_not_rewrite_file(self):
        before = self.save(fx.build_payload(xml(), NOW))
        with patch.object(fx, "request_bytes", return_value=xml()):
            fx.main()
        self.assertEqual(self.out.read_bytes(), before)

    def test_bad_or_older_response_preserves_file(self):
        before = self.save(fx.build_payload(xml(), NOW))
        for content in (b"<html>bad", xml(day="2026-10-09")):
            with patch.object(fx, "request_bytes", return_value=content):
                self.assertEqual(data_utils.run(fx.main), 1)
            self.assertEqual(self.out.read_bytes(), before)
        with patch.object(fx, "request_bytes", side_effect=TimeoutError()):
            self.assertEqual(data_utils.run(fx.main), 1)
        self.assertEqual(self.out.read_bytes(), before)


class StorageAndTransportTests(FileTest):
    def test_nonfinite_json_never_replaces_previous_file(self):
        before = self.save({"valid": True})
        with self.assertRaises(ValueError):
            data_utils.write_json(self.out, {"price": float("nan")})
        self.assertEqual(self.out.read_bytes(), before)

    def test_failed_atomic_replace_preserves_previous_file(self):
        before = self.save({"valid": True})
        with patch.object(Path, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                data_utils.write_json(self.out, {"valid": "new"})
        self.assertEqual(self.out.read_bytes(), before)
        self.assertFalse(self.out.with_suffix(".json.tmp").exists())

    def test_transient_http_failure_retried(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"ok"
        failure = urllib.error.HTTPError("https://example.test", 503, "unavailable", {}, None)
        with patch.object(data_utils.urllib.request, "urlopen", side_effect=[failure, response]) as request, patch.object(data_utils.time, "sleep") as sleep:
            self.assertEqual(data_utils.request_bytes("https://example.test"), b"ok")
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_http_404_is_not_retried(self):
        failure = urllib.error.HTTPError("https://example.test", 404, "missing", {}, None)
        with patch.object(data_utils.urllib.request, "urlopen", side_effect=failure) as request, patch.object(data_utils.time, "sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                data_utils.request_bytes("https://example.test")
        request.assert_called_once()
        sleep.assert_not_called()

    def test_actions_annotation_escapes_source_text(self):
        output = io.StringIO()
        with patch.dict("os.environ", {"GITHUB_ACTIONS": "true"}), redirect_stdout(output):
            data_utils.diagnostic("error", "bad%\n::warning::injected")
        self.assertEqual(output.getvalue(), "::error::bad%25%0A::warning::injected\n")


class TariffTests(FileTest):
    def test_nonfinite_or_negative_tariffs_rejected(self):
        for value in (float("nan"), float("inf"), -1):
            with self.assertRaises(ValueError):
                tariffs.hourly_prices({"Price1": value})

    def test_empty_tariff_response_preserves_previous_file(self):
        before = self.save({"profiles": [{"id": "existing"}]})
        with patch.object(tariffs, "OUT", self.out), patch.object(tariffs, "fetch_records", return_value=[]):
            self.assertEqual(data_utils.run(tariffs.main), 1)
        self.assertEqual(self.out.read_bytes(), before)

    def test_disappearing_current_profile_preserves_previous_file(self):
        before = self.save({"profiles": [{"id": "missing", "valid_to": None}]})
        with patch.object(tariffs, "OUT", self.out), patch.object(tariffs, "fetch_records", return_value=[]), patch.object(tariffs, "profile_for_company", return_value={"id": "present"}):
            self.assertEqual(data_utils.run(tariffs.main), 1)
        self.assertEqual(self.out.read_bytes(), before)


class PagesTests(FileTest):
    SITE = {"source": {"branch": "main", "path": "/"}, "build_type": "legacy", "html_url": "https://example.test/elpris/"}

    def test_current_build_does_not_trigger_duplicate(self):
        with patch.object(pages, "api", side_effect=[self.SITE, {"commit": "new", "status": "built"}]) as api:
            pages.publish("owner/repo", "new")
        self.assertEqual(api.call_count, 2)

    def test_bot_commit_requests_and_verifies_new_build(self):
        with patch.object(pages, "api", side_effect=[self.SITE, {"commit": "old", "status": "built"}, {"status": "queued"}, {"commit": "old", "status": "built"}, {"commit": "new", "status": "built"}]) as api, patch.object(pages.time, "sleep"):
            pages.publish("owner/repo", "new")
        self.assertIn(unittest.mock.call("repos/owner/repo/pages/builds", "POST"), api.call_args_list)

    def test_running_build_is_awaited_without_duplicate(self):
        with patch.object(pages, "api", side_effect=[self.SITE, {"commit": "new", "status": "building"}, {"commit": "new", "status": "built"}]) as api:
            pages.publish("owner/repo", "new")
        self.assertTrue(all(len(call.args) == 1 for call in api.call_args_list))

    def test_wrong_commit_cannot_be_reported_as_published(self):
        with patch.object(pages, "api", side_effect=[self.SITE, {"commit": "old", "status": "built"}, {}, {"commit": "old", "status": "built"}]):
            with self.assertRaisesRegex(RuntimeError, "did not confirm"):
                pages.publish("owner/repo", "new", attempts=1)

    def test_failed_build_is_reported(self):
        with patch.object(pages, "api", side_effect=[self.SITE, {"commit": "new", "status": "building"}, {"commit": "new", "status": "errored", "error": {"message": "bad build"}}]):
            with self.assertRaisesRegex(RuntimeError, "bad build"):
                pages.publish("owner/repo", "new")

    def test_wrong_pages_configuration_is_reported_without_mutation(self):
        with patch.object(pages, "api", return_value={"source": {"branch": "main", "path": "/docs"}}) as api:
            with self.assertRaisesRegex(RuntimeError, "Settings > Pages"):
                pages.publish("owner/repo", "new")
        api.assert_called_once()


if __name__ == "__main__":
    unittest.main()
