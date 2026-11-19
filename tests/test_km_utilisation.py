import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi import HTTPException
from pydantic import ValidationError
from backend.api.km_utilisation import Application, ReportLookup, submit, status

class UtilisationTests(unittest.TestCase):
    def body(self, **changes):
        now = datetime.now(timezone.utc)
        values = dict(inn="900032472", api_key="test-only", product_group="pharma",
            business_place_id=27, release_type="IMPORT", manufacturer_country="UA",
            production_date=now-timedelta(days=1), expiration_date=now+timedelta(days=365),
            series_number="B123", codes=["010482021304010721SERIAL\x1d93TEST"])
        values.update(changes)
        return Application(**values)

    def test_payload_preserves_full_codes_and_uses_query_group(self):
        body = self.body()
        with patch("backend.api.km_utilisation._verified") as verified, patch("backend.api.km_utilisation._call", return_value={"reportId":"report"}) as call:
            self.assertEqual(submit(body, None), {"reportId":"report"})
            verified.assert_called_once_with(body.inn, body.api_key)
            args, kwargs = call.call_args
            self.assertEqual(args, ("POST", "/api/utilisation", "test-only"))
            self.assertEqual(kwargs["params"], {"productGroup":"pharma"})
            self.assertEqual(kwargs["json"]["sntins"], body.codes)
            self.assertEqual(kwargs["json"]["businessPlaceId"], 27)
            self.assertEqual(kwargs["json"]["seriesNumber"], "B123")

    def test_invalid_reports_never_reach_asl(self):
        code = self.body().codes[0]
        cases = [dict(codes=[code, code]), dict(codes=[code.replace("\x1d", "")]),
            dict(series_number=" "), dict(production_date=None), dict(expiration_date=None),
            dict(production_date=datetime.now()),
            dict(production_date=datetime.now(timezone.utc)+timedelta(days=1)),
            dict(expiration_date=datetime.now(timezone.utc)-timedelta(days=1))]
        for changes in cases:
            with self.subTest(changes=changes), patch("backend.api.km_utilisation._call") as call:
                with self.assertRaises(HTTPException): submit(self.body(**changes), None)
                call.assert_not_called()

    def test_report_limit_and_mod(self):
        for changes in [dict(codes=[]), dict(codes=["test"]*30001), dict(business_place_id=0)]:
            with self.assertRaises(ValidationError): self.body(**changes)

    def test_status_is_read_only(self):
        rid="1496e1ed-8a38-4e50-65d4-39f779a56b32"
        with patch("backend.api.km_utilisation._call", return_value={"status":"SUCCESS"}) as call:
            self.assertEqual(status(ReportLookup(inn="900032472",api_key="test-only",report_id=rid),None), {"status":"SUCCESS"})
            call.assert_called_once_with("GET", f"/public/api/v1/doc/storage/docs/{rid}", "test-only")

if __name__ == "__main__": unittest.main()
