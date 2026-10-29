"""Tariff pagination, validity and last-known-good regression coverage."""
import json
import sys
import tempfile
import unittest
import urllib.parse
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import data_utils
import fetch_tariffs as tariffs

NOW = datetime(2026, 10, 29, 11, 14, tzinfo=tariffs.COPENHAGEN)
COMPANY = next(c for c in tariffs.COMPANIES if c['id'] == 'konstant')


def row(**changes):
    result = dict(ChargeOwner='Konstant Net A/S - 151', GLN_Number='5790000000001',
                  ChargeType='D03', ChargeTypeCode='C', Note='Nettarif C',
                  ValidFrom='2026-10-01T00:00:00', ValidTo='2027-01-01T00:00:00',
                  Price1=0.2, ResolutionDuration='PT1H')
    result.update(changes)
    return result


def page(rows):
    return json.dumps(dict(total=len(rows), records=rows)).encode()


class CoverageTests(unittest.TestCase):
    def test_full_page_is_not_full_dataset_and_short_page_is_not_end(self):
        first = [row(ChargeTypeCode=str(i)) for i in range(10000)]
        last = row(ChargeTypeCode='old', ValidFrom='2015-01-01T00:00:00', ValidTo=None)
        with patch.object(tariffs, 'request_bytes', side_effect=[page(first), page([last]), page([])]) as request:
            records = tariffs.fetch_records()
        self.assertEqual(len(records), 10001)
        params = [urllib.parse.parse_qs(urllib.parse.urlsplit(c.args[0]).query) for c in request.call_args_list]
        self.assertEqual([p['offset'] for p in params], [['0'], ['10000'], ['10001']])
        self.assertTrue(all('start' not in p for p in params))
        self.assertIn('GLN_Number,ChargeType,ChargeTypeCode', params[0]['sort'][0])
        self.assertEqual(records[-1], last)

    def test_malformed_or_truncated_page_fails(self):
        for payload in ({}, {'records': None}, {'records': [None], 'total': 1},
                        {'records': [], 'total': 1}, {'records': [row()], 'total': 2},
                        {'records': [row()]}, {'records': [{}], 'total': 1}, []):
            with self.subTest(payload=payload), patch.object(tariffs, 'request_bytes', return_value=json.dumps(payload).encode()):
                with self.assertRaises(RuntimeError):
                    tariffs.fetch_records()

    def test_ignored_offset_or_overlapping_pages_fail(self):
        with patch.object(tariffs, 'request_bytes', side_effect=[page([row()]), page([row()])]):
            with self.assertRaisesRegex(RuntimeError, 'Repeated'):
                tariffs.fetch_records()

    def test_later_page_failure_preserves_file(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'tariffs.json'
            out.write_text('{"profiles": [{"id": "konstant", "valid_to": null}]}\n')
            before = out.read_bytes()
            with patch.object(tariffs, 'OUT', out), patch.object(tariffs, 'request_bytes', side_effect=[page([row()]), TimeoutError('source unavailable')]):
                self.assertEqual(data_utils.run(tariffs.main), 1)
            self.assertEqual(out.read_bytes(), before)

    def test_incident_profiles_on_later_page(self):
        fixture = Path(__file__).parent / 'fixtures' / 'tariffs_2026_10_29.json'
        rows = json.loads(fixture.read_text())['records']
        unrelated = row(ChargeOwner='Other grid', ChargeTypeCode='other', ValidFrom='2027-01-01T00:00:00')
        with patch.object(tariffs, 'request_bytes', side_effect=[page([unrelated]), page(rows), page([])]):
            records = tariffs.fetch_records()
        for company in tariffs.COMPANIES:
            if company['id'] in {'konstant', 'nord-energi', 'rah', 'elinord', 'forsyning-elnet'}:
                with self.subTest(company=company['id']):
                    self.assertIsNone(tariffs.profile_for_company([unrelated], company, NOW))
                    self.assertIsNotNone(tariffs.profile_for_company(records, company, NOW))


class ValidityTests(unittest.TestCase):
    def profile(self, rows, now=NOW):
        return tariffs.profile_for_company(rows, COMPANY, now)

    def test_no_fallback_to_expired_or_future_period(self):
        for rows in ([row(ValidTo='2026-10-29T00:00:00')],
                     [row(ValidFrom='2026-11-01T00:00:00')],
                     [row(ValidTo='2026-10-29T00:00:00'), row(ValidFrom='2026-11-01T00:00:00')]):
            self.assertIsNone(self.profile(rows))

    def test_current_and_future_seasons_are_retained(self):
        rows = [row(), row(ValidFrom='2027-01-01T00:00:00', ValidTo='2027-04-01T00:00:00', Price1=0.3)]
        self.assertEqual(self.profile(rows)['hourly_ex_vat_ore'], [20.0] * 24)
        self.assertEqual(len(self.profile(rows)['periods']), 2)
        boundary = datetime(2027, 1, 1, tzinfo=tariffs.COPENHAGEN)
        self.assertEqual(self.profile(rows, boundary)['hourly_ex_vat_ore'], [30.0] * 24)
        self.assertIsNone(self.profile([rows[0]], boundary))

    def test_old_open_ended_tariff_is_current(self):
        self.assertIsNotNone(self.profile([row(ValidFrom='2015-01-01T00:00:00', ValidTo=None)]))

    def test_expired_higher_score_does_not_hide_current_same_start(self):
        expired = row(ValidTo='2026-10-20T00:00:00')
        current = row(Note='Nettarif C time', Price1=0.3)
        self.assertEqual(self.profile([expired, current])['hourly_ex_vat_ore'], [30.0] * 24)

    def test_invalid_period_fails(self):
        with self.assertRaises(ValueError):
            self.profile([row(ValidTo='2026-10-01T00:00:00')])

    def test_local_and_utc_boundaries_across_dst(self):
        record = row(ValidFrom='2026-10-25T00:00:00', ValidTo='2026-10-26T00:00:00')
        for stamp, expected in [('2026-10-24T22:00:00Z', True),
                                ('2026-10-25T22:59:59Z', True),
                                ('2026-10-25T23:00:00Z', False)]:
            self.assertEqual(tariffs.is_current(record, tariffs.parse_local(stamp)), expected)

    def test_missing_profile_preserves_file_until_expiry(self):
        for end, succeeds in [('2027-01-01T00:00:00', False), (None, False),
                              ('2026-10-29T11:14:00', True)]:
            with self.subTest(end=end), tempfile.TemporaryDirectory() as temp:
                out = Path(temp) / 'tariffs.json'
                out.write_text(json.dumps({'profiles': [{'id': 'rah', 'valid_to': end}]}))
                before = out.read_bytes()
                with patch.object(tariffs, 'OUT', out), patch.object(tariffs, 'COMPANIES', [COMPANY]), patch.object(tariffs, 'fetch_records', return_value=[row()]), patch.object(tariffs, 'datetime', wraps=datetime) as clock:
                    clock.now.return_value = NOW
                    self.assertEqual(data_utils.run(tariffs.main), 0 if succeeds else 1)
                if not succeeds:
                    self.assertEqual(out.read_bytes(), before)

    def test_future_only_replacement_cannot_bypass_missing_profile_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'tariffs.json'
            out.write_text('{"profiles": [{"id": "konstant", "valid_to": null}]}')
            before = out.read_bytes()
            with patch.object(tariffs, 'OUT', out), patch.object(tariffs, 'COMPANIES', [COMPANY]), patch.object(tariffs, 'fetch_records', return_value=[row(ValidFrom='2099-01-01T00:00:00', ValidTo=None)]):
                self.assertEqual(data_utils.run(tariffs.main), 1)
            self.assertEqual(out.read_bytes(), before)
